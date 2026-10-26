import { primary, LiekanError } from './server';
import { TRAFFIC_POLICY_VERSION } from './traffic-query';
import { CRAWLER_POPULATION_VERSION } from '../rules/population';
import {
  ANALYSIS_ROLLUP_VERSION,
  ANALYSIS_GLOBAL_LIMIT,
  ANALYSIS_SITE_LIMIT,
  type AnalysisTx,
} from './analysis-rollups-model';

export async function analysisTransaction<T>(
  work: (tx: AnalysisTx) => Promise<T>,
  isolationLevel: 'ReadCommitted' | 'RepeatableRead' = 'ReadCommitted',
): Promise<T> {
  const schema = new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new LiekanError('数据库设置无效', 500);
  return primary().$transaction(
    async (tx: AnalysisTx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout TO '5s'");
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout TO '2s'");
      return work(tx);
    },
    { timeout: 30000, maxWait: 1000, isolationLevel },
  ) as Promise<T>;
}

/** Optional readers retain native link/pixel handling when no website identity exists. */
export async function findAnalysisVersions(tx: AnalysisTx, websiteId: string) {
  const [row] = await tx.$queryRawUnsafe<{ versions: Record<string, unknown> }[]>(
    'SELECT liekan_analysis_versions($1::uuid,$2::text,$3::text,$4::text) AS versions',
    websiteId,
    ANALYSIS_ROLLUP_VERSION,
    TRAFFIC_POLICY_VERSION,
    CRAWLER_POPULATION_VERSION,
  );
  return row?.versions || null;
}

/** Workers and management require a website identity in the same query snapshot. */
export async function analysisVersions(tx: AnalysisTx, websiteId: string) {
  const versions = await findAnalysisVersions(tx, websiteId);
  if (!versions) throw new LiekanError('站点不存在', 404);
  return versions;
}

export const analysisTables = [
  'liekan_analysis_site',
  'liekan_analysis_visit_guard',
  'liekan_analysis_log',
  'liekan_analysis_path',
  'liekan_analysis_visit',
  'liekan_analysis_manifest',
  'liekan_analysis_dirty',
  'liekan_analysis_meter',
  'liekan_analysis_build',
  'liekan_analysis_operation',
  'liekan_analysis_generation',
  'liekan_analysis_query',
  'liekan_analysis_query_consumer',
  'liekan_analysis_background_lease',
  'liekan_analysis_dashboard_lease',
  'liekan_analysis_probe',
  'liekan_dashboard_snapshot',
  'liekan_dashboard_dirty',
  'liekan_analysis_browser_detail',
  'liekan_analysis_browser_visit',
  'liekan_analysis_browser_path',
] as const;
export async function analysisCapacity(tx: AnalysisTx, websiteId: string) {
  // Partition parents have no storage. Include every descendant exactly once.
  const [physical] = await tx.$queryRawUnsafe<{ bytes: bigint }[]>(
    `WITH RECURSIVE relations(oid) AS (
      SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[])
      UNION SELECT i.inhrelid FROM pg_inherits i JOIN relations r ON r.oid=i.inhparent
     ) SELECT coalesce(sum(pg_total_relation_size(oid)),0)::bigint AS bytes FROM relations`,
    [...analysisTables],
  );
  const [site] = await tx.$queryRawUnsafe<{ bytes: bigint }[]>(
    `SELECT (derived_bytes+pg_column_size(s)*2+coalesce((SELECT sum(bytes) FROM liekan_analysis_meter m WHERE m.website_id=s.website_id),0)
       +coalesce((SELECT sum(result_bytes) FROM liekan_analysis_query q WHERE q.website_id=s.website_id),0)*2
       +coalesce((SELECT sum(result_bytes) FROM liekan_dashboard_snapshot d WHERE d.website_id=s.website_id),0)*2)::bigint AS bytes
     FROM liekan_analysis_site s WHERE website_id=$1::uuid`,
    websiteId,
  );
  // Reserve bounded control/marker/index overhead, including 32 visit guard rows per site,
  // in addition to charged generation tuples.
  const reserve = 16 * 1024 ** 2;
  return {
    siteBytes: String((site?.bytes || 0n) + BigInt(reserve)),
    globalBytes: String(physical.bytes),
    siteLimit: ANALYSIS_SITE_LIMIT,
    globalLimit: ANALYSIS_GLOBAL_LIMIT,
  };
}

