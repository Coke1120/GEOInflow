import { disconnectAiFactsClient } from '../../../src/lib/liekan/upstream/ai-facts-db';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import prisma, { getRawQueryClient } from '../../../src/lib/prisma';
import { buildAiFactsContext } from '../../../src/lib/liekan/upstream/ai-facts';
import { createAiConversation } from '../../../src/lib/liekan/ai/conversations';
import { getLogFacts } from '../../../src/lib/liekan/upstream/logs';
const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.port, '15439');
assert.equal(url.pathname, '/liekan_ai_acceptance');
const pressure = process.argv.includes('--pressure'),
  count = pressure ? 10000000 : 1000000;
const primary: any = getRawQueryClient(prisma.client, { write: true });
const users = Array.from({ length: 3 }, () => randomUUID()),
  team = randomUUID(),
  site = randomUUID(),
  importId = randomUUID();
const end = new Date(Date.now() - 60000),
  p95 = (values: number[]) =>
    [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
const rows: any[] = [];
let environment: unknown;
const containerUsage = () =>
  JSON.parse(
    execFileSync(
      'docker',
      ['stats', '--no-stream', '--format', '{{json .}}', 'liekan-ai-acceptance-db'],
      { encoding: 'utf8', timeout: 10000 },
    ),
  );
try {
  await primary.$executeRawUnsafe('VACUUM (PARALLEL 0) liekan_log');
  for (const id of users)
    await primary.$executeRawUnsafe(
      'INSERT INTO "user"(user_id,username,password,role) VALUES($1::uuid,$2,$3,\'user\')',
      id,
      `isolated-ai-capacity-${id.slice(0, 8)}`,
      'fixture-login-disabled',
    );
  await primary.$executeRawUnsafe(
    'INSERT INTO team(team_id,name) VALUES($1::uuid,$2)',
    team,
    'Isolated AI capacity fixture',
  );
  for (const id of users)
    await primary.$executeRawUnsafe(
      'INSERT INTO team_user(team_user_id,team_id,user_id,role) VALUES($1::uuid,$2::uuid,$3::uuid,$4)',
      randomUUID(),
      team,
      id,
      'team-member',
    );
  await primary.$executeRawUnsafe(
    'INSERT INTO website(website_id,name,domain,team_id) VALUES($1::uuid,$2,$3,$4::uuid)',
    site,
    'Isolated AI capacity fixture',
    'capacity.example',
    team,
  );
  await primary.$executeRawUnsafe(
    'INSERT INTO liekan_import(id,website_id,digest,accepted,rejected) VALUES($1::uuid,$2::uuid,$3,$4,0)',
    importId,
    site,
    'isolated-capacity',
    count,
  );
  // Generated fixture rows never enter production and contain no visitor identities.
  for (let offset = 0; offset < count; offset += 100000)
    await primary.$executeRawUnsafe(
      "INSERT INTO liekan_log(id,website_id,import_id,created_at,path,method,status,bytes,ip_masked,ip_hash,user_agent,location,bot,vendor,bot_type,verification) SELECT 'capacity-'||n,$1::uuid,$2::uuid,$3::timestamptz-(n%180000)*interval '86.4 seconds','/article/'||(n%500),'GET',CASE WHEN n%30=0 THEN 403 WHEN n%50=0 THEN 404 WHEN n%70=0 THEN 503 ELSE 200 END,0,'','','','','GPTBot','OpenAI','训练','unverified' FROM generate_series($4::integer,$5::integer) n",
      site,
      importId,
      end,
      offset + 1,
      Math.min(count, offset + 100000),
    );
  console.log(JSON.stringify({ fixture: true, importedLogs: count }));
  await primary.$executeRawUnsafe('VACUUM (ANALYZE, PARALLEL 0) liekan_log');
  environment = {
    docker: execFileSync(
      'docker',
      ['info', '--format', '{{.NCPU}} CPUs; {{.MemTotal}} bytes VM memory'],
      { encoding: 'utf8', timeout: 10000 },
    ).trim(),
    postgres: (
      await primary.$queryRawUnsafe(
        "SELECT version(),current_setting('shared_buffers') AS shared_buffers,current_setting('work_mem') AS work_mem,current_setting('max_parallel_workers_per_gather') AS max_parallel_workers_per_gather",
      )
    )[0],
    indexes: await primary.$queryRawUnsafe(
      "SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='liekan_log' ORDER BY indexname",
    ),
    usage: containerUsage(),
  };
  const conversations = [];
  for (const id of users)
    conversations.push(await createAiConversation({ id, role: 'user' }, { websiteId: site }));
  const timed = async (fn: () => Promise<unknown>) => {
    const started = performance.now();
    try {
      await fn();
      return { ms: performance.now() - started, success: true };
    } catch (error) {
      return {
        ms: performance.now() - started,
        success: false,
        code: (error as any)?.code ?? 'query_error',
      };
    }
  };
  for (const days of [7, 30, 90]) {
    const start = new Date(end.getTime() - days * 86400000 + 1);
    const queryPlan = await primary.$queryRawUnsafe(
      'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT count(*) FROM liekan_log WHERE website_id=$1::uuid AND created_at BETWEEN $2::timestamptz AND $3::timestamptz',
      site,
      new Date(start.getTime() - days * 86400000),
      end,
    );
    const original = () => getLogFacts(site, start, end, 'Asia/Shanghai');
    const baseline: number[] = [];
    const facts: any[] = [];
    const loaded: number[] = [];
    const samples: any[] = [];
    await original();
    for (let round = 0; round < 20; round++) {
      const sample: any = { pairIndex: round, order: round % 2 ? 'load-first' : 'baseline-first' };
      const measureBaseline = async () => {
        sample.baselineStartedAt = new Date().toISOString();
        const result = await timed(original);
        if (!result.success) throw Error('Original report baseline failed');
        baseline.push(result.ms);
        sample.baselineMs = result.ms;
      };
      const measureLoad = async () => {
        sample.loadStartedAt = new Date().toISOString();
        const result = await Promise.all([
          ...users.map((id, i) =>
            timed(() =>
              buildAiFactsContext({
                actor: { id, role: 'user' },
                conversationId: conversations[i].id,
                input: {
                  clientRequestId: randomUUID(),
                  expectedConfigVersion: 1,
                  question: 'Isolated capacity fixture',
                  startAt: start.toISOString(),
                  endAt: end.toISOString(),
                  timezone: 'Asia/Shanghai',
                },
                signal: new AbortController().signal,
              }),
            ),
          ),
          timed(original),
        ]);
        facts.push(...result.slice(0, 3));
        if (!result[3].success) throw Error('Original report under load failed');
        loaded.push(result[3].ms);
        sample.loadedMs = result[3].ms;
        sample.facts = result.slice(0, 3);
      };
      if (round % 2) {
        await measureLoad();
        await measureBaseline();
      } else {
        await measureBaseline();
        await measureLoad();
      }
      samples.push(sample);
    }
    const row = {
      days,
      logs: count,
      users: 3,
      iterations: 20,
      measurementMethod: 'paired-alternating',
      samples,
      databaseUsage: containerUsage(),
      windowCountPlan: queryPlan,
      factsP95Ms: p95(facts.map(f => f.ms)),
      factsFailures: facts.filter(f => !f.success).length,
      failureCodes: [...new Set(facts.filter(f => !f.success).map(f => f.code))],
      originalBaselineP95Ms: p95(baseline),
      originalLoadedP95Ms: p95(loaded),
      originalDegradationPercent: (p95(loaded) / p95(baseline) - 1) * 100,
    };
    rows.push(row);
    await mkdir('outputs', { recursive: true });
    await writeFile(
      `outputs/ai-capacity-${count}.json`,
      JSON.stringify({ fixture: true, postgresVersion: 15, environment, rows }, null, 2),
    );
    console.log(JSON.stringify(row));
  }
  await mkdir('outputs', { recursive: true });
  await writeFile(
    `outputs/ai-capacity-${count}.json`,
    JSON.stringify({ fixture: true, postgresVersion: 15, environment, rows }, null, 2),
  );
  if (
    !pressure &&
    rows.some(r => r.factsFailures || r.factsP95Ms > 5000 || r.originalDegradationPercent > 20)
  )
    process.exitCode = 1;
} finally {
  await primary.$executeRawUnsafe('DELETE FROM website WHERE website_id=$1::uuid', site);
  await primary.$executeRawUnsafe('DELETE FROM team_user WHERE team_id=$1::uuid', team);
  await primary.$executeRawUnsafe('DELETE FROM team WHERE team_id=$1::uuid', team);
  for (const id of users)
    await primary.$executeRawUnsafe('DELETE FROM "user" WHERE user_id=$1::uuid', id);
  await disconnectAiFactsClient();
  await prisma.client.$disconnect();
}
