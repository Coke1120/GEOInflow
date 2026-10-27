import {
  analysisPermitTable,
  withinAnalysisPermit,
  type AnalysisPermit,
} from './analysis-permit-context';
import { randomUUID } from 'node:crypto';
import { dashboardAnalysisWorkSql } from './dashboard-demand';
import { analysisTransaction } from './analysis-rollups-db';
import { analysisBuildWaitingSql } from './analysis-rollups-model';

export type AnalysisWorkKind = 'interactive' | 'incremental' | 'history' | 'preheat' | 'dashboard';
/** Database leases bound concurrent analysis across worker processes. Waiting holds no connection. */
export async function withAnalysisPermit<T>(
  kind: AnalysisWorkKind,
  work: (owned: () => boolean, lease: AnalysisPermit) => Promise<T>,
) {
  const token = randomUUID();
  const table = analysisPermitTable({
    token,
    epoch: '',
    ...(kind === 'dashboard' ? { lane: 'dashboard' as const } : {}),
  });
  const acquired = await analysisTransaction(async tx => {
    if (kind === 'dashboard') {
      const [row] = await tx.$queryRawUnsafe<{ epoch: bigint }[]>(
        `WITH slot AS(SELECT id FROM liekan_analysis_dashboard_lease WHERE id FOR UPDATE SKIP LOCKED)
         UPDATE liekan_analysis_dashboard_lease SET token=$1::uuid,epoch=epoch+1,
         lease_until=clock_timestamp()+interval '90 seconds'
         WHERE id IN(SELECT id FROM slot) AND (lease_until IS NULL OR lease_until<=clock_timestamp()) RETURNING epoch`,
        token,
      );
      return row;
    }
    const [row] = await tx.$queryRawUnsafe<{ epoch: bigint }[]>(
      `WITH slot AS(SELECT id FROM liekan_analysis_background_lease WHERE id FOR UPDATE SKIP LOCKED)
       UPDATE liekan_analysis_background_lease SET token=$1::uuid,epoch=epoch+1,
       lease_until=clock_timestamp()+interval '90 seconds',
       interactive_turns=CASE WHEN $2='interactive' THEN interactive_turns+1 WHEN $2='history' THEN 0 ELSE interactive_turns END,
       last_incremental_at=CASE WHEN $2='incremental' THEN clock_timestamp() ELSE last_incremental_at END,
       incremental_waiting_at=CASE WHEN $2='incremental' THEN NULL ELSE incremental_waiting_at END,
       history_waiting_at=CASE WHEN $2='history' THEN NULL ELSE history_waiting_at END
       WHERE id IN(SELECT id FROM slot) AND (lease_until IS NULL OR lease_until<=clock_timestamp())
       AND ($2='incremental' OR incremental_waiting_at IS NULL OR incremental_waiting_at>clock_timestamp()-interval '30 seconds')
       AND ($2 IN('history','incremental') OR history_waiting_at IS NULL OR interactive_turns<5)
       AND ($2<>'history' OR interactive_turns>=5 OR (NOT EXISTS(SELECT 1 FROM liekan_analysis_query q WHERE q.status IN('queued','running') AND NOT ${dashboardAnalysisWorkSql}) AND NOT EXISTS(SELECT 1 FROM liekan_geo_weight_head WHERE task_status IN('queued','running'))))
       AND ($2<>'incremental' OR incremental_waiting_at<=clock_timestamp()-interval '30 seconds' OR (NOT EXISTS(SELECT 1 FROM liekan_analysis_query q WHERE q.status IN('queued','running') AND NOT ${dashboardAnalysisWorkSql}) AND NOT EXISTS(SELECT 1 FROM liekan_geo_weight_head WHERE task_status IN('queued','running'))))
       AND ($2<>'preheat' OR NOT EXISTS(SELECT 1 FROM liekan_analysis_query q WHERE q.status IN('queued','running') AND NOT ${dashboardAnalysisWorkSql})
          AND NOT EXISTS(SELECT 1 FROM liekan_geo_weight_head WHERE task_status IN('queued','running'))
          AND incremental_waiting_at IS NULL AND history_waiting_at IS NULL)
       RETURNING epoch`,
      token,
      kind,
    );
    return row;
  });
  if (!acquired) return { acquired: false as const };
  let owned = true,
    renewing = false;
  const renewal = setInterval(async () => {
    if (renewing || !owned) return;
    renewing = true;
    try {
      owned = !!(await analysisTransaction(tx =>
        tx.$executeRawUnsafe(
          `UPDATE ${table} SET lease_until=clock_timestamp()+interval '90 seconds'
         WHERE id AND token=$1::uuid AND epoch=$2::bigint AND lease_until>clock_timestamp()`,
          token,
          acquired.epoch,
        ),
      ));
    } catch {
      owned = false;
    } finally {
      renewing = false;
    }
  }, 15000);
  const lease: AnalysisPermit = {
    token,
    epoch: String(acquired.epoch),
    ...(kind === 'dashboard' ? { lane: 'dashboard' as const } : {}),
  };
  try {
    return {
      acquired: true as const,
      value: await withinAnalysisPermit(lease, () => work(() => owned, lease)),
    };
  } finally {
    clearInterval(renewal);
    owned = false;
    // Preserve remaining runnable demand before the next bounded unit checks fairness.
    const waiting =
      kind === 'incremental' || kind === 'history'
        ? `,${kind}_waiting_at=${analysisBuildWaitingSql[kind]}`
        : '';
    await analysisTransaction(tx =>
      tx.$executeRawUnsafe(
        `UPDATE ${table} SET token=NULL,lease_until=NULL${waiting} WHERE id AND token=$1::uuid AND epoch=$2::bigint`,
        token,
        acquired.epoch,
      ),
    );
  }
}
