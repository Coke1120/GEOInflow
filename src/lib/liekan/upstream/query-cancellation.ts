import { Pool } from 'pg';
import { processSingleton } from './process-singleton';
const cancellationPool = () =>
  processSingleton('traffic-cancellation-pool', () => {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 1000,
      idleTimeoutMillis: 1000,
      allowExitOnIdle: true,
      statement_timeout: 1000,
      query_timeout: 1500,
    });
    pool.on('error', () => {
      console.error('traffic_evidence_cancellation_connection_error');
    });
    return pool;
  });
import type { AiTx } from './ai-db';
import { LiekanError } from './errors';
/** Fence cancellation to the exact backend transaction, including after connection reuse. */
export async function cancellableEvidence<T>(
  tx: AiTx,
  signal: AbortSignal | undefined,
  work: () => Promise<T>,
): Promise<T> {
  if (!signal) return work();
  if (signal.aborted) throw new LiekanError('统计读取已取消', 499);
  const [identity] = await tx.query(
    'SELECT pid,backend_start::text AS backend,xact_start::text AS transaction FROM pg_stat_activity WHERE pid=pg_backend_pid()',
  );
  let finished = false,
    cancellation: Promise<unknown> | undefined;
  const cancel = () => {
    if (finished || cancellation) return;
    cancellation = cancellationPool()
      .query(
        `SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE pid=$1 AND backend_start=$2::timestamptz AND xact_start=$3::timestamptz AND datname=current_database() AND usename=current_user`,
        [identity.pid, identity.backend, identity.transaction],
      )
      .catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    const result = await work();
    if (signal.aborted) throw new LiekanError('统计读取已取消', 499);
    return result;
  } catch (error) {
    if (signal.aborted) throw new LiekanError('统计读取已取消', 499);
    throw error;
  } finally {
    finished = true;
    signal.removeEventListener('abort', cancel);
    await cancellation;
  }
}
