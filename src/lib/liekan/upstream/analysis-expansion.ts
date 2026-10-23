import {
  analysisTransaction,
  analysisVersions,
  logDimensionsSql,
  visitDimensionsSql,
} from './analysis-rollups-db';
import { analysisSafeNumber, analysisPathCoverageSql } from './analysis-rollups-model';
import { withAnalysisPermit } from './analysis-background';

export interface ExpansionObservation {
  day: Date | string;
  inputRows: number;
  derivedRows: number;
  rawMs: number;
  acceleratedMs: number;
  compared: boolean;
}
/** Require three real completed-day comparisons. An unavailable or mismatched sample never disables a family. */
export function expansionShouldStop(rows: ExpansionObservation[]) {
  const days = rows.map(row => +new Date(row.day)).sort((a, b) => a - b);
  return (
    days.every(Number.isFinite) &&
    days[1] - days[0] === 86400000 &&
    days[2] - days[1] === 86400000 &&
    rows.length === 3 &&
    rows.every(
      row =>
        row.compared &&
        row.inputRows > 0 &&
        row.rawMs > 0 &&
        row.derivedRows / row.inputRows > 0.8 &&
        row.acceleratedMs / row.rawMs > 0.8,
    )
  );
}
const activeManifest = `SELECT m.* FROM liekan_analysis_manifest m JOIN liekan_analysis_site s USING(website_id,epoch)
 WHERE s.mode='live' AND m.website_id=$1::uuid AND m.epoch=$2::bigint AND m.family=$5 AND ((m.bucket>=$3::timestamptz AND m.bucket_end<=$4::timestamptz) OR (m.row_count=0 AND m.bucket<$4::timestamptz AND m.bucket_end>$3::timestamptz))
 AND m.versions=$6::jsonb AND m.fingerprint=liekan_analysis_fingerprint(m.website_id,m.epoch,m.family,m.bucket,m.bucket_end)`;
