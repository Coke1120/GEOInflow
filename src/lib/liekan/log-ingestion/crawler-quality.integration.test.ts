// @vitest-environment node
import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatInTimeZone } from 'date-fns-tz';
import { Collector } from '@/liekan-agent/collector';
import { receiveBatch, processBatch, heartbeat } from './service';
import { tokenHash } from './secrets';
import { getQueue } from './queue';
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { aiTransaction } from '../upstream/ai-db';
import { importLogs } from '../store';
import { BOT_RULES } from '../rules/bots';
import { officialRuleConfiguration } from '../rules/configuration';
import { crawlerWindowQuality } from '../crawlers/analysis';
import { recomputeCrawlerRisks } from '../crawlers/worker';
import { crawlerClassificationVersion } from './crawler-evidence';
import { completeHourWindow, crawlerFindingKey } from '../crawlers/risks';
import { recordCrawlerCoverage } from './crawler-quality';
import type { CrawlerCoverage } from '../contracts/crawler-quality';
const enabled = process.env.LIEKAN_CRAWLER_TEST === '1';
describe.skipIf(!enabled)('collector coverage evidence on isolated PostgreSQL', () => {
  const owner = randomUUID(),
    site = randomUUID(),
    source = randomUUID(),
    interval = randomUUID(),
    generation = randomUUID(),
    window = completeHourWindow(Date.now());
  const q = (sql: string, ...params: unknown[]) => aiTransaction(tx => tx.query(sql, ...params));
  const raw = (tx: any) => ({ $queryRawUnsafe: tx.query, $executeRawUnsafe: tx.execute });
  let proof: CrawlerCoverage;
  const health = () => ({ pending: 0, gap: false, errorCode: 'none', coverage: proof });
  const record = (override: Partial<ReturnType<typeof health>> = {}) =>
    aiTransaction(tx =>
      recordCrawlerCoverage(
        raw(tx),
        { id: source, website_id: site, kind: 'server', state: 'active' },
        1,
        { ...health(), ...override },
        BOT_RULES,
        Date.now(),
        officialRuleConfiguration(),
      ),
    );
  async function batch(records: any[]) {
    // Fixture imports reuse the parser before registering their automatic-source ownership.
    await q('DELETE FROM liekan_log_interval WHERE source_id=$1::uuid', source);
    const imported = await importLogs(site, 'example.com', { format: 'json', records });
    await q(
      'UPDATE liekan_log SET source_id=$2::uuid WHERE import_id=$1::uuid',
      imported.id,
      source,
    );
    await q(
      "UPDATE liekan_import SET source_id=$2::uuid,kind='automatic' WHERE id=$1::uuid",
      imported.id,
      source,
    );
    await q(
      "INSERT INTO liekan_ingest_batch(id,website_id,source_id,epoch,digest,received,valid,rejected,state) VALUES($1::uuid,$2::uuid,$3::uuid,1,$4,$5,$5,0,'processed')",
      imported.id,
      site,
      source,
      imported.id.replaceAll('-', '').padEnd(64, '0'),
      records.length,
    );
    await q(
      'INSERT INTO liekan_log_interval(id,website_id,source_id,starts_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4)',
      interval,
      site,
      source,
      new Date(window.startAt - 30 * 86400000),
    );
    return imported.id;
  }
  const log = (time: number, index: number, status = 200) => ({
    ip: '203.0.113.15',
    userAgent: 'GPTBot',
    method: 'GET',
    status,
    bytes: 0,
    path: '/docs-' + index,
    time: new Date(time).toISOString(),
  });
  beforeAll(async () => {
    process.env.APP_SECRET = 'crawler-isolated-test-secret';
    const target = new URL(process.env.DATABASE_URL || 'http://invalid');
    if (
      target.hostname !== '127.0.0.1' ||
      target.port !== '15440' ||
      target.pathname !== '/liekan_crawler_acceptance'
    )
      throw new Error('Only isolated crawler DB15440 is allowed');
    await q(
      "INSERT INTO \"user\"(user_id,username,password,role) VALUES($1::uuid,$2,'test-demo-no-login','user')",
      owner,
      'test-demo-coverage-' + owner,
    );
    await q(
      "INSERT INTO website(website_id,name,domain,user_id) VALUES($1::uuid,'test-demo-coverage','example.com',$2::uuid)",
      site,
      owner,
    );
    await q(
      'INSERT INTO liekan_setting(website_id,is_demo,rules) VALUES($1::uuid,true,$2::jsonb)',
      site,
      JSON.stringify(BOT_RULES),
    );
    await q(
      "INSERT INTO liekan_log_source(id,website_id,kind,domain,created_by,owner_id,state) VALUES($1::uuid,$2::uuid,'server','example.com',$3::uuid,$3::uuid,'active')",
      source,
      site,
      owner,
    );
  });
  beforeEach(async () => {
    for (const table of [
      'liekan_crawler_finding_window',
      'liekan_crawler_finding',
      'liekan_crawler_quality',
      'liekan_crawler_analysis_state',
      'liekan_crawler_catalog_snapshot',
      'liekan_log',
      'liekan_import',
      'liekan_ingest_batch',
    ])
      await q(`DELETE FROM ${table} WHERE website_id=$1::uuid`, site);
    const first = await batch([log(window.startAt - 1000, 0)]),
      last = await batch([log(window.endAt + 1000, 1)]);
    proof = {
      epoch: 1,
      fromBatchId: first,
      toBatchId: last,
      startsAt: window.startAt - 1000,
      endsAt: window.endAt + 1000,
      cursors: [{ generation, confirmed: 100, read: 100 }],
    };
  });
  afterAll(async () => {
    for (const table of [
      'liekan_crawler_finding_window',
      'liekan_crawler_finding',
      'liekan_crawler_quality',
      'liekan_crawler_analysis_state',
      'liekan_crawler_catalog_snapshot',
      'liekan_log',
      'liekan_import',
      'liekan_ingest_batch',
      'liekan_log_interval',
      'liekan_log_source',
      'liekan_log_state',
    ])
      await q(`DELETE FROM ${table} WHERE website_id=$1::uuid`, site);
    await (await getQueue()).stop();
    await q('DELETE FROM website WHERE website_id=$1::uuid', site);
    await q('DELETE FROM "user" WHERE user_id=$1::uuid', owner);
  });
  it('distinguishes a declared zero-request hour from missing input', async () => {
    expect(
      (
        await aiTransaction(tx =>
          crawlerWindowQuality(tx, site, window.startAt, window.endAt, 'UTC'),
        )
      ).state,
    ).toBe('missing');
    await record();
    expect(
      await aiTransaction(tx =>
        crawlerWindowQuality(tx, site, window.startAt, window.endAt, 'UTC'),
      ),
    ).toMatchObject({
      state: 'complete',
      basis: 'event_time',
      sourceVersion: expect.stringContaining(source + ':'),
    });
  });
  it.each(['pending', 'unconfirmed', 'rejected', 'epoch', 'source-switch'] as const)(
    'rejects an unproven %s declaration',
    async kind => {
      if (kind === 'pending') await record({ pending: 1 });
      if (kind === 'unconfirmed') {
        proof.cursors[0].confirmed = 99;
        await record();
      }
      if (kind === 'rejected') {
        await q('UPDATE liekan_ingest_batch SET rejected=1 WHERE id=$1::uuid', proof.toBatchId);
        await record();
      }
      if (kind === 'epoch') {
        proof.epoch = 2;
        await record();
      }
      if (kind === 'source-switch') {
        await q(
          'UPDATE liekan_log_interval SET ends_at=$2 WHERE source_id=$1::uuid',
          source,
          new Date(window.startAt),
        );
        await record();
        await q('UPDATE liekan_log_interval SET ends_at=NULL WHERE source_id=$1::uuid', source);
      }
      expect(
        await q('SELECT * FROM liekan_crawler_quality WHERE website_id=$1::uuid', site),
      ).toHaveLength(0);
    },
  );
  it('keeps a known gap separate from a later new complete segment', async () => {
    await record();
    await record({ gap: true });
    expect(
      (
        await q(
          'SELECT state FROM liekan_crawler_quality WHERE website_id=$1::uuid ORDER BY starts_at',
          site,
        )
      ).map(row => row.state),
    ).toEqual(['complete', 'partial']);
  });
  it('corrects a historical occurrence after late successful requests change the denominator', async () => {
    await batch(
      Array.from({ length: 100 }, (_, index) =>
        log(window.startAt + index * 1000, index + 10, index < 20 ? 403 : 200),
      ),
    );
    await record();
    await recomputeCrawlerRisks(site, window.endAt + 15 * 60000);
    expect(
      (
        await q(
          "SELECT key FROM liekan_crawler_finding WHERE website_id=$1::uuid AND type='access'",
          site,
        )
      ).length,
    ).toBe(1);
    await batch(
      Array.from({ length: 150 }, (_, index) =>
        log(window.startAt + 200000 + index * 1000, index + 200),
      ),
    );
    await record();
    await recomputeCrawlerRisks(site, window.endAt + 15 * 60000);
    expect(
      await q(
        "SELECT * FROM liekan_crawler_finding_window WHERE website_id=$1::uuid AND facts->>'type'='access'",
        site,
      ),
    ).toHaveLength(0);
    expect(
      (
        await q(
          "SELECT state,facts FROM liekan_crawler_finding WHERE website_id=$1::uuid AND type='access'",
          site,
        )
      )[0],
    ).toMatchObject({ state: 'resolved', facts: { correctedByLateData: true } });
  });
  it('processes an older queued payload from a real collector upload and writes complete coverage', async () => {
    const token = 'a'.repeat(43),
      dir = await mkdtemp(join(tmpdir(), 'liekan-coverage-integration-'));
    await q(
      'UPDATE liekan_log_source SET credential_hash=$2 WHERE id=$1::uuid',
      source,
      tokenHash(token),
    );
    const config = {
      version: 1 as const,
      sourceId: source,
      token,
      url: 'https://logs.example.com',
      logPath: join(dir, 'access.log'),
      stateDir: join(dir, 'state'),
      key: Buffer.alloc(32, 3).toString('base64'),
      epoch: 1,
    };
    await writeFile(config.logPath, '');
    let requestId = '',
      serverId = '';
    const agent = new Collector(config, (async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith('/heartbeat'))
        return Response.json(await heartbeat(source, token, body));
      requestId = body.batchId;
      const ack = await receiveBatch(new Request(String(url), init), source);
      if (!('batchId' in ack)) throw new Error('Persistent batch acknowledgement missing');
      serverId = ack.batchId;
      await q(
        `UPDATE liekan_ingest_batch SET payload=(SELECT jsonb_agg(item-'aiEligible'-'recognitionState'-'recognitionCandidates'-'verificationObservedAt'-'verificationReason') FROM jsonb_array_elements(payload) item) WHERE id=$1::uuid`,
        serverId,
      );
      await processBatch(serverId);
      expect(
        (
          await q(
            'SELECT ai_eligible,recognition_state,verification_observed_at FROM liekan_log WHERE import_id=$1::uuid',
            serverId,
          )
        )[0],
      ).toEqual({ ai_eligible: null, recognition_state: null, verification_observed_at: null });
      return Response.json(ack);
    }) as typeof fetch);
    try {
      await agent.initialize();
      await agent.synchronize();
      await agent.read();
      const line = (time: number) =>
        `192.0.2.5 - - [${formatInTimeZone(time, 'UTC', 'dd/MMM/yyyy:HH:mm:ss')} +0000] "GET /collector HTTP/1.1" 200 5 "-" "GPTBot"\n`;
      await appendFile(config.logPath, line(window.startAt - 1000) + line(window.endAt + 1000));
      await agent.read();
      expect(await agent.flush()).toBe(true);
      expect(serverId).not.toBe(requestId);
      expect((await agent.health()).coverage?.fromBatchId).toBe(serverId);
      expect(await agent.synchronize()).toBe(true);
      expect(
        (
          await aiTransaction(tx =>
            crawlerWindowQuality(tx, site, window.startAt, window.endAt, 'UTC'),
          )
        ).state,
      ).toBe('complete');
    } finally {
      await agent.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('recovers coverage on two daily comparisons even when the sampled hours have zero requests', async () => {
    const day = 86400000,
      firstEnd = window.endAt - 2 * day,
      key = crawlerFindingKey('gptbot', 'coverage');
    const paths = Array.from({ length: 20 }, (_, index) => '/coverage-' + index);
    for (const path of paths)
      await q(
        "INSERT INTO liekan_catalog(website_id,path,title,content_type) VALUES($1::uuid,$2,'test-demo','文章') ON CONFLICT DO NOTHING",
        site,
        path,
      );
    await q(
      'INSERT INTO liekan_crawler_catalog_snapshot(website_id,snapshot_at,paths) VALUES($1::uuid,$2,$3::jsonb)',
      site,
      new Date(firstEnd - 15 * day),
      JSON.stringify(paths),
    );
    for (const shift of [12, 4])
      await batch(
        Array.from({ length: 100 }, (_, index) => ({
          ...log(firstEnd - shift * day + index * 1000, index + 1000 + shift * 100),
          path: paths[index % 20],
        })),
      );
    const quality = {
      state: 'complete',
      basis: 'event_time',
      classificationVersion: crawlerClassificationVersion(BOT_RULES, officialRuleConfiguration()),
      sourceVersion: source + ':' + interval,
      timezone: 'UTC',
    };
    await q(
      "INSERT INTO liekan_crawler_quality(website_id,source_id,starts_at,ends_at,state,evidence) VALUES($1::uuid,$2::uuid,$3,$4,'complete',$5::jsonb)",
      site,
      source,
      new Date(firstEnd - 15 * day),
      new Date(window.endAt),
      JSON.stringify(quality),
    );
    await q(
      "INSERT INTO liekan_crawler_finding(website_id,key,bot_id,type,path_group,grade,confidence,window_end,facts) VALUES($1::uuid,$2,'gptbot','coverage','all','info','possible',$3,$4::jsonb)",
      site,
      key,
      new Date(firstEnd - day),
      JSON.stringify({
        type: 'coverage',
        windowEnd: firstEnd - day,
        lastQuality: quality,
        coverageRecoveryEnd: Math.floor((firstEnd - day) / day) * day,
      }),
    );
    await recomputeCrawlerRisks(site, firstEnd + 15 * 60000);
    expect(
      (
        await q(
          'SELECT state,good_windows FROM liekan_crawler_finding WHERE website_id=$1::uuid AND key=$2',
          site,
          key,
        )
      )[0],
    ).toMatchObject({ state: 'active', good_windows: 1 });
    await recomputeCrawlerRisks(site, firstEnd + day + 15 * 60000);
    expect(
      (
        await q(
          'SELECT state,good_windows FROM liekan_crawler_finding WHERE website_id=$1::uuid AND key=$2',
          site,
          key,
        )
      )[0],
    ).toMatchObject({ state: 'resolved', good_windows: 2 });
  });
});
