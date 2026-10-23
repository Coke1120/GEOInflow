import type { PgBoss } from 'pg-boss';
import { analysisTransaction } from './analysis-rollups-db';
import { withAnalysisPermit } from './analysis-background';
import { runOneAnalysisWorkUnit } from './analysis-rollups-worker';
import { ANALYSIS_BUILD_QUEUE } from './analysis-query-model';

export async function pumpAnalysisBuilds(boss: Pick<PgBoss, 'send'>) {
  const rows = await analysisTransaction(async tx => {
    await tx.$executeRawUnsafe(`UPDATE liekan_analysis_background_lease SET
     incremental_waiting_at=(SELECT min(b.updated_at) FROM liekan_analysis_build b JOIN liekan_analysis_site s ON s.website_id=b.website_id AND s.epoch=b.epoch
      WHERE s.mode='live' AND b.actor_id IS NULL AND b.status IN('queued','running') AND b.next_attempt_at<=clock_timestamp() AND (b.lease_until IS NULL OR b.lease_until<=clock_timestamp())),
     history_waiting_at=(SELECT min(b.created_at) FROM liekan_analysis_build b JOIN liekan_analysis_site s ON s.website_id=b.website_id AND s.epoch=b.epoch
      WHERE s.mode='live' AND b.actor_id IS NOT NULL AND b.status IN('queued','running') AND b.next_attempt_at<=clock_timestamp() AND (b.lease_until IS NULL OR b.lease_until<=clock_timestamp())
      AND NOT EXISTS(SELECT 1 FROM liekan_history_repair_run WHERE status IN('queued','scanning','preparing','running','validating'))) WHERE id`);
    return tx.$queryRawUnsafe<{ id: string; actor_id: string | null }[]>(`WITH per_site AS (
      SELECT DISTINCT ON(b.website_id,(b.actor_id IS NOT NULL)) b.id,b.actor_id,b.website_id,b.updated_at,
       CASE WHEN b.actor_id IS NULL THEN s.incremental_served_at ELSE s.history_served_at END AS served_at
      FROM liekan_analysis_build b JOIN liekan_analysis_site s ON s.website_id=b.website_id AND s.epoch=b.epoch
      WHERE s.mode='live' AND b.status IN('queued','running') AND (b.lease_until IS NULL OR b.lease_until<=clock_timestamp()) AND b.next_attempt_at<=clock_timestamp()
       AND (b.actor_id IS NULL OR NOT EXISTS(SELECT 1 FROM liekan_history_repair_run WHERE status IN('queued','scanning','preparing','running','validating')))
      ORDER BY b.website_id,(b.actor_id IS NOT NULL),b.updated_at,b.id
     ), ranked AS (SELECT *,row_number() OVER(PARTITION BY (actor_id IS NOT NULL) ORDER BY served_at NULLS FIRST,updated_at,website_id) AS kind_rank FROM per_site)
     SELECT id,actor_id FROM ranked ORDER BY kind_rank,(actor_id IS NOT NULL),served_at NULLS FIRST,updated_at,website_id LIMIT 8`);
  });
  for (const row of rows)
    await boss.send(
      ANALYSIS_BUILD_QUEUE,
      { id: row.id, kind: row.actor_id ? 'history' : 'incremental' },
      {
        singletonKey: row.id,
        retryLimit: 0,
        expireInSeconds: 120,
        retentionSeconds: 60,
        deleteAfterSeconds: 3600,
      },
    );
}
export async function processAnalysisBuild(
  _id: string,
  kind: 'history' | 'incremental',
  options: { shouldStop?: () => boolean } = {},
) {
  const deadline = Date.now() + 2000;
  let completed = 0;
  while (completed < 32 && Date.now() < deadline && !options.shouldStop?.()) {
    // Revalidate admission, including repair pause, even for an already delivered queue message.
    const [candidate] = await analysisTransaction(tx =>
      tx.$queryRawUnsafe<{ id: string; website_id: string; epoch: bigint }[]>(
        `SELECT b.id,b.website_id,b.epoch FROM liekan_analysis_build b JOIN liekan_analysis_site s ON s.website_id=b.website_id AND s.epoch=b.epoch
       WHERE s.mode='live' AND b.status IN('queued','running')
       AND (b.lease_until IS NULL OR b.lease_until<=clock_timestamp()) AND b.next_attempt_at<=clock_timestamp()
       AND ((b.actor_id IS NULL AND $1='incremental') OR (b.actor_id IS NOT NULL AND $1='history'))
       AND ($1<>'history' OR NOT EXISTS(SELECT 1 FROM liekan_history_repair_run WHERE status IN('queued','scanning','preparing','running','validating')))
       ORDER BY CASE $1 WHEN 'incremental' THEN s.incremental_served_at ELSE s.history_served_at END NULLS FIRST,b.updated_at,b.website_id,b.id LIMIT 1`,
        kind,
      ),
    );
    if (!candidate || options.shouldStop?.()) break;
    const result = await withAnalysisPermit(kind, async (owned, lease) => {
      if (!owned() || options.shouldStop?.()) return { worked: false };
      const served = await analysisTransaction(tx =>
        tx.$executeRawUnsafe(
          `UPDATE liekan_analysis_site SET incremental_served_at=CASE WHEN $3='incremental' THEN clock_timestamp() ELSE incremental_served_at END,
         history_served_at=CASE WHEN $3='history' THEN clock_timestamp() ELSE history_served_at END
         WHERE website_id=$1::uuid AND epoch=$2::bigint AND mode='live'`,
          candidate.website_id,
          String(candidate.epoch),
          kind,
        ),
      );
      if (!served || !owned() || options.shouldStop?.()) return { worked: false };
      return runOneAnalysisWorkUnit(candidate.id, lease);
    });
    if (!result.acquired || !result.value.worked) break;
    completed++;
    // Durable per-kind service times rotate sites; each selected site serves its oldest job.
  }
  return { completedUnits: completed };
}