const pathManifest = ` AND ${analysisPathCoverageSql('m')}`;
function measurement(family: 'path' | 'visit', raw: boolean) {
  if (family === 'path') {
    const facts = raw
      ? `SELECT l.path,${logDimensionsSql} AS dimensions,count(*)::bigint AS requests
   FROM liekan_reporting_log l WHERE l.website_id=$1::uuid AND l.created_at>=$3::timestamptz AND l.created_at<$4::timestamptz GROUP BY 1,2`
      : `SELECT f.path,f.dimensions,sum(f.requests)::bigint AS requests FROM liekan_analysis_path f JOIN covered c ON c.website_id=f.website_id AND c.generation=f.generation GROUP BY 1,2`;
    return `WITH covered AS(${activeManifest}${pathManifest}),facts AS(${facts})
   SELECT count(*)::text AS rows,coalesce(sum(requests),0)::text AS inputs,
   md5(coalesce(string_agg(md5(jsonb_build_array(path,dimensions,requests)::text),'' ORDER BY path,dimensions::text),'')) AS digest
   FROM facts CROSS JOIN(SELECT $2::bigint,$5::text,$6::jsonb) parameters`;
  }
  const facts = raw
    ? `SELECT e.session_id,e.visit_id,coalesce(e.hostname,'') AS hostname,${visitDimensionsSql} AS dimensions,
   count(*) FILTER(WHERE e.event_type NOT IN(2,5))::bigint AS pv,bool_or(e.event_type=2) AS custom,
   min(e.created_at) FILTER(WHERE e.event_type NOT IN(2,5)) AS first,max(e.created_at) FILTER(WHERE e.event_type NOT IN(2,5)) AS last,count(*)::bigint AS inputs
   FROM liekan_geographic_website_event e LEFT JOIN session s ON s.session_id=e.session_id AND s.website_id=e.website_id
   WHERE e.website_id=$1::uuid AND e.created_at>=$3::timestamptz AND e.created_at<$4::timestamptz AND e.event_type<>5 GROUP BY 1,2,3,4`
    : `SELECT f.session_id,f.visit_id,f.hostname,f.dimensions,sum(f.pageviews)::bigint AS pv,bool_or(f.has_custom) AS custom,
     min(f.min_time) AS first,max(f.max_time) AS last,0::bigint AS inputs
     FROM liekan_analysis_visit f JOIN covered c ON c.website_id=f.website_id AND c.generation=f.generation GROUP BY 1,2,3,4`;
  return `WITH covered AS(${activeManifest}),facts AS(${facts})
  SELECT count(*)::text AS rows,coalesce(sum(inputs),0)::text AS inputs,
  md5(coalesce(string_agg(md5(jsonb_build_array(session_id,visit_id,hostname,dimensions,pv,custom,first,last)::text),'' ORDER BY session_id,visit_id,hostname,dimensions::text),'')) AS digest
  FROM facts CROSS JOIN(SELECT $2::bigint,$5::text,$6::jsonb) parameters`;
}
/** A single completed UTC day is probed under a shared history permit and 5s SQL budget. */
export async function probeAnalysisExpansion(websiteId?: string) {
  return withAnalysisPermit('history', async (_owned, lease) => {
    const candidate = await analysisTransaction(async tx => {
      const [row] = await tx.$queryRawUnsafe<
        { website_id: string; epoch: bigint; family: 'path' | 'visit'; day: Date }[]
      >(
        `SELECT m.website_id,m.epoch,CASE m.family WHEN 'log' THEN 'path' ELSE 'visit' END AS family,
         date_trunc('day',m.bucket AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS day
        FROM liekan_analysis_manifest m JOIN liekan_analysis_site s USING(website_id,epoch)
        WHERE ($1::uuid IS NULL OR m.website_id=$1::uuid) AND s.mode='live' AND m.row_count>0 AND m.bucket_end<date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        AND (CASE m.family WHEN 'log' THEN s.path_expansion ELSE s.visit_expansion END)
        AND NOT EXISTS(SELECT 1 FROM liekan_analysis_probe p WHERE p.website_id=m.website_id AND p.epoch=m.epoch
          AND p.family=CASE m.family WHEN 'log' THEN 'path' ELSE 'visit' END AND p.day=date_trunc('day',m.bucket AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
        ORDER BY m.bucket DESC,m.website_id LIMIT 1`,
        websiteId || null,
      );
      return row;
    });
    if (!candidate) return;
    const { website_id: site, epoch, family, day } = candidate,
      end = new Date(+day + 86400000),
      kind = family === 'path' ? 'log' : 'visit';
    let versions: Record<string, unknown>, fingerprint: string;
    try {
      const measured = await analysisTransaction(async tx => {
        versions = await analysisVersions(tx, site);
        const args = [site, epoch, day, end, kind, JSON.stringify(versions)];
        const [coverage] = await tx.$queryRawUnsafe<
          { seconds: number; fingerprint: string; derived: string }[]
        >(
          `WITH covered AS(${activeManifest}${family === 'path' ? pathManifest : ''}) SELECT coalesce(sum(extract(epoch FROM(least(bucket_end,$4::timestamptz)-greatest(bucket,$3::timestamptz)))),0)::float8 AS seconds,
           md5(coalesce(string_agg(generation::text||fingerprint,',' ORDER BY bucket),'')) AS fingerprint,
           (SELECT count(*)::text FROM ${family === 'path' ? 'liekan_analysis_path' : 'liekan_analysis_visit'} f
             JOIN covered c ON c.generation=f.generation AND c.website_id=f.website_id) AS derived
           FROM covered `,
          ...args,
        );
        fingerprint = coverage.fingerprint;
        if (coverage.seconds !== 86400) return null;
        // Alternate order across days to reduce consistent buffer-order bias. Neither path uses result caches.
        const run = async (raw: boolean) => {
          const start = performance.now();
          const [value] = await tx.$queryRawUnsafe<
            { rows: string; inputs: string; digest: string }[]
          >(measurement(family, raw), ...args);
          return { ...value, ms: performance.now() - start };
        };
        const rawFirst = Math.floor(+day / 86400000) % 2 === 0;
        const first = await run(rawFirst),
          second = await run(!rawFirst),
          raw = rawFirst ? first : second,
          fast = rawFirst ? second : first;
        return {
          inputRows: analysisSafeNumber(raw.inputs),
          derivedRows: analysisSafeNumber(coverage.derived),
          rawMs: raw.ms,
          acceleratedMs: fast.ms,
          compared: raw.digest === fast.digest,
        };
      }, 'RepeatableRead');
      if (!measured) return;
      await analysisTransaction(async tx => {
        const [owner] = await tx.$queryRawUnsafe(
          `SELECT id FROM liekan_analysis_background_lease WHERE id AND token=$1::uuid AND epoch=$2::bigint AND lease_until>clock_timestamp() FOR SHARE`,
          lease.token,
          lease.epoch,
        );
        if (!owner) return;
        const current = await analysisVersions(tx, site);
        if (JSON.stringify(current) !== JSON.stringify(versions)) return;
        const [coverage] = await tx.$queryRawUnsafe<{ fingerprint: string; seconds: number }[]>(
          `WITH covered AS(${activeManifest}${family === 'path' ? pathManifest : ''}) SELECT
           md5(coalesce(string_agg(generation::text||fingerprint,',' ORDER BY bucket),'')) AS fingerprint,
           coalesce(sum(extract(epoch FROM(least(bucket_end,$4::timestamptz)-greatest(bucket,$3::timestamptz)))),0)::float8 AS seconds
           FROM covered `,
          site,
          epoch,
          day,
          end,
          kind,
          JSON.stringify(current),
        );
        if (coverage.fingerprint !== fingerprint || coverage.seconds !== 86400) return;
        await tx.$executeRawUnsafe(
          `INSERT INTO liekan_analysis_probe(website_id,epoch,family,day,versions,fingerprint,status,input_rows,derived_rows,raw_ms,accelerated_ms,compared)
         VALUES($1::uuid,$2::bigint,$3,$4,$5::jsonb,$6,'ready',$7::bigint,$8::bigint,$9,$10,$11) ON CONFLICT DO NOTHING`,
          site,
          epoch,
          family,
          day,
          JSON.stringify(versions),
          fingerprint,
          measured.inputRows,
          measured.derivedRows,
          measured.rawMs,
          measured.acceleratedMs,
          measured.compared,
        );
        const rows = await tx.$queryRawUnsafe<
          {
            input_rows: bigint;
            day: Date;
            fingerprint: string;
            derived_rows: bigint;
            raw_ms: number;
            accelerated_ms: number;
            compared: boolean;
          }[]
        >(
          `SELECT * FROM liekan_analysis_probe WHERE website_id=$1::uuid AND epoch=$2::bigint AND family=$3 AND status='ready' AND versions=$4::jsonb ORDER BY day DESC LIMIT 3`,
          site,
          epoch,
          family,
          JSON.stringify(versions),
        );
        const valid = [];
        for (const row of rows) {
          const [proof] = await tx.$queryRawUnsafe<{ fingerprint: string }[]>(
            `WITH covered AS(${activeManifest}${family === 'path' ? pathManifest : ''}) SELECT md5(coalesce(string_agg(generation::text||fingerprint,',' ORDER BY bucket),'')) AS fingerprint FROM covered `,
            site,
            epoch,
            row.day,
            new Date(+new Date(row.day) + 86400000),
            kind,
            JSON.stringify(current),
          );
          if (proof.fingerprint === row.fingerprint) valid.push(row);
        }
        if (
          expansionShouldStop(
            valid.map(r => ({
              day: r.day,
              inputRows: Number(r.input_rows),
              derivedRows: Number(r.derived_rows),
              rawMs: r.raw_ms,
              acceleratedMs: r.accelerated_ms,
              compared: r.compared,
            })),
          )
        )
          await tx.$executeRawUnsafe(
            `UPDATE liekan_analysis_site SET ${family === 'path' ? 'path_expansion' : 'visit_expansion'}=false,revision=revision+1 WHERE website_id=$1::uuid AND epoch=$2::bigint`,
            site,
            epoch,
          );
      });
    } catch {
      if (!versions) return;
      await analysisTransaction(tx =>
        tx.$executeRawUnsafe(
          `INSERT INTO liekan_analysis_probe(website_id,epoch,family,day,versions,fingerprint,status)
       VALUES($1::uuid,$2::bigint,$3,$4,$5::jsonb,$6,'unavailable') ON CONFLICT DO NOTHING`,
          site,
          epoch,
          family,
          day,
          JSON.stringify(versions),
          fingerprint || '',
        ),
      );
    }
  });
}
