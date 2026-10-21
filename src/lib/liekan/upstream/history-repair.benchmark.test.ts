// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
const enabled = process.env.LIEKAN_HISTORY_REPAIR_BENCHMARK === '1';
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const p95 = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)];
describe.skipIf(!enabled)('owned large-history work-unit benchmark', () => {
  it('samples one-million and ten-million histories with live collection and durable checkpoints', async () => {
    const url = new URL(process.env.DATABASE_URL || 'http://invalid');
    const schema = url.searchParams.get('schema');
    if (
      url.hostname !== '127.0.0.1' ||
      url.port !== '15460' ||
      url.pathname !== '/liekan_history_repair_test' ||
      !/^history_[a-f0-9]+$/.test(schema || '')
    )
      throw new Error('Owned benchmark database required');
    const { Client } = await import('pg');
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await db.query(`SET search_path TO "${schema}"`);
    const { default: prisma } = await import('@/lib/prisma');
    const { getQueue } = await import('../log-ingestion/queue');
    const { scanHistoryRepair, getHistoryRepair, processHistoryRepairJob, actHistoryRepair } =
      await import('./history-repair');
    const { collectionWriteClient, recordEventQuality, withCollectionWrite } = await import(
      './collection-write'
    );
    const actor = { userId: randomUUID() },
      site = randomUUID(),
      session = randomUUID();
    const results: any[] = [];
    try {
      await db.query(
        `INSERT INTO "user"(user_id,username,password,role) VALUES($1::uuid,$2,'benchmark-fixture','user')`,
        [actor.userId, actor.userId],
      );
      await db.query(
        `INSERT INTO website(website_id,user_id,name,domain) VALUES($1,$2,'Isolated size benchmark','benchmark.example')`,
        [site, actor.userId],
      );
      await db.query('INSERT INTO session(session_id,website_id) VALUES($1,$2)', [session, site]);
      await db.query(
        'UPDATE liekan_history_repair_campaign SET eligible_websites=array_append(eligible_websites,$1::uuid)',
        [site],
      );
      const heartbeat = () =>
        db.query(
          "INSERT INTO liekan_worker_state(id,version) VALUES('benchmark-worker','history-repair-v1.1') ON CONFLICT(id) DO UPDATE SET heartbeat_at=clock_timestamp(),version=EXCLUDED.version",
        );
      const read = () => getHistoryRepair(site, new URLSearchParams(), actor);
      const collect = async () => {
        const id = randomUUID();
        await withCollectionWrite(
          {
            websiteId: site,
            fingerprint: 'isolated-benchmark',
            quality: {
              classification: 'browser',
              source: 'browser',
              reasons: [],
              ruleVersion: 'traffic-quality-v3',
              rangeVersion: null,
              rangeStatus: 'missing',
              hostname: 'benchmark.example',
            },
          },
          async () => {
            const tx = collectionWriteClient();
            await tx.$executeRawUnsafe(
              "INSERT INTO website_event(event_id,website_id,session_id,visit_id,event_type,created_at,url_path,hostname) VALUES($1::uuid,$2::uuid,$3::uuid,$3::uuid,1,clock_timestamp(),'/live','benchmark.example')",
              id,
              site,
              session,
            );
            await recordEventQuality(tx, id, site);
          },
        );
      };
      const sample = async (done: () => boolean) => {
        const values: number[] = [],
          start = Date.now();
        while (!done() || values.length < 100 || Date.now() - start < 3000) {
          const at = performance.now();
          await collect();
          values.push(performance.now() - at);
          await pause(10);
        }
        return { count: values.length, p95: p95(values), max: Math.max(...values) };
      };
      let seeded = 0;
      for (const size of [1000000, 10000000]) {
        // Only fixture construction bypasses the per-row boundary trigger; measured intake uses it.
        await db.query(
          'ALTER TABLE liekan_event_quality DISABLE TRIGGER liekan_history_quality_boundary',
        );
        try {
          for (let from = seeded + 1; from <= size; from += 100000) {
            const to = Math.min(size, from + 99999);
            await db.query(
              "INSERT INTO website_event(event_id,website_id,session_id,visit_id,event_type,created_at,url_path,hostname) SELECT md5('size-benchmark:'||i)::uuid,$1,$2,$2,1,'2020-01-01'::timestamptz+i*interval '1 microsecond','/history','benchmark.example' FROM generate_series($3::integer,$4::integer)i",
              [site, session, from, to],
            );
            await db.query(
              "INSERT INTO liekan_event_quality(event_id,website_id,classification,source,reasons,rule_version,range_status,hostname) SELECT md5('size-benchmark:'||i)::uuid,$1,'unknown','browser',ARRAY['ua_unrecognized'],'traffic-quality-v3','missing','benchmark.example' FROM generate_series($2::integer,$3::integer)i",
              [site, from, to],
            );
          }
        } finally {
          await db.query(
            'ALTER TABLE liekan_event_quality ENABLE TRIGGER liekan_history_quality_boundary',
          );
        }
        seeded = size;
        await db.query('ANALYZE website_event');
        await db.query('ANALYZE liekan_event_quality');
        const baseline = await sample(() => true);
        await heartbeat();
        const run = await scanHistoryRepair(
          site,
          { actionId: randomUUID(), timezone: 'UTC' },
          actor,
        );
        const units: number[] = [];
        let finished = false;
        const intake = sample(() => finished);
        const initialMemory = process.memoryUsage().heapUsed;
        try {
          for (let step = 0; step < 20; step++) {
            await heartbeat();
            const at = performance.now();
            await processHistoryRepairJob({ runId: run.id });
            units.push(performance.now() - at);
            const current = (await read()).run;
            expect(current.status, current.errorCode || 'work-unit state').not.toMatch(
              /failed|invalidated/,
            );
            expect(current.errorCode).toBeNull();
          }
        } finally {
          finished = true;
        }
        const concurrent = await intake;
        const current = (await read()).run;
        expect(BigInt(current.counts.processed)).toBeGreaterThan(0n);
        expect(current.scopeChanged).toBe(false);
        expect(concurrent.p95).toBeLessThanOrEqual(baseline.p95 * 1.2 + 50);
        const paused = await actHistoryRepair(
          site,
          {
            runId: run.id,
            actionId: randomUUID(),
            expectedRevision: current.revision,
            action: 'pause',
          },
          actor,
        );
        await processHistoryRepairJob({ runId: run.id });
        expect((await read()).run.counts.processed).toBe(current.counts.processed);
        await actHistoryRepair(
          site,
          {
            runId: run.id,
            actionId: randomUUID(),
            expectedRevision: paused.revision,
            action: 'cancel',
          },
          actor,
        );
        results.push({
          historicalRows: size,
          baseline,
          concurrent,
          workUnits: units.length,
          workUnitP95: p95(units),
          workUnitMax: Math.max(...units),
          processed: current.counts.processed,
          heapDeltaBytes: process.memoryUsage().heapUsed - initialMemory,
        });
        await writeFile(
          join(process.env.LIEKAN_HISTORY_REPAIR_OUTPUT, 'benchmark.json'),
          JSON.stringify({ kind: 'sampled-work-units', results }, null, 2),
        );
        // Each size sample starts from a fresh boundary inside the owned fixture database.
        if (size === 1000000) {
          await db.query('DELETE FROM liekan_history_repair_run WHERE website_id=$1', [site]);
          await db.query(
            'UPDATE liekan_event_quality SET repair_scope_id=NULL WHERE website_id=$1 AND repair_scope_id IS NOT NULL',
            [site],
          );
        }
      }
    } finally {
      await db.end();
      await (await getQueue()).stop();
      await prisma.client.$disconnect();
    }
  }, 1800000);
});
