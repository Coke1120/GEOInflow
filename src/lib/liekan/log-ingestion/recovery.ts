import { fromPrisma } from 'pg-boss';
import { transaction } from '../upstream/server';
import { enqueue, getQueue, LOG_QUEUE } from './queue';

export async function recoverBatches() {
  const rows = await transaction<any[]>(tx =>
    tx.$queryRawUnsafe(
      `WITH candidates AS (
      SELECT id FROM liekan_ingest_batch WHERE state='pending' AND payload IS NOT NULL
        AND received_at<now()-interval '1 minute'
        AND (last_recovery_at IS NULL OR last_recovery_at<now()-interval '1 minute')
      ORDER BY last_recovery_at NULLS FIRST,received_at LIMIT 100 FOR UPDATE SKIP LOCKED
    ) UPDATE liekan_ingest_batch b SET last_recovery_at=now() FROM candidates c WHERE b.id=c.id RETURNING b.id`,
    ),
  );
  const boss = await getQueue();
  for (const row of rows) {
    await transaction(async tx => {
      const batch = (
        await tx.$queryRawUnsafe(
          "SELECT id FROM liekan_ingest_batch WHERE id=$1::uuid AND state='pending' AND payload IS NOT NULL FOR UPDATE",
          row.id,
        )
      )[0];
      if (!batch) return;
      const db = fromPrisma(tx);
      const job = await boss.getJobById(LOG_QUEUE, row.id, { db });
      if (job && ['created', 'retry', 'active'].includes(job.state)) return;
      if (job?.state === 'failed') await boss.retry(LOG_QUEUE, row.id, { db });
      else {
        if (job) await boss.deleteJob(LOG_QUEUE, row.id, { db });
        await enqueue(tx, LOG_QUEUE, { batchId: row.id }, row.id);
      }
    });
  }
}
