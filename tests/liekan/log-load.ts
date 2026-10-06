import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import { PgBoss } from 'pg-boss';
import { Client } from 'pg';
import prisma from '../../src/lib/prisma';
import { query, transaction } from '../../src/lib/liekan/upstream/server';
import { readPageReport } from '../../src/lib/liekan/upstream/page-report';
import {
  createSource,
  heartbeat,
  receiveBatch,
  processBatch,
} from '../../src/lib/liekan/log-ingestion/service';
import { getQueue, QUEUE_SCHEMA, LOG_QUEUE } from '../../src/lib/liekan/log-ingestion/queue';

// The runner creates and deletes a dedicated database. Synthetic traffic stays in that database.
const database = new URL(process.env.DATABASE_URL).pathname.slice(1);
assert.match(database, /^liekan_log_test_[a-f0-9]{32}$/);
const sqlProfile = new Map<string, { calls: number; totalMs: number; maxMs: number }>();
if (process.env.LIEKAN_LOG_LOAD_PROFILE === '1')
  (prisma.client as any).$on('query', (event: { query: string; duration: number }) => {
    const key = event.query.replace(/\s+/g, ' ').slice(0, 140);
    const old = sqlProfile.get(key) || { calls: 0, totalMs: 0, maxMs: 0 };
    old.calls++;
    old.totalMs += event.duration;
    old.maxMs = Math.max(old.maxMs, event.duration);
    sqlProfile.set(key, old);
  });
const userId = randomUUID(),
  websiteId = randomUUID();
await prisma.client.user.create({
  data: { id: userId, username: 'load-test', password: 'disabled-test-login', role: 'admin' },
});
await prisma.client.website.create({
  data: { id: websiteId, userId, domain: 'example.com', name: 'Isolated capacity test' },
});
const { source, token } = await transaction(tx =>
  createSource(tx, websiteId, 'server', { userId }),
);
await heartbeat(source.id, token, {
  version: '1',
  pending: 0,
  bytes: 0,
  gap: false,
  errorCode: 'none',
});
const boss = new PgBoss({
  connectionString: process.env.DATABASE_URL,
  schema: QUEUE_SCHEMA,
  migrate: false,
  max: 8,
  schedule: false,
  supervise: true,
});
boss.on('error', () => {});
await boss.start();
let processingErrors = 0;
const monitor = new Client({ connectionString: process.env.DATABASE_URL });
await monitor.connect();
await boss.work<{ batchId: string }>(
  LOG_QUEUE,
  { localConcurrency: 4, batchSize: 1, pollingIntervalSeconds: 1 },
  async jobs => {
    for (const job of jobs) {
      try {
        await processBatch(job.data.batchId);
      } catch {
        processingErrors++;
        throw new Error('Capacity test processing failure');
      }
    }
  },
);
await delay(1100);
const durations = (process.env.LIEKAN_LOG_LOAD_DURATIONS || '900,60').split(',').map(Number);
assert.equal(durations.length, 2);
assert(durations.every(n => Number.isInteger(n) && n > 0 && n <= 900));
const generation = randomUUID(),
  startedAt = Date.now();
let sequence = 0,
  received = 0,
  refused = 0,
  rejectedEvents = 0,
  maxConnections = 0,
  peakRss = 0,
  pageErrors = 0,
  skippedPageProbes = 0;
const receiveErrors: Record<string, number> = {};
const producers = new Set<Promise<number | null>>();
let pageProbe: Promise<void> | undefined;
const pageLatencies: number[] = [],
  phases: any[] = [];
const percentile = (values: number[], fraction: number) =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * fraction))
  ] || 0;
async function send() {
  const start = performance.now(),
    offset = sequence++ * 1000,
    now = new Date();
  const timestamp = `${String(now.getUTCDate()).padStart(2, '0')}/${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][now.getUTCMonth()]}/${now.getUTCFullYear()}:${now.toISOString().slice(11, 19)} +0000`;
  const events = Array.from({ length: 1000 }, (_, i) => ({
    generation,
    offset: offset + i,
    line: `192.0.2.5 - - [${timestamp}] "GET /load/${i % 100} HTTP/1.1" 200 25 "-" "GPTBot"`,
  }));
  try {
    const requestId = randomUUID();
    const ack: any = await receiveBatch(
      new Request('https://logs.example/upload', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ version: 1, epoch: 1, batchId: requestId, events }),
      }),
      source.id,
    );
    rejectedEvents += Number(ack.rejected) || 0;
    assert.equal(ack.requestBatchId, requestId);
    assert.equal(ack.epoch, 1);
    assert.equal(ack.received, events.length);
    assert.equal(ack.valid, events.length);
    assert.equal(ack.rejected, 0);
    received += ack.valid;
    return performance.now() - start;
  } catch (error: any) {
    const category = String(error?.status || error?.code || error?.name || 'unknown');
    receiveErrors[category] = (receiveErrors[category] || 0) + 1;
    refused += events.length;
    return null;
  }
}
async function sample() {
  const start = performance.now();
  try {
    const connections = (
      await monitor.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1', [
        database,
      ])
    ).rows[0].n;
    maxConnections = Math.max(maxConnections, connections);
    await readPageReport(
      { id: websiteId, name: 'Isolated capacity test', domain: 'example.com' },
      {
        resource: 'ai/bots',
        startAt: startedAt - 86400000,
        endAt: Date.now() + 60000,
        timezone: 'UTC',
      },
    );
    pageLatencies.push(performance.now() - start);
  } catch {
    pageErrors++;
  }
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}
function startPageProbe() {
  if (pageProbe) {
    skippedPageProbes++;
    return;
  }
  pageProbe = sample().finally(() => {
    pageProbe = undefined;
  });
}

