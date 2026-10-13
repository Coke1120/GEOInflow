import { createHash } from 'node:crypto';
import { diagnosticCoverage } from '../traffic-quality/diagnostics';
import {
  trafficPolicySchema,
  trafficPreviewSchema,
  qualityRangeSchema,
  type TrafficPolicy,
} from '../contracts/traffic-quality';
import { normalizeCollectionHostname, COLLECTION_RULE_VERSION } from './collection-quality';
import { bumpAnalyticsRevision } from './analytics-revision';
import { invalidateWebsiteAnalytics } from './query-cache';
import { LiekanError, lockWritableWebsite, transaction, type WriteIdentity } from './server';

export function requireQualitySupport() {
  if (process.env.CLICKHOUSE_URL) throw new LiekanError('流量质量分析当前支持 PostgreSQL', 501);
}
export async function getTrafficPolicy(websiteId: string, tx?: any) {
  const load = async (client: any) => {
    const [row] = await client.$queryRawUnsafe(
      'SELECT mode,allowed_hostnames,revision::text FROM liekan_collection_policy WHERE website_id=$1::uuid',
      websiteId,
    );
    return {
      mode: row?.mode || 'standard',
      allowedHostnames: row?.allowed_hostnames || [],
      revision: row?.revision || '0',
      ruleVersion: COLLECTION_RULE_VERSION,
    };
  };
  return tx ? load(tx) : transaction(load);
}
export function normalizeTrafficPolicy(input: unknown): TrafficPolicy {
  const parsed = trafficPolicySchema.safeParse(input);
  if (!parsed.success) throw new LiekanError('流量统计设置无效');
  return {
    ...parsed.data,
    allowedHostnames: [
      ...new Set(
        parsed.data.allowedHostnames.map(value => {
          if (/[\s/@?#*]/.test(value)) throw new LiekanError('允许域名须填写完整主机名');
          const host = normalizeCollectionHostname(value);
          if (!host) throw new LiekanError('允许域名无效');
          return host;
        }),
      ),
    ].sort(),
  };
}
async function hostRepresentations(tx: any, websiteId: string) {
  const reported = await tx.$queryRawUnsafe(
    'SELECT DISTINCT hostname FROM website_event WHERE website_id=$1::uuid AND hostname IS NOT NULL LIMIT 10001',
    websiteId,
  );
  if (reported.length > 10000)
    throw new LiekanError('历史主机名超过 10,000 种，请先核对域名审计', 413);
  return reported.map((row: any) => ({
    reported: row.hostname,
    hostname: normalizeCollectionHostname(row.hostname),
  }));
}
export async function saveTrafficPolicy(
  websiteId: string,
  input: unknown,
  identity: WriteIdentity,
) {
  requireQualitySupport();
  const proposed = normalizeTrafficPolicy(input);
  const result = await transaction(async tx => {
    await lockWritableWebsite(tx, websiteId, identity);
    const before = await getTrafficPolicy(websiteId, tx);
    if (proposed.expectedRevision !== undefined && proposed.expectedRevision !== before.revision)
      throw new LiekanError('统计策略已更新，请刷新后重新预览', 409);
    if (proposed.allowedHostnames.length) {
      for (const row of await hostRepresentations(tx, websiteId)) {
        await tx.$executeRawUnsafe(
          `INSERT INTO liekan_collection_hostname(website_id,reported_hash,hostname) VALUES($1::uuid,$2,$3)
          ON CONFLICT(website_id,reported_hash) DO UPDATE SET hostname=EXCLUDED.hostname`,
          websiteId,
          createHash('sha256').update(row.reported).digest('hex'),
          row.hostname,
        );
      }
    }
    await tx.$executeRawUnsafe(
      `INSERT INTO liekan_collection_policy(website_id,mode,allowed_hostnames) VALUES($1::uuid,$2,$3::text[])
       ON CONFLICT(website_id) DO UPDATE SET mode=EXCLUDED.mode,allowed_hostnames=EXCLUDED.allowed_hostnames,revision=liekan_collection_policy.revision+1,updated_at=now()`,
      websiteId,
      proposed.mode,
      proposed.allowedHostnames,
    );
    const after = await getTrafficPolicy(websiteId, tx);
    await tx.$executeRawUnsafe(
      'INSERT INTO liekan_collection_policy_history(website_id,actor_id,before_policy,after_policy) VALUES($1::uuid,$2::uuid,$3::jsonb,$4::jsonb)',
      websiteId,
      identity.userId,
      JSON.stringify(before),
      JSON.stringify(after),
    );
    await bumpAnalyticsRevision(tx, 'website', websiteId);
    return after;
  });
  invalidateWebsiteAnalytics(websiteId);
  return result;
}
export function parseQualityRange(parameters: URLSearchParams) {
  const parsed = qualityRangeSchema.safeParse(Object.fromEntries(parameters));
  if (!parsed.success) throw new LiekanError('质量审计范围无效');
  const endAt = parsed.data.endAt ?? Date.now(),
    startAt = parsed.data.startAt ?? endAt - 86400000;
  if (
    ![startAt, endAt].every(Number.isSafeInteger) ||
    startAt < 0 ||
    endAt > 8640000000000000 ||
    endAt < startAt ||
    endAt - startAt > 366 * 86400000
  )
    throw new LiekanError('质量审计范围无效');
  const timezone = parsed.data.timezone || 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    throw new LiekanError('时区无效');
  }
  return { ...parsed.data, startAt, endAt, timezone, page: parsed.data.page ?? 1 };
}
type Range = ReturnType<typeof parseQualityRange>;
const scope = `e.website_id=$1::uuid AND e.created_at BETWEEN $2 AND $3
 AND ($4::text IS NULL OR COALESCE(q.classification,'unknown')=$4)
 AND ($5::text IS NULL OR q.source=$5) AND ($6::text IS NULL OR e.hostname=$6 OR q.hostname=$6)`;
const joins = `FROM website_event e LEFT JOIN liekan_event_quality q ON q.event_id=e.event_id AND q.website_id=e.website_id
 LEFT JOIN liekan_effective_website_event effective ON effective.event_id=e.event_id AND effective.website_id=e.website_id`;
const bindings = (id: string, range: Range) => [
  id,
  new Date(range.startAt),
  new Date(range.endAt),
  range.classification || null,
  range.source || null,
  range.hostname || null,
];
export async function qualityTotals(
  tx: any,
  websiteId: string,
  range: Range,
  proposed?: TrafficPolicy,
) {
  const params = bindings(websiteId, range);
  let included = 'effective.event_id IS NOT NULL',
    extra = '';
  if (proposed) {
    // The preview reads normalized historical hosts without changing saved policy or evidence.
    const hosts = proposed.allowedHostnames.length ? await hostRepresentations(tx, websiteId) : [];
    params.push(proposed.mode, proposed.allowedHostnames as any, JSON.stringify(hosts));
    extra = `LEFT JOIN jsonb_to_recordset($9::jsonb) AS h(reported text,hostname text) ON h.reported=e.hostname`;
    included = `($7='raw' OR (COALESCE(q.classification,'unknown')<>'automated'
      AND ($7<>'strict' OR COALESCE(q.classification,'unknown')<>'suspected')
      AND (cardinality($8::text[])=0 OR COALESCE(q.hostname,h.hostname)=ANY($8::text[]))))`;
  }
  const [result] = await tx.$queryRawUnsafe(
    `SELECT COUNT(*)::float8 AS "rawPV",COUNT(*) FILTER(WHERE ${included})::float8 AS "includedPV",
      COUNT(DISTINCT e.session_id)::float8 AS "rawUV",COUNT(DISTINCT e.session_id) FILTER(WHERE ${included})::float8 AS "includedUV",
      COUNT(*) FILTER(WHERE q.event_id IS NULL)::float8 AS "missingVerdictPV"
      ${joins} ${extra} WHERE ${scope} AND e.event_type NOT IN (2,5)`,
    ...params,
  );
  return {
    ...result,
    excludedPV: result.rawPV - result.includedPV,
    fullyExcludedUV: result.rawUV - result.includedUV,
  };
}
export async function previewTrafficPolicy(
  websiteId: string,
  input: unknown,
  identity: WriteIdentity,
) {
  requireQualitySupport();
  const parsed = trafficPreviewSchema.safeParse(input);
  if (!parsed.success) throw new LiekanError('预览参数无效');
  const proposed = normalizeTrafficPolicy(parsed.data.policy);
  const range = parseQualityRange(
    new URLSearchParams(Object.entries(parsed.data.range).map(([k, v]) => [k, String(v)])),
  );
  return transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await lockWritableWebsite(tx, websiteId, identity, 'share');
    const policy = await getTrafficPolicy(websiteId, tx);
    if (proposed.expectedRevision !== undefined && proposed.expectedRevision !== policy.revision)
      throw new LiekanError('统计策略已更新，请刷新后重新预览', 409);
    return {
      policy,
      proposed,
      range: { startAt: range.startAt, endAt: range.endAt, timezone: range.timezone },
      current: await qualityTotals(tx, websiteId, range),
      preview: await qualityTotals(tx, websiteId, range, proposed),
    };
  });
}
/** Each manual read uses one snapshot; cursor scope includes the policy revision. */
export async function trafficQualityAudit(websiteId: string, parameters: URLSearchParams) {
  if (process.env.CLICKHOUSE_URL)
    return { available: false, reason: '流量质量分析当前支持 PostgreSQL' };
  const range = parseQualityRange(parameters);
  return transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const policy = await getTrafficPolicy(websiteId, tx);
    const values = bindings(websiteId, range);
    const signature = createHash('sha256')
      .update(JSON.stringify([values, policy.revision]))
      .digest('hex');
    let cursor: { time: string; id: string; signature: string } | undefined;
    if (range.cursor) {
      try {
        cursor = JSON.parse(Buffer.from(range.cursor, 'base64url').toString());
      } catch {
        throw new LiekanError('分页游标无效');
      }
      if (
        !cursor ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(cursor.time) ||
        !Number.isFinite(Date.parse(cursor.time)) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor.id)
      )
        throw new LiekanError('分页游标无效');
      if (cursor.signature !== signature)
        throw new LiekanError('审计条件或策略已变化，请从第一页读取', 409);
    }
    const [website] = await tx.$queryRawUnsafe(
      'SELECT domain FROM website WHERE website_id=$1::uuid',
      websiteId,
    );
    const hosts = await tx.$queryRawUnsafe(
      `SELECT COALESCE(q.hostname,e.hostname) AS hostname,COUNT(*)::float8 AS events,COUNT(*) FILTER(WHERE e.event_type=1)::float8 AS pageviews ${joins} WHERE ${scope} GROUP BY 1 ORDER BY events DESC,hostname NULLS LAST LIMIT 100`,
      ...values,
    );
    const summary = await tx.$queryRawUnsafe(
      `SELECT COALESCE(q.classification,'unknown') AS classification,COUNT(*)::float8 AS events,
       COUNT(DISTINCT e.session_id)::float8 AS visitors,COUNT(*) FILTER(WHERE e.event_type=1)::float8 AS pageviews,
       COUNT(*) FILTER(WHERE q.event_id IS NULL)::float8 AS missing_verdict,COUNT(*) FILTER(WHERE effective.event_id IS NOT NULL)::float8 AS included
       ${joins} WHERE ${scope} GROUP BY 1 ORDER BY 1`,
      ...values,
    );
    const rows = await tx.$queryRawUnsafe(
      `SELECT e.event_id::text AS "eventId",e.created_at AS "createdAt",to_char(e.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorTime",
       e.url_path AS path,e.hostname,q.hostname AS "normalizedHostname",COALESCE(q.classification,'unknown') AS classification,q.source,COALESCE(q.reasons,'{}') AS reasons,
       q.rule_version AS "ruleVersion",q.range_status AS "rangeStatus",q.range_version AS "rangeVersion",(effective.event_id IS NOT NULL) AS included
       ${joins} WHERE ${scope} AND ($7::timestamptz IS NULL OR (e.created_at,e.event_id)<($7::timestamptz,$8::uuid))
       ORDER BY e.created_at DESC,e.event_id DESC LIMIT 101 OFFSET $9`,
      ...values,
      cursor?.time || null,
      cursor?.id || null,
      cursor ? 0 : (range.page - 1) * 100,
    );
    const last = rows[99];
    const nextCursor =
      rows.length > 100
        ? Buffer.from(
            JSON.stringify({ time: last.cursorTime, id: last.eventId, signature }),
          ).toString('base64url')
        : null;
    const bucketStartAt = Math.floor(range.startAt / 60000) * 60000,
      bucketEndAt = Math.floor(range.endAt / 60000) * 60000 + 60000;
    const [state] = await tx.$queryRawUnsafe(
      'SELECT s.started_at,clock_timestamp() AS read_at FROM (SELECT 1) t LEFT JOIN liekan_collection_diagnostic_state s ON s.website_id=$1::uuid',
      websiteId,
    );
    const coverage = diagnosticCoverage(
      bucketStartAt,
      bucketEndAt,
      state?.started_at ? +state.started_at : null,
      +state.read_at,
    );
    const [diagnostic] = await tx.$queryRawUnsafe(
      `SELECT COALESCE(SUM(written),0)::float8 AS written,COALESCE(SUM(with_uuid),0)::float8 AS "withUuid",COALESCE(SUM(duplicate),0)::float8 AS duplicate
       FROM liekan_collection_diagnostic WHERE website_id=$1::uuid AND bucket >= $2 AND bucket < $3`,
      websiteId,
      new Date(Math.max(bucketStartAt, Date.parse(coverage.retainedFrom))),
      new Date(bucketEndAt),
    );
    const history = await tx.$queryRawUnsafe(
      'SELECT id::text,actor_id::text AS "actorId",created_at AS "createdAt",before_policy AS before,after_policy AS after FROM liekan_collection_policy_history WHERE website_id=$1::uuid ORDER BY id DESC LIMIT 20',
      websiteId,
    );
    return {
      available: true,
      policy,
      range: { startAt: range.startAt, endAt: range.endAt, timezone: range.timezone },
      totals: await qualityTotals(tx, websiteId, range),
      domainAudit: { expectedHostname: normalizeCollectionHostname(website?.domain), hosts },
      summary,
      rows: rows.slice(0, 100).map(({ cursorTime, ...row }: any) => row),
      page: range.page,
      pageSize: 100,
      nextCursor,
      history,
      diagnostics: {
        ...diagnostic,
        ...coverage,
        written: coverage.coverage === 'missing' ? null : diagnostic.written,
        withUuid: coverage.coverage === 'missing' ? null : diagnostic.withUuid,
        duplicate: coverage.coverage === 'missing' ? null : diagnostic.duplicate,
        startedAt: state?.started_at || null,
        bucketStartAt,
        bucketEndAt,
        duplicateFraction:
          coverage.coverage !== 'missing' && diagnostic.written + diagnostic.duplicate
            ? diagnostic.duplicate / (diagnostic.written + diagnostic.duplicate)
            : null,
        uuidCoverage:
          coverage.coverage !== 'missing' && diagnostic.written
            ? diagnostic.withUuid / diagnostic.written
            : null,
      },
    };
  });
}
