import type { AnalysisTx } from './analysis-rollups-model';

// These predicates share the q alias across admission, dispatch, claim and permit guards.
export const analysisForegroundDemandSql = `(NOT EXISTS(SELECT 1 FROM liekan_dashboard_snapshot d WHERE d.job_id=q.id)
  OR EXISTS(SELECT 1 FROM liekan_dashboard_snapshot d WHERE d.job_id=q.id
    AND d.last_read_at>clock_timestamp()-interval '2 minutes'))`;
export const dashboardAnalysisWorkSql = `(${analysisForegroundDemandSql} AND
  (q.target='feature:page-report' OR (q.target IN('native:stats','native:pageviews')
    AND (q.attempts=0 OR (q.status='running' AND q.attempts=1)))))`;
export const dashboardRunnableHeadSql = `q.id IN(SELECT id FROM(
  SELECT DISTINCT ON(q.website_id) q.id FROM liekan_analysis_query q
  WHERE q.status='queued' AND q.next_attempt_at<=clock_timestamp()
    AND q.retention_until>clock_timestamp() AND ${dashboardAnalysisWorkSql}
  ORDER BY q.website_id,q.queued_at,q.sequence LIMIT 32) heads)`;
export const foregroundAnalysisQueuedSql = `EXISTS(SELECT 1 FROM liekan_analysis_query q
  WHERE q.status='queued' AND ${analysisForegroundDemandSql})`;
export const coldDashboardPrewarmSql = `(q.target='feature:page-report'
  AND EXISTS(SELECT 1 FROM liekan_dashboard_snapshot d WHERE d.job_id=q.id)
  AND NOT EXISTS(SELECT 1 FROM liekan_dashboard_snapshot d WHERE d.job_id=q.id
    AND (d.result IS NOT NULL OR d.last_read_at>clock_timestamp()-interval '2 minutes')))`;

/** Failed work loses background demand when its last real reader leaves. Cold seeds get one attempt. */
export async function pauseIdleDashboardRetries(tx: AnalysisTx) {
  await tx.$executeRawUnsafe(
    `UPDATE liekan_analysis_query q SET status='failed',error_code='analysis-idle',updated_at=clock_timestamp()
     WHERE ((q.status='queued' AND q.attempts>0)
       OR (q.status='failed' AND q.error_code IS DISTINCT FROM 'analysis-idle'))
     AND EXISTS(SELECT 1 FROM liekan_dashboard_snapshot d WHERE d.job_id=q.id)
     AND NOT EXISTS(SELECT 1 FROM liekan_dashboard_snapshot d WHERE d.job_id=q.id
       AND d.last_read_at>clock_timestamp()-interval '2 minutes')`,
  );
  await tx.$executeRawUnsafe(
    `UPDATE liekan_dashboard_snapshot d SET error_code='dashboard-paused',next_refresh_at='9999-12-31'::timestamptz,
     job_id=NULL,pending_fingerprint=NULL
     WHERE d.last_read_at<=clock_timestamp()-interval '2 minutes'
     AND EXISTS(SELECT 1 FROM liekan_analysis_query q WHERE q.id=d.job_id AND q.status='failed')`,
  );
}
