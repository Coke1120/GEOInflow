import 'dotenv/config';
import { createHash } from 'node:crypto';
import { PgBoss, getConstructionPlans } from 'pg-boss';
import pg from 'pg';

const schema = new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public';
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('Invalid business schema');
const checksum = createHash('sha256').update(getConstructionPlans('liekan_jobs')).digest('hex');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const boss = new PgBoss({
  connectionString: process.env.DATABASE_URL,
  schema: 'liekan_jobs',
  migrate: true,
  schedule: false,
  supervise: false,
  max: 2,
});
boss.on('error', () => console.error('Queue bootstrap connection failed'));
try {
  await client.connect();
  await client.query('SELECT pg_advisory_lock(12800002)');
  await client.query(`SET search_path TO "${schema}"`);
  const old = (
    await client.query(
      "SELECT package_version,checksum FROM liekan_queue_installation WHERE id='liekan_jobs'",
    )
  ).rows[0];
  if (old && (old.package_version !== '12.36.0' || old.checksum !== checksum))
    throw new Error('Queue version changed; a controlled migration is required');
  await boss.start();
  await boss.createQueue('liekan-dead-letter', { retentionSeconds: 7 * 86400 });
  try {
    await boss.createQueue('liekan-analytics-refresh', {
      policy: 'exclusive',
      retryLimit: 2,
      retryDelay: 5,
      retryBackoff: false,
      expireInSeconds: 45,
      retentionSeconds: 3600,
      deleteAfterSeconds: 86400,
    });
  } catch {
    console.error('Analytics preheat unavailable; foreground reads remain enabled');
  }
  for (const name of ['liekan-log-ingest', 'liekan-provider-maintenance', 'liekan-range-refresh']) {
    await boss.createQueue(name, {
      retryLimit: 12,
      retryDelay: 5,
      retryBackoff: true,
      expireInSeconds: 120,
      retentionSeconds: 7 * 86400,
      deadLetter: 'liekan-dead-letter',
    });
  }
  for (const name of ['liekan-crawler-analysis', 'liekan-crawler-check', 'liekan-crawler-control'])
    await boss.createQueue(name, {
      policy: 'short',
      retryLimit: 2,
      retryDelay: 5,
      expireInSeconds: 300,
      retentionSeconds: 3600,
    });
  await client.query(
    "INSERT INTO liekan_queue_installation(id,package_version,checksum) VALUES ('liekan_jobs','12.36.0',$1) ON CONFLICT DO NOTHING",
    [checksum],
  );
  console.log('Liekan fixed queues initialized');
} catch {
  console.error('Liekan queue initialization failed; verify migrations and pinned queue version');
  process.exitCode = 1;
} finally {
  await boss.stop().catch(() => {});
  await client.end().catch(() => {});
}