try {
  let burstDispatchEndedAt = performance.now();
  for (const [index, seconds] of durations.entries()) {
    const batchesPerSecond = index ? 10 : 1,
      phaseStart = performance.now(),
      before = received,
      beforeRefused = refused;
    let lastDispatch = phaseStart,
      maxScheduleLagMs = 0;
    const tasks: Promise<number | null>[] = [];
    for (let tick = 0; tick < seconds * batchesPerSecond; tick++) {
      await delay(Math.max(0, phaseStart + (tick * 1000) / batchesPerSecond - performance.now()));
      lastDispatch = performance.now();
      maxScheduleLagMs = Math.max(
        maxScheduleLagMs,
        lastDispatch - phaseStart - (tick * 1000) / batchesPerSecond,
      );
      const task = send();
      producers.add(task);
      void task.finally(() => producers.delete(task));
      tasks.push(task);
      if (tick % (30 * batchesPerSecond) === 0) {
        startPageProbe();
        console.log(
          `Capacity phase ${index + 1}: ${Math.floor(tick / batchesPerSecond)}/${seconds}s; accepted ${received}; refused ${refused}`,
        );
      }
    }
    await delay(Math.max(0, phaseStart + seconds * 1000 - performance.now()));
    if (index === 1) burstDispatchEndedAt = performance.now();
    const latencies = (await Promise.all(tasks)).filter((n): n is number => n !== null);
    phases.push({
      expectedEvents: seconds * batchesPerSecond * 1000,
      dispatchWindowMs: lastDispatch - phaseStart + 1000 / batchesPerSecond,
      maxScheduleLagMs,
      observedEventsPerSecond:
        (seconds * batchesPerSecond * 1000) /
        Math.max(seconds, (lastDispatch - phaseStart) / 1000 + 1 / batchesPerSecond),
      targetEventsPerSecond: batchesPerSecond * 1000,
      seconds,
      received: received - before,
      refused: refused - beforeRefused,
      ackP95Ms: percentile(latencies, 0.95),
      ackMaxMs: Math.max(...latencies),
      elapsedSeconds: (performance.now() - phaseStart) / 1000,
    });
  }
  const drainStart = burstDispatchEndedAt;
  let backlog = 0;
  do {
    backlog = (
      await query("SELECT count(*)::int AS n FROM liekan_ingest_batch WHERE state='pending'")
    )[0].n;
    if (!backlog) break;
    await delay(1000);
  } while (performance.now() - drainStart < 600000);
  const drainSeconds = (performance.now() - drainStart) / 1000;
  await pageProbe;
  await sample();
  const stored = (
    await query('SELECT count(*)::int AS n FROM liekan_log WHERE website_id=$1::uuid', websiteId)
  )[0].n;
  const failed = (
    await query("SELECT count(*)::int AS n FROM liekan_ingest_batch WHERE state='failed'")
  )[0].n;
  const result = {
    mode: 'coreInProcess',
    sqlProfile: [...sqlProfile]
      .map(([query, value]) => ({ query, ...value, averageMs: value.totalMs / value.calls }))
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, 20),
    schedulingToleranceMs: 500,
    resourceSampling: 'observed maxima at report probes',
    phases,
    received,
    refused,
    rejectedEvents,
    stored,
    backlog,
    failed,
    processingErrors,
    receiveErrors,
    pageErrors,
    pageProbes: pageLatencies.length,
    skippedPageProbes,
    drainSeconds,
    pageP95Ms: percentile(pageLatencies, 0.95),
    maxConnections,
    peakRssMiB: peakRss / 1024 / 1024,
    passed:
      !refused &&
      !rejectedEvents &&
      !pageErrors &&
      phases.length === 2 &&
      !failed &&
      !backlog &&
      drainSeconds <= 600 &&
      stored === received &&
      phases.every(
        p =>
          p.received === p.expectedEvents &&
          p.ackP95Ms <= 2000 &&
          p.maxScheduleLagMs <= 500 &&
          p.dispatchWindowMs <= p.seconds * 1000 + 500,
      ),
  };
  await writeFile(
    'outputs/automatic-log-implementation-20261004/capacity.json',
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(JSON.stringify(result));
  assert(result.passed, 'Measured capacity did not meet the initial target');
} finally {
  await Promise.allSettled([...producers]);
  await pageProbe;
  await monitor.end();
  await boss.stop({ graceful: true, timeout: 30000 });
  await (await getQueue()).stop();
  await prisma.client.$disconnect();
}