export async function ensureAnalysisPartitions(tx: AnalysisTx, hour: string) {
  const date = new Date(hour);
  const starts = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const ends = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  const suffix = `${starts.getUTCFullYear()}_${String(starts.getUTCMonth() + 1).padStart(2, '0')}`;
  for (const table of [
    'liekan_analysis_log',
    'liekan_analysis_path',
    'liekan_analysis_visit',
    'liekan_analysis_browser_visit',
    'liekan_analysis_browser_path',
  ]) {
    const child = `${table}_${suffix}`;
    const [existing] = await tx.$queryRawUnsafe<{ found: boolean }[]>(
      'SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname=$1) AS found',
      child,
    );
    if (!existing.found)
      await tx.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS ${child} PARTITION OF ${table} FOR VALUES FROM ('${starts.toISOString()}') TO ('${ends.toISOString()}')`,
      );
  }
}
export async function chargeAnalysisGeneration(
  tx: AnalysisTx,
  websiteId: string,
  generation: string,
  bytes: string,
) {
  await tx.$executeRawUnsafe(
    `INSERT INTO liekan_analysis_generation(website_id,generation,estimated_bytes)
    VALUES($1::uuid,$2::uuid,$3::bigint) ON CONFLICT(website_id,generation) DO UPDATE
    SET estimated_bytes=liekan_analysis_generation.estimated_bytes+EXCLUDED.estimated_bytes,updated_at=clock_timestamp()`,
    websiteId,
    generation,
    bytes,
  );
  await tx.$executeRawUnsafe(
    'UPDATE liekan_analysis_site SET derived_bytes=derived_bytes+$2::bigint WHERE website_id=$1::uuid',
    websiteId,
    bytes,
  );
}

const archivedProductFormSql = `(SELECT identity->>'productForm' FROM liekan_crawler_registry_version v
   CROSS JOIN LATERAL jsonb_array_elements(v.payload->'identities') identity
   WHERE v.version=l.reporting_catalog_version AND identity->>'id'=l.reporting_crawler_id LIMIT 1)`;
export function analysisLogDimensionsSql(productFormSql = archivedProductFormSql) {
  return `jsonb_build_object(
 'bot',l.bot,'vendor',l.vendor,'type',l.bot_type,'crawlerId',l.reporting_crawler_id,
 'catalogVersion',l.reporting_catalog_version,'classificationVersion',l.reporting_classification_version,
 'aiEligible',l.ai_eligible,'recognitionState',l.recognition_state,'verification',l.verification,
 'selfCheck',l.user_agent LIKE 'Liekan-Crawler-Check/%','status',l.status,
 'productForm',${productFormSql})`;
}
export const logDimensionsSql = analysisLogDimensionsSql();
export const visitDimensionsSql = `jsonb_build_object(
 'sessionPresent',s.session_id IS NOT NULL,'browser',e.liekan_browser,'os',e.liekan_os,'device',e.liekan_device,'screen',e.liekan_screen,'language',e.liekan_language,
 'country',e.liekan_country,'region',e.liekan_region,'city',e.liekan_city,
 'identityAvailable',e.liekan_identity_available,'identityVersion',env.identity_version,
 'ruleVersion',q.rule_version,'catalogVersion',q.catalog_version::text)`;
export const visitEvidenceJoinsSql = `LEFT JOIN session s ON s.session_id=e.session_id AND s.website_id=e.website_id
 LEFT JOIN liekan_event_environment env ON env.website_id=e.website_id AND env.event_id=e.event_id
 LEFT JOIN liekan_reporting_event_quality q ON q.website_id=e.website_id AND q.event_id=e.event_id`;
