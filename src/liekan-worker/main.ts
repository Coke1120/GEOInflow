import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import prisma from '../lib/prisma';
import { query, transaction, LiekanError } from '../lib/liekan/upstream/server';
import {
  QUEUE_SCHEMA,
  LOG_QUEUE,
  PROVIDER_QUEUE,
  RANGE_QUEUE,
} from '../lib/liekan/log-ingestion/queue';
import { reconcilePermissions } from '../lib/liekan/log-ingestion/maintenance';
import { recoverBatches } from '../lib/liekan/log-ingestion/recovery';
import { processBatch } from '../lib/liekan/log-ingestion/service';
import { maintainCloudflare } from '../lib/liekan/log-ingestion/cloudflare';
import { sealPlatformSecret, openPlatformSecret } from '../lib/liekan/log-ingestion/secrets';
import { refreshRanges } from '../lib/liekan/log-ingestion/ranges';

const workerId = randomUUID();
const boss = new PgBoss({
  connectionString: process.env.DATABASE_URL,
  schema: QUEUE_SCHEMA,
  migrate: false,
  max: 8,
  schedule: false,
  supervise: true,
});
boss.on('error', () => console.error('Liekan worker queue unavailable'));
let stopped = false,
  maintaining = false;
async function provider(sourceId: string, action: 'configure' | 'disconnect' | 'health') {
  // A database lease also fences periodic reconciliation against queued retries and other workers.
  const claim = await transaction<any[]>(tx =>
    tx.$queryRawUnsafe(
      "UPDATE liekan_log_source SET provider_lease=$2::uuid,provider_lease_until=now()+interval '5 minutes',last_maintenance_at=now() WHERE id=$1::uuid AND (provider_lease_until IS NULL OR provider_lease_until<now()) RETURNING id",
      sourceId,
      workerId,
    ),
  );
  if (!claim.length) return;
  try {
    await maintainCloudflare(sourceId, action);
  } catch (error) {
    const code =
      error instanceof LiekanError && [401, 403, 404, 409].includes(error.status)
        ? 'reauthorization-required'
        : 'provider-unavailable';
    await transaction(async tx => {
      await tx.$queryRawUnsafe(
        'SELECT website_id FROM website WHERE website_id=(SELECT website_id FROM liekan_log_source WHERE id=$1::uuid) FOR UPDATE',
        sourceId,
      );
      // Preserve a durable retry state; credentials are never included in diagnostics.
      await tx.$executeRawUnsafe(
        'UPDATE liekan_log_source SET error_code=$2 WHERE id=$1::uuid',
        sourceId,
        code,
      );
      if (code === 'reauthorization-required') {
        await tx.$executeRawUnsafe(
          "UPDATE liekan_log_source SET state='error',credential_hash=NULL WHERE id=$1::uuid AND state!='disconnected'",
          sourceId,
        );
        await tx.$executeRawUnsafe(
          'UPDATE liekan_log_interval SET ends_at=clock_timestamp() WHERE source_id=$1::uuid AND ends_at IS NULL',
          sourceId,
        );
        await tx.$executeRawUnsafe(
          'UPDATE liekan_log_state SET policy_revision=policy_revision+1 WHERE website_id=(SELECT website_id FROM liekan_log_source WHERE id=$1::uuid)',
          sourceId,
        );
      }
    });
    if (code === 'provider-unavailable') throw new Error('Provider temporarily unavailable');
  } finally {
    await transaction(tx =>
      tx.$executeRawUnsafe(
        'UPDATE liekan_log_source SET provider_lease=NULL,provider_lease_until=NULL WHERE id=$1::uuid AND provider_lease=$2::uuid',
        sourceId,
        workerId,
      ),
    );
  }
}
async function recordHealth() {
  await transaction(tx =>
    tx.$executeRawUnsafe(
      'INSERT INTO liekan_worker_state(id,heartbeat_at,version) VALUES($1,now(),$2) ON CONFLICT(id) DO UPDATE SET heartbeat_at=now()',
      workerId,
      '1.0.0',
    ),
  );
  await writeFile('/tmp/liekan-worker-heartbeat', String(Date.now()), { mode: 0o600 });
}
async function reconcile() {
  if (maintaining || stopped) return;
  maintaining = true;
  try {
    await transaction(async tx => {
      await tx.$executeRawUnsafe(
        'INSERT INTO liekan_worker_state(id,heartbeat_at,version) VALUES($1,now(),$2) ON CONFLICT(id) DO UPDATE SET heartbeat_at=now(),version=EXCLUDED.version',
        workerId,
        '1.0.0',
      );
      await tx.$executeRawUnsafe('DELETE FROM liekan_log_grant WHERE expires_at<now()');
      await tx.$executeRawUnsafe(
        "DELETE FROM liekan_ingest_batch WHERE state!='pending' AND received_at<now()-interval '30 days'",
      );
      await tx.$executeRawUnsafe(
        "DELETE FROM liekan_worker_state WHERE heartbeat_at<now()-interval '1 day'",
      );
    });
    const sources = await query(
      "SELECT id,state,credential_hash FROM liekan_log_source WHERE kind='cloudflare' AND provider_config IS NOT NULL ORDER BY last_maintenance_at NULLS FIRST LIMIT 100",
    );
    for (const source of sources) {
      if (stopped) break;
      await provider(
        source.id,
        source.state === 'disconnected' || !source.credential_hash
          ? 'disconnect'
          : source.state === 'configuring'
            ? 'configure'
            : 'health',
      ).catch(() => {});
    }
  } finally {
    maintaining = false;
  }
}
async function main() {
  if (process.argv.includes('--rekey')) {
    await transaction(async tx => {
      for (const row of await tx.$queryRawUnsafe(
        'SELECT id,provider_config FROM liekan_log_source WHERE provider_config IS NOT NULL FOR UPDATE',
      ))
        await tx.$executeRawUnsafe(
          'UPDATE liekan_log_source SET provider_config=$2 WHERE id=$1::uuid',
          row.id,
          sealPlatformSecret(openPlatformSecret(row.provider_config, row.id), row.id),
        );
      for (const row of await tx.$queryRawUnsafe(
        'SELECT id,payload FROM liekan_log_grant WHERE payload IS NOT NULL FOR UPDATE',
      ))
        await tx.$executeRawUnsafe(
          'UPDATE liekan_log_grant SET payload=$2 WHERE id=$1::uuid',
          row.id,
          sealPlatformSecret(openPlatformSecret(row.payload, row.id), row.id),
        );
    });
    await prisma.client.$disconnect();
    console.log('Stored log credentials re-encrypted.');
    return;
  }
  await boss.start();
  await boss.work<{ batchId: string }>(
    LOG_QUEUE,
    { localConcurrency: 4, batchSize: 1, pollingIntervalSeconds: 1 },
    async jobs => {
      for (const job of jobs) {
        try {
          await processBatch(job.data.batchId);
        } catch (error) {
          if (error instanceof LiekanError && [401, 403, 404, 409].includes(error.status)) {
            await transaction(tx =>
              tx.$executeRawUnsafe(
                "UPDATE liekan_ingest_batch SET state='failed',payload=NULL,errors='[{\"reason\":\"source-or-event-invalid\"}]'::jsonb WHERE id=$1::uuid AND state='pending'",
                job.data.batchId,
              ),
            );
          } else throw new Error('Log batch processing failed');
        }
      }
    },
  );
  await boss.work<{ sourceId: string; action: 'configure' | 'disconnect' | 'health' }>(
    PROVIDER_QUEUE,
    { batchSize: 1, pollingIntervalSeconds: 2 },
    async jobs => {
      for (const job of jobs) await provider(job.data.sourceId, job.data.action);
    },
  );
  await boss.work(RANGE_QUEUE, { batchSize: 1 }, async () => {
    await refreshRanges();
  });
  await recordHealth();
  void reconcile().catch(() => console.error('Liekan worker maintenance unavailable'));
  await boss.send(RANGE_QUEUE, {}, { singletonKey: 'official', singletonSeconds: 3600 });
  let checkingPermissions = false;
  let recovering = false;
  const recovery = async () => {
    if (recovering || stopped) return;
    recovering = true;
    try {
      await recoverBatches();
    } finally {
      recovering = false;
    }
  };
  void recovery().catch(() => {});
  const recoveryTimer = setInterval(() => {
    void recovery().catch(() => {});
  }, 30000);
  const permissions = async () => {
    if (checkingPermissions || stopped) return;
    checkingPermissions = true;
    try {
      await reconcilePermissions();
    } finally {
      checkingPermissions = false;
    }
  };
  void permissions().catch(() => {});
  const permissionTimer = setInterval(() => {
    void permissions().catch(() => {});
  }, 15000);
  const health = setInterval(() => {
    void reconcile().catch(() => console.error('Liekan worker maintenance unavailable'));
  }, 30000);
  const heartbeat = setInterval(() => {
    void recordHealth().catch(() => {});
  }, 30000);
  const ranges = setInterval(() => {
    void boss
      .send(RANGE_QUEUE, {}, { singletonKey: 'official', singletonSeconds: 3600 })
      .catch(() => {});
  }, 3600000);
  const shutdown = async () => {
    if (stopped) return;
    stopped = true;
    clearInterval(permissionTimer);
    clearInterval(recoveryTimer);
    clearInterval(health);
    clearInterval(heartbeat);
    clearInterval(ranges);
    await boss.stop({ graceful: true, timeout: 30000 });
    await transaction(tx =>
      tx.$executeRawUnsafe('DELETE FROM liekan_worker_state WHERE id=$1', workerId),
    ).catch(() => {});
    await prisma.client.$disconnect();
  };
  process.on('SIGTERM', () => {
    void shutdown();
  });
  process.on('SIGINT', () => {
    void shutdown();
  });
}
main().catch(async () => {
  console.error('Liekan worker startup failed');
  await boss.stop().catch(() => {});
  await prisma.client.$disconnect();
  process.exitCode = 1;
});
