// @vitest-environment node
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const enabled = process.env.LIEKAN_ANALYSIS_ROLLUPS_TEST === '1';
const actor = { userId: randomUUID() };
let db: typeof import('./analysis-rollups-db');
let prisma: typeof import('@/lib/prisma').default;
let service: typeof import('../log-ingestion/service');
let website: string;
const q = <T = any[]>(statement: string, ...values: unknown[]) =>
  db.analysisTransaction(tx => tx.$queryRawUnsafe<T>(statement, ...values));
const sql = (statement: string, ...values: unknown[]) =>
  db.analysisTransaction(tx => tx.$executeRawUnsafe(statement, ...values));
type Source = { id: string; token: string };
type Outcome = { ok: boolean; status?: number; code?: string };
type Worker = { name: string; child: ChildProcess; done: Promise<Outcome> };

async function connect() {
  const url = new URL(process.env.DATABASE_URL);
  const schema = url.searchParams.get('schema');
  url.searchParams.delete('schema');
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  await client.query(`SET search_path TO "${schema}"`);
  return client;
}
async function source(): Promise<Source> {
  const { newToken, tokenHash } = await import('../log-ingestion/secrets');
  const id = randomUUID(),
    token = newToken();
  await sql(
    `INSERT INTO liekan_log_source(id,website_id,kind,domain,created_by,owner_id,team_id,state,credential_hash)
     SELECT $1::uuid,$2::uuid,'server','example.test',$3::uuid,user_id,team_id,'active',$4
     FROM website WHERE website_id=$2::uuid`,
    id,
    website,
    actor.userId,
    tokenHash(token),
  );
  await sql(
    "INSERT INTO liekan_log_interval(id,website_id,source_id,starts_at) VALUES($1::uuid,$2::uuid,$3::uuid,'2026-01-01Z')",
    randomUUID(),
    website,
    id,
  );
  return { id, token };
}
async function batch(input: Source, generation = randomUUID(), path = '/synthetic', day = '04') {
  const result = await service.receiveBatch(
    new Request('https://collector.invalid/upload', {
      method: 'POST',
      headers: { authorization: `Bearer ${input.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        version: 1,
        batchId: randomUUID(),
        epoch: 1,
        events: [
          {
            generation,
            offset: 0,
            line: `192.0.2.20 - - [${day}/Oct/2026:10:00:00 +0800] "GET ${path} HTTP/1.1" 200 25 "-" "GPTBot"`,
          },
        ],
      }),
    }),
    input.id,
  );
  expect(result).toMatchObject({ valid: 1, rejected: 0 });
  return (result as { batchId: string }).batchId;
}
function worker(batchId: string): Worker {
  const name = `analysis-ingest-${randomUUID()}`;
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('application_name', name);
  const code = `const {processBatch}=require('./src/lib/liekan/log-ingestion/service.ts');
const prisma=require('./src/lib/prisma.ts').default;
(async()=>{try{await processBatch(process.argv[1]);console.log(JSON.stringify({ok:true}));}
catch(error){console.log(JSON.stringify({ok:false,status:error.status,code:error.meta?.driverAdapterError?.cause?.originalCode??error.meta?.code??error.code}));}
finally{await prisma.client.$disconnect();}})();`;
  const child = spawn(process.execPath, ['--import', 'tsx', '-e', code, batchId], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '',
    errors = '';
  child.stdout.on('data', bytes => {
    output += bytes.toString();
  });
  child.stderr.on('data', bytes => {
    errors += bytes.toString();
  });
  const done = new Promise<Outcome>((resolve, reject) => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.on('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', async status => {
      clearTimeout(timeout);
      if (status !== 0) {
        await writeFile(`${process.env.LIEKAN_ANALYSIS_ROLLUPS_OUTPUT}/${name}.log`, errors, {
          mode: 0o600,
        });
        reject(new Error('isolated-ingest-worker-failed'));
        return;
      }
      try {
        resolve(JSON.parse(output.trim().split('\n').at(-1)));
      } catch {
        reject(new Error('isolated-ingest-worker-result-missing'));
      }
    });
  });
  return { name, child, done };
}
async function waiting(client: Client, name: string, blocker: number) {
  for (let n = 0; n < 250; n++) {
    const { rows } = await client.query(
      `SELECT pid,query,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers
       FROM pg_stat_activity WHERE application_name=$1 AND datname=current_database()`,
      [name],
    );
    const row = rows.find(row => row.blockers.includes(blocker));
    if (row) return row;
    await sleep(20);
  }
  throw new Error('expected-database-lock-barrier-not-reached');
}
async function managerBeforeBatch(id: string, change: (client: Client) => Promise<unknown>) {
  const manager = await connect(),
    observer = await connect();
  let task: Worker;
  try {
    await manager.query('BEGIN');
    const {
      rows: [{ pid }],
    } = await manager.query('SELECT pg_backend_pid() AS pid');
    await manager.query('SELECT website_id FROM website WHERE website_id=$1::uuid FOR UPDATE', [
      website,
    ]);
    await change(manager);
    task = worker(id);
    const wait = await waiting(observer, task.name, pid);
    expect(wait.query).toContain('FROM website');
    expect(wait.query).toContain('FOR SHARE');
    await manager.query('COMMIT');
    return await task.done;
  } finally {
    await manager.query('ROLLBACK');
    await manager.end();
    await observer.end();
    if (task) await task.done;
  }
}
async function counts() {
  return (
    await q(
      `SELECT
    (SELECT count(*)::int FROM liekan_log WHERE website_id=$1::uuid) AS logs,
    (SELECT count(*)::int FROM liekan_effective_log WHERE website_id=$1::uuid) AS effective,
    (SELECT count(*)::int FROM liekan_log_geography WHERE website_id=$1::uuid) AS geography,
    (SELECT count(*)::int FROM liekan_crawler_evidence WHERE website_id=$1::uuid) AS evidence,
    (SELECT count(*)::int FROM liekan_import WHERE website_id=$1::uuid) AS imports,
    (SELECT data_revision::int FROM liekan_log_state WHERE website_id=$1::uuid) AS revision`,
      website,
    )
  )[0];
}
async function collect() {
  const { withCollectionWrite, collectionWriteClient } = await import('./collection-write');
  const { observeCollection } = await import('./collection-observation');
  const { saveEvent } = await import('@/queries/sql/events/saveEvent');
  const eventId = randomUUID(),
    sessionId = randomUUID();
  return withCollectionWrite(
    {
      websiteId: website,
      eventId,
      fingerprint: eventId,
      quality: {
        classification: 'browser',
        source: 'browser',
        reasons: ['synthetic'],
        ruleVersion: 'fixture',
        catalogVersion: null,
        rangeVersion: null,
        rangeStatus: 'missing',
        hostname: 'example.test',
      },
      geography: {
        location: { country: 'CN', region: 'CN-11', city: '北京市' },
        source: 'synthetic',
        trust: 'unverified',
        ipFamily: 'missing',
        precision: 'city',
        reason: 'synthetic',
        ruleVersion: 'fixture',
        dataVersion: null,
        cityId: null,
        accuracyRadius: null,
        countryBasis: 'missing',
        processedAt: new Date().toISOString(),
        shadow: null,
      },
      observation: observeCollection(new Request('https://example.test')),
    },
    async () => {
      await collectionWriteClient().$executeRawUnsafe(
        "INSERT INTO session(session_id,website_id,browser) VALUES($1::uuid,$2::uuid,'Synthetic')",
        sessionId,
        website,
      );
      return saveEvent({
        websiteId: website,
        sessionId,
        visitId: sessionId,
        eventType: 1,
        createdAt: new Date(),
        hostname: 'example.test',
        urlPath: '/synthetic',
        eventData: { synthetic: 'fixture' },
      });
    },
  );
}

describe.skipIf(!enabled)(
  'batch authority with real browser collection and independent workers',
  () => {
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL || 'http://invalid');
      if (
        url.hostname !== '127.0.0.1' ||
        url.port !== '15462' ||
        url.pathname !== '/liekan_analysis_rollups_test' ||
        !/^analysis_[a-f0-9]+$/.test(url.searchParams.get('schema') || '')
      )
        throw new Error('owned-analysis-schema-required');
      db = await import('./analysis-rollups-db');
      ({ default: prisma } = await import('@/lib/prisma'));
      service = await import('../log-ingestion/service');
      await sql(
        "INSERT INTO \"user\"(user_id,username,password,role) VALUES($1::uuid,$1::text,'fixture','user')",
        actor.userId,
      );
    });
    beforeEach(async () => {
      website = randomUUID();
      await sql(
        "INSERT INTO website(website_id,name,domain,user_id) VALUES($1::uuid,'Synthetic batch authority','example.test',$2::uuid)",
        website,
        actor.userId,
      );
      await sql('INSERT INTO liekan_log_state(website_id) VALUES($1::uuid)', website);
    });
    afterEach(async () => {
      await db.analysisTransaction(async tx => {
        await tx.$queryRawUnsafe(
          'SELECT website_id FROM website WHERE website_id=$1::uuid FOR UPDATE',
          website,
        );
        await tx.$queryRawUnsafe(
          'SELECT website_id FROM liekan_analysis_site WHERE website_id=$1::uuid FOR UPDATE',
          website,
        );
        await tx.$executeRawUnsafe('DELETE FROM website WHERE website_id=$1::uuid', website);
      });
    });
    afterAll(async () => {
      if (enabled && prisma) await prisma.client.$disconnect();
    });

    it('allows atomic browser collection while a validated batch waits for its own ledger row', async () => {
      const input = await source(),
        id = await batch(input);
      const blocker = await connect(),
        observer = await connect();
      let task: Worker, browser: Promise<unknown>;
      let observed: 'completed' | 'blocked-on-batch' | undefined;
      try {
        await blocker.query('BEGIN');
        const {
          rows: [{ pid }],
        } = await blocker.query('SELECT pg_backend_pid() AS pid');
        await blocker.query('SELECT id FROM liekan_ingest_batch WHERE id=$1::uuid FOR UPDATE', [
          id,
        ]);
        task = worker(id);
        const bulk = await waiting(observer, task.name, pid);
        expect(bulk.query).toContain('liekan_ingest_batch');
        await expect(
          observer.query('SELECT id FROM liekan_log_source WHERE id=$1::uuid FOR UPDATE NOWAIT', [
            input.id,
          ]),
        ).rejects.toMatchObject({ code: '55P03' });
        await expect(
          observer.query(
            'SELECT website_id FROM website WHERE website_id=$1::uuid FOR UPDATE NOWAIT',
            [website],
          ),
        ).rejects.toMatchObject({ code: '55P03' });
        let complete = false;
        browser = collect().then(value => {
          complete = true;
          return value;
        });
        for (let n = 0; n < 250; n++) {
          if (complete) {
            observed = 'completed';
            break;
          }
          const { rows } = await observer.query(
            'SELECT pid,query,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE datname=current_database() AND $1::int=ANY(pg_blocking_pids(pid))',
            [bulk.pid],
          );
          if (
            rows.some(
              row =>
                row.query.includes('SELECT website_id FROM website') &&
                row.query.includes('FOR SHARE'),
            )
          ) {
            observed = 'blocked-on-batch';
            break;
          }
          await sleep(20);
        }
        await writeFile(
          `${process.env.LIEKAN_ANALYSIS_ROLLUPS_OUTPUT}/batch-browser-barrier.json`,
          JSON.stringify({ observed, batchWait: bulk }),
          { mode: 0o600 },
        );
      } finally {
        await blocker.query('ROLLBACK');
        await blocker.end();
        await observer.end();
        if (task) expect(await task.done).toEqual({ ok: true });
        if (browser) await browser;
      }
      const [counts] = await q(
        `SELECT
      (SELECT count(*)::int FROM website_event WHERE website_id=$1::uuid) AS events,
      (SELECT count(*)::int FROM liekan_event_quality WHERE website_id=$1::uuid) AS quality,
      (SELECT count(*)::int FROM liekan_event_geography WHERE website_id=$1::uuid) AS geography,
      (SELECT count(*)::int FROM liekan_collection_receipt WHERE website_id=$1::uuid AND event_id IS NOT NULL) AS receipts,
      (SELECT count(*)::int FROM liekan_log WHERE website_id=$1::uuid) AS logs,
      (SELECT count(*)::int FROM liekan_crawler_evidence WHERE website_id=$1::uuid) AS evidence`,
        website,
      );
      expect(counts).toEqual({
        events: 1,
        quality: 1,
        geography: 1,
        receipts: 1,
        logs: 1,
        evidence: 1,
      });
      expect(observed).toBe('completed');
    }, 30000);

    it('serializes conflicting normalized identities from independent same-source workers', async () => {
      const input = await source(),
        generation = randomUUID();
      const first = await batch(input, generation, '/first'),
        second = await batch(input, generation, '/conflict');
      const normalized = await q(
        'SELECT id,payload->0 AS record FROM liekan_ingest_batch WHERE id=ANY($1::uuid[]) ORDER BY id',
        [first, second],
      );
      expect(normalized).toHaveLength(2);
      expect(normalized[0].record.id).toBe(normalized[1].record.id);
      expect(normalized[0].record.eventDigest).not.toBe(normalized[1].record.eventDigest);
      const blocker = await connect(),
        observer = await connect();
      let a: Worker, b: Worker;
      try {
        await blocker.query('BEGIN');
        const {
          rows: [{ pid }],
        } = await blocker.query('SELECT pg_backend_pid() AS pid');
        await blocker.query('SELECT id FROM liekan_ingest_batch WHERE id=$1::uuid FOR UPDATE', [
          first,
        ]);
        a = worker(first);
        const firstWait = await waiting(observer, a.name, pid);
        b = worker(second);
        const secondWait = await waiting(observer, b.name, firstWait.pid);
        expect(secondWait.query).toContain('FROM liekan_log_source');
        expect(secondWait.query).toContain('FOR UPDATE');
      } finally {
        await blocker.query('ROLLBACK');
        await blocker.end();
        await observer.end();
        if (a) expect(await a.done).toEqual({ ok: true });
        if (b) expect(await b.done).toMatchObject({ ok: false, status: 409 });
      }
      expect(await counts()).toEqual({
        logs: 1,
        effective: 1,
        geography: 1,
        evidence: 1,
        imports: 1,
        revision: 1,
      });
      const [row] = await q(
        'SELECT state,payload IS NOT NULL AS retained FROM liekan_ingest_batch WHERE id=$1::uuid',
        second,
      );
      expect(row).toEqual({ state: 'pending', retained: true });
      expect(
        (
          await q(
            'SELECT path,import_id,source_id FROM liekan_log WHERE website_id=$1::uuid',
            website,
          )
        )[0],
      ).toEqual({ path: '/first', import_id: first, source_id: input.id });
    }, 30000);

    it('admits independent normalized sources and preserves paused-source pending intervals and both revisions', async () => {
      const firstSource = await source(),
        generation = randomUUID();
      const first = await batch(firstSource, generation, '/old-source', '02');
      await sql(
        "UPDATE liekan_log_interval SET ends_at='2026-10-03Z' WHERE source_id=$1::uuid",
        firstSource.id,
      );
      await sql("UPDATE liekan_log_source SET state='paused' WHERE id=$1::uuid", firstSource.id);
      const secondSource = await source();
      await sql(
        "UPDATE liekan_log_interval SET starts_at='2026-10-03Z' WHERE source_id=$1::uuid",
        secondSource.id,
      );
      const second = await batch(secondSource, generation, '/new-source');
      const expected = await q(
        'SELECT id,source_id,payload->0 AS record FROM liekan_ingest_batch WHERE id=ANY($1::uuid[]) ORDER BY id',
        [first, second],
      );
      expect(new Set(expected.map(row => row.record.id)).size).toBe(2);
      const blocker = await connect(),
        observer = await connect();
      let a: Worker, b: Worker;
      try {
        await blocker.query('BEGIN');
        const {
          rows: [{ pid }],
        } = await blocker.query('SELECT pg_backend_pid() AS pid');
        await blocker.query(
          'SELECT id FROM liekan_ingest_batch WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
          [[first, second]],
        );
        a = worker(first);
        const firstWait = await waiting(observer, a.name, pid);
        expect(firstWait.query).toContain('FROM liekan_ingest_batch');
        b = worker(second);
        const secondWait = await waiting(observer, b.name, pid);
        expect(secondWait.query).toContain('FROM liekan_ingest_batch');
        expect(firstWait.pid).not.toBe(secondWait.pid);
      } finally {
        await blocker.query('ROLLBACK');
        await blocker.end();
        await observer.end();
        if (a) expect(await a.done).toEqual({ ok: true });
        if (b) expect(await b.done).toEqual({ ok: true });
      }
      expect(await counts()).toEqual({
        logs: 2,
        effective: 2,
        geography: 2,
        evidence: 2,
        imports: 2,
        revision: 2,
      });
      const actual = await q(
        'SELECT id,source_id,import_id,event_digest FROM liekan_log WHERE website_id=$1::uuid ORDER BY import_id',
        website,
      );
      expect(actual).toEqual(
        expected.map(row => ({
          id: row.record.id,
          source_id: row.source_id,
          import_id: row.id,
          event_digest: row.record.eventDigest,
        })),
      );
      expect(
        await q(
          'SELECT state,inserted FROM liekan_ingest_batch WHERE id=ANY($1::uuid[]) ORDER BY id',
          [first, second],
        ),
      ).toEqual([
        { state: 'processed', inserted: 1 },
        { state: 'processed', inserted: 1 },
      ]);
    }, 30000);

    it('rolls back raw facts, evidence, ledger and dirty markers on a late counter failure', async () => {
      const input = await source(),
        id = await batch(input);
      const dirty = () =>
        q(
          'SELECT epoch,family,bucket,shard,revision FROM liekan_analysis_dirty WHERE website_id=$1::uuid ORDER BY epoch,family,bucket,shard',
          website,
        );
      const before = await dirty();
      const constraint = `fixture_${randomUUID().replaceAll('-', '')}`;
      try {
        await sql(
          `ALTER TABLE liekan_log_state ADD CONSTRAINT ${constraint} CHECK(website_id<>'${website}'::uuid OR data_revision=0)`,
        );
        expect(await worker(id).done).toMatchObject({ ok: false, code: '23514' });
        expect(await counts()).toEqual({
          logs: 0,
          effective: 0,
          geography: 0,
          evidence: 0,
          imports: 0,
          revision: 0,
        });
        expect(await dirty()).toEqual(before);
        expect(
          (
            await q(
              'SELECT state,payload IS NOT NULL AS retained FROM liekan_ingest_batch WHERE id=$1::uuid',
              id,
            )
          )[0],
        ).toEqual({ state: 'pending', retained: true });
      } finally {
        await sql(`ALTER TABLE liekan_log_state DROP CONSTRAINT IF EXISTS ${constraint}`);
      }
      expect(await worker(id).done).toEqual({ ok: true });
      expect(await counts()).toEqual({
        logs: 1,
        effective: 1,
        geography: 1,
        evidence: 1,
        imports: 1,
        revision: 1,
      });
    }, 30000);

    it.each(['paused', 'error'] as const)(
      'retains the existing %s-source pending contract after a management barrier',
      async state => {
        const input = await source(),
          id = await batch(input);
        expect(
          await managerBeforeBatch(id, tx =>
            tx.query('UPDATE liekan_log_source SET state=$2 WHERE id=$1::uuid', [input.id, state]),
          ),
        ).toEqual({ ok: true });
        expect(await counts()).toEqual({
          logs: 1,
          effective: 1,
          geography: 1,
          evidence: 1,
          imports: 1,
          revision: 1,
        });
      },
      30000,
    );

    it.each(['disconnected', 'domain', 'owner', 'epoch'] as const)(
      'rechecks a committed %s change after waiting for management',
      async change => {
        const input = await source(),
          id = await batch(input);
        const outcome = await managerBeforeBatch(id, async tx => {
          if (change === 'disconnected')
            await tx.query("UPDATE liekan_log_source SET state='disconnected' WHERE id=$1::uuid", [
              input.id,
            ]);
          if (change === 'domain')
            await tx.query(
              "UPDATE website SET domain='changed.invalid' WHERE website_id=$1::uuid",
              [website],
            );
          if (change === 'owner') {
            const next = randomUUID();
            await tx.query(
              "INSERT INTO \"user\"(user_id,username,password,role) VALUES($1::uuid,$1::text,'fixture','user')",
              [next],
            );
            await tx.query('UPDATE website SET user_id=$2::uuid WHERE website_id=$1::uuid', [
              website,
              next,
            ]);
          }
          if (change === 'epoch')
            await tx.query(
              'UPDATE liekan_log_state SET epoch=epoch+1,reset_at=clock_timestamp() WHERE website_id=$1::uuid',
              [website],
            );
        });
        expect(outcome).toMatchObject(
          change === 'epoch'
            ? { ok: true }
            : { ok: false, status: change === 'disconnected' ? 409 : 403 },
        );
        expect(await counts()).toEqual({
          logs: 0,
          effective: 0,
          geography: 0,
          evidence: 0,
          imports: 0,
          revision: 0,
        });
        expect(
          (
            await q(
              'SELECT state,payload IS NOT NULL AS retained FROM liekan_ingest_batch WHERE id=$1::uuid',
              id,
            )
          )[0],
        ).toEqual(
          change === 'epoch'
            ? { state: 'cancelled', retained: false }
            : { state: 'pending', retained: true },
        );
      },
      30000,
    );

    it('rechecks current team write authority and holds the original shared membership fence', async () => {
      const team = randomUUID();
      try {
        await sql("INSERT INTO team(team_id,name) VALUES($1::uuid,'Synthetic authority')", team);
        await sql(
          "INSERT INTO team_user(team_user_id,team_id,user_id,role) VALUES($1::uuid,$2::uuid,$3::uuid,'team-owner')",
          randomUUID(),
          team,
          actor.userId,
        );
        await sql(
          'UPDATE website SET user_id=NULL,team_id=$2::uuid WHERE website_id=$1::uuid',
          website,
          team,
        );
        const input = await source(),
          id = await batch(input);
        const blocker = await connect(),
          observer = await connect();
        let task: Worker;
        try {
          await blocker.query('BEGIN');
          const {
            rows: [{ pid }],
          } = await blocker.query('SELECT pg_backend_pid() AS pid');
          await blocker.query('SELECT id FROM liekan_ingest_batch WHERE id=$1::uuid FOR UPDATE', [
            id,
          ]);
          task = worker(id);
          await waiting(observer, task.name, pid);
          await expect(
            observer.query('SELECT user_id FROM "user" WHERE user_id=$1::uuid FOR UPDATE NOWAIT', [
              actor.userId,
            ]),
          ).rejects.toMatchObject({ code: '55P03' });
          await expect(
            observer.query(
              'SELECT team_user_id FROM team_user WHERE team_id=$1::uuid AND user_id=$2::uuid FOR UPDATE NOWAIT',
              [team, actor.userId],
            ),
          ).rejects.toMatchObject({ code: '55P03' });
          await expect(
            observer.query('SELECT team_id FROM team WHERE team_id=$1::uuid FOR UPDATE NOWAIT', [
              team,
            ]),
          ).rejects.toMatchObject({ code: '55P03' });
        } finally {
          await blocker.query('ROLLBACK');
          await blocker.end();
          await observer.end();
          if (task) expect(await task.done).toEqual({ ok: true });
        }
        const next = await batch(input);
        expect(
          await managerBeforeBatch(next, tx =>
            tx.query('DELETE FROM team_user WHERE team_id=$1::uuid AND user_id=$2::uuid', [
              team,
              actor.userId,
            ]),
          ),
        ).toMatchObject({ ok: false, status: 403 });
        expect(await counts()).toEqual({
          logs: 1,
          effective: 1,
          geography: 1,
          evidence: 1,
          imports: 1,
          revision: 1,
        });
      } finally {
        await sql(
          'UPDATE website SET user_id=$2::uuid,team_id=NULL WHERE website_id=$1::uuid',
          website,
          actor.userId,
        );
        await sql('DELETE FROM team WHERE team_id=$1::uuid', team);
      }
    }, 30000);

    it('serializes repair activation and preserves pre-boundary pending and post-boundary captured scopes', async () => {
      const input = await source(),
        id = await batch(input),
        run = randomUUID(),
        generation = randomUUID(),
        scope = randomUUID();
      expect(
        await managerBeforeBatch(id, tx =>
          tx.query(
            `INSERT INTO liekan_history_repair_run(id,website_id,campaign_id,actor_id,status,generation,repair_scope_id,snapshot,locale)
        VALUES($1::uuid,$2::uuid,'traffic-quality-repair-20261022-v1',$3::uuid,'running',$4::uuid,$5::uuid,'{}','en-US')`,
            [run, website, actor.userId, generation, scope],
          ),
        ),
      ).toEqual({ ok: true });
      expect(
        (await q('SELECT repair_scope_id FROM liekan_import WHERE id=$1::uuid', id))[0],
      ).toEqual({ repair_scope_id: null });
      expect(
        (await q('SELECT scope_changed FROM liekan_history_repair_run WHERE id=$1::uuid', run))[0],
      ).toEqual({ scope_changed: false });
      const next = await batch(input);
      expect(
        (await q('SELECT repair_scope_id FROM liekan_ingest_batch WHERE id=$1::uuid', next))[0],
      ).toEqual({ repair_scope_id: scope });
      expect(await worker(next).done).toEqual({ ok: true });
      expect(
        (await q('SELECT repair_scope_id FROM liekan_import WHERE id=$1::uuid', next))[0],
      ).toEqual({ repair_scope_id: scope });
      expect(
        (await q('SELECT scope_changed FROM liekan_history_repair_run WHERE id=$1::uuid', run))[0],
      ).toEqual({ scope_changed: false });
      expect(await counts()).toEqual({
        logs: 2,
        effective: 2,
        geography: 2,
        evidence: 2,
        imports: 2,
        revision: 2,
      });
    }, 30000);
  },
);
