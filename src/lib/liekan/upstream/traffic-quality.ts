import { trafficPolicySchema } from '../contracts/traffic-quality';
import { createHash } from 'node:crypto';
import { normalizeCollectionHostname, COLLECTION_RULE_VERSION } from './collection-quality';
import { bumpAnalyticsRevision } from './analytics-revision';
import { invalidateWebsiteAnalytics } from './query-cache';
import { LiekanError, lockWritableWebsite, transaction, type WriteIdentity } from './server';

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

export async function saveTrafficPolicy(
  websiteId: string,
  input: unknown,
  identity: WriteIdentity,
) {
  const parsed = trafficPolicySchema.safeParse(input);
  if (!parsed.success) throw new LiekanError('流量统计设置无效');
  const allowedHostnames = [
    ...new Set(
      parsed.data.allowedHostnames.map(value => {
        // Hosts are exact names. Paths, credentials and wildcard rules have no implicit meaning.
        if (/[\s/@?#*]/.test(value)) throw new LiekanError('允许域名须填写完整主机名');
        const host = normalizeCollectionHostname(value);
        if (!host) throw new LiekanError('允许域名无效');
        return host;
      }),
    ),
  ].sort();
  const result = await transaction(async tx => {
    await lockWritableWebsite(tx, websiteId, identity);
    if (allowedHostnames.length) {
      // Derive only hostname representations. Historical classification and provenance stay missing.
      const reported = await tx.$queryRawUnsafe(
        'SELECT DISTINCT hostname FROM website_event WHERE website_id=$1::uuid AND hostname IS NOT NULL LIMIT 10001',
        websiteId,
      );
      if (reported.length > 10000)
        throw new LiekanError('历史主机名超过 10,000 种，请先核对域名审计', 413);
      for (const row of reported) {
        const digest = createHash('sha256').update(row.hostname).digest('hex');
        await tx.$executeRawUnsafe(
          `INSERT INTO liekan_collection_hostname(website_id,reported_hash,hostname) VALUES($1::uuid,$2,$3)
          ON CONFLICT(website_id,reported_hash) DO UPDATE SET hostname=EXCLUDED.hostname`,
          websiteId,
          digest,
          normalizeCollectionHostname(row.hostname),
        );
      }
    }
    await tx.$executeRawUnsafe(
      `INSERT INTO liekan_collection_policy(website_id,mode,allowed_hostnames) VALUES($1::uuid,$2,$3::text[])
       ON CONFLICT(website_id) DO UPDATE SET mode=EXCLUDED.mode,allowed_hostnames=EXCLUDED.allowed_hostnames,revision=liekan_collection_policy.revision+1,updated_at=now()`,
      websiteId,
      parsed.data.mode,
      allowedHostnames,
    );
    await bumpAnalyticsRevision(tx, 'website', websiteId);
    return getTrafficPolicy(websiteId, tx);
  });
  invalidateWebsiteAnalytics(websiteId);
  return result;
}

/** A bounded private audit reads raw events and verdicts in one consistent snapshot. */
export async function trafficQualityAudit(websiteId: string, parameters: URLSearchParams) {
  const endAt = parameters.has('endAt') ? Number(parameters.get('endAt')) : Date.now();
  const startAt = parameters.has('startAt') ? Number(parameters.get('startAt')) : endAt - 86400000;
  const classification = parameters.get('classification');
  const page = parameters.has('page') ? Number(parameters.get('page')) : 1;
  if (
    ![startAt, endAt].every(Number.isSafeInteger) ||
    startAt < 0 ||
    endAt > 8640000000000000 ||
    endAt < startAt ||
    endAt - startAt > 366 * 86400000 ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 10000 ||
    (classification && !['browser', 'automated', 'suspected', 'unknown'].includes(classification))
  )
    throw new LiekanError('质量审计范围无效');
  return transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const policy = await getTrafficPolicy(websiteId, tx);
    const window = [websiteId, new Date(startAt), new Date(endAt)];
    const [website] = await tx.$queryRawUnsafe(
      'SELECT domain FROM website WHERE website_id=$1::uuid',
      websiteId,
    );
    const expectedHostname = normalizeCollectionHostname(website?.domain);
    const hosts = await tx.$queryRawUnsafe(
      `SELECT COALESCE(q.hostname,e.hostname) AS hostname,
       COUNT(*)::int AS events,COUNT(*) FILTER(WHERE e.event_type=1)::int AS pageviews
       FROM website_event e LEFT JOIN liekan_event_quality q ON q.event_id=e.event_id AND q.website_id=e.website_id
       WHERE e.website_id=$1::uuid AND e.created_at BETWEEN $2 AND $3
       GROUP BY 1 ORDER BY events DESC,hostname NULLS LAST LIMIT 100`,
      ...window,
    );
    const summary = await tx.$queryRawUnsafe(
      `SELECT COALESCE(q.classification,'unknown') AS classification,COUNT(*)::int AS events,
       COUNT(DISTINCT e.session_id)::int AS visitors,COUNT(*) FILTER(WHERE e.event_type=1)::int AS pageviews,
       COUNT(*) FILTER(WHERE q.event_id IS NULL)::int AS missing_verdict,
       COUNT(*) FILTER(WHERE effective.event_id IS NOT NULL)::int AS included
       FROM website_event e LEFT JOIN liekan_event_quality q ON q.event_id=e.event_id AND q.website_id=e.website_id
       LEFT JOIN liekan_effective_website_event effective ON effective.event_id=e.event_id
       WHERE e.website_id=$1::uuid AND e.created_at BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 1`,
      ...window,
    );
    const rows = await tx.$queryRawUnsafe(
      `SELECT e.event_id::text AS "eventId",e.created_at AS "createdAt",e.url_path AS path,e.hostname,q.hostname AS "normalizedHostname",
       COALESCE(q.classification,'unknown') AS classification,q.source,COALESCE(q.reasons,'{}') AS reasons,
       q.rule_version AS "ruleVersion",q.range_status AS "rangeStatus",q.range_version AS "rangeVersion",
       (effective.event_id IS NOT NULL) AS included
       FROM website_event e LEFT JOIN liekan_event_quality q ON q.event_id=e.event_id AND q.website_id=e.website_id
       LEFT JOIN liekan_effective_website_event effective ON effective.event_id=e.event_id
       WHERE e.website_id=$1::uuid AND e.created_at BETWEEN $2 AND $3
       AND ($4::text IS NULL OR COALESCE(q.classification,'unknown')=$4)
       ORDER BY e.created_at DESC,e.event_id DESC LIMIT 100 OFFSET $5`,
      ...window,
      classification || null,
      (page - 1) * 100,
    );
    return {
      policy,
      range: { startAt, endAt },
      domainAudit: { expectedHostname, hosts },
      summary,
      rows,
      page,
      pageSize: 100,
    };
  });
}
