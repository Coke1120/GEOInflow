import { writeFile } from 'node:fs/promises';
import { PgBoss } from 'pg-boss';
import { QUEUE_SCHEMA } from '../lib/liekan/log-ingestion/queue';
import {
  ANALYTICS_QUEUE,
  type AnalyticsRefreshJob,
  pumpAnalyticsHot,
} from '../lib/liekan/upstream/analytics-hot';
import { analyticsRedis } from '../lib/liekan/upstream/analytics-redis';
import prisma from '../lib/prisma';
import { processAnalyticsRefresh, readAnalyticsHotStrongVersion } from './analytics-refresh';

const boss = new PgBoss({
  connectionString: process.env.DATABASE_URL,
  schema: QUEUE_SCHEMA,
  migrate: false,
  max: 2,
  schedule: false,
  supervise: true,
});
boss.on('error', () => console.error('Liekan analytics queue unavailable'));
let stopped = false,
  pumping = false;
async function pump() {
  if (stopped || pumping) return;
  pumping = true;
  try {
    await pumpAnalyticsHot(boss, readAnalyticsHotStrongVersion);
  } catch {
    /* A maintenance failure leaves persistent hot demand for the next pass. */
  } finally {
    pumping = false;
  }
}
await boss.start();
await boss.work<AnalyticsRefreshJob>(
  ANALYTICS_QUEUE,
  { localConcurrency: 1, batchSize: 1, pollingIntervalSeconds: 1 },
  async jobs => {
    for (const job of jobs) if (!stopped) await processAnalyticsRefresh(job.data);
  },
);
const maintenance = setInterval(() => {
  void pump();
}, 5000);
void pump();
const heartbeat = setInterval(() => {
  void writeFile('/tmp/liekan-analytics-worker-heartbeat', String(Date.now()), { mode: 0o600 });
}, 30000);
await writeFile('/tmp/liekan-analytics-worker-heartbeat', String(Date.now()), { mode: 0o600 });
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    stopped = true;
    clearInterval(maintenance);
    clearInterval(heartbeat);
    await boss.stop({ graceful: true });
    analyticsRedis.close();
    await prisma.client.$disconnect();
    process.exit(0);
  });
