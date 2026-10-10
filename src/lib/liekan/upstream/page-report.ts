import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { type LiekanPageReport, pageReportParts, pageReportSchema } from '../contracts/page-report';
import { parseReportQuery } from '../contracts/query';
import { buildReport } from '../report';
import { readKeywordPage } from './keywords';
import { withoutQueryCache } from './cache-context';
import { LiekanError } from './errors';
import {
  analyticsCache,
  analyticsCacheKey,
  type CachedResult,
  websiteCacheTag,
} from './query-cache';
import { query, reportSnapshot } from './server';

export async function readPageReport(
  website: { id: string; name: string; domain: string },
  input: unknown,
  refresh = false,
): Promise<CachedResult<LiekanPageReport>> {
  const parsed = parseReportQuery(input);
  if (!parsed.success) throw new LiekanError('统计参数无效');
  const { refresh: requestedRefresh, ...p } = parsed.data;
  let today: number;
  try {
    today = +fromZonedTime(
      `${formatInTimeZone(Date.now(), p.timezone, 'yyyy-MM-dd')}T00:00:00`,
      p.timezone,
    );
  } catch {
    throw new LiekanError('时区无效');
  }
  const ttl =
    p.resource === 'logs'
      ? 0
      : p.endAt < today && !pageReportParts[p.resource].today
        ? 300000
        : 30000;
  if (p.resource === 'human/keywords') {
    const result = await readKeywordPage(
      website,
      { ...p, refresh: requestedRefresh },
      ttl,
      refresh || requestedRefresh === '1',
    );
    return {
      ...result,
      value: pageReportSchema.parse({
        ...result.value,
        resource: p.resource,
        meta: {
          ...result.value.meta,
          generatedAt: result.generatedAt,
          expiresAt: result.expiresAt,
        },
      }) as LiekanPageReport,
    };
  }
  const load = async () => {
    const report = await reportSnapshot(() =>
      withoutQueryCache(() => buildReport(website, false, p, true)),
    );
    const generatedAt = Date.now();
    return pageReportSchema.parse({
      ...report,
      resource: p.resource,
      meta: { ...report.meta, generatedAt, expiresAt: generatedAt + ttl },
    }) as LiekanPageReport;
  };
  if (!ttl) {
    const value = await load();
    return {
      value,
      generatedAt: value.meta.generatedAt,
      expiresAt: value.meta.expiresAt,
      status: 'miss',
    };
  }
  const revision = analyticsCache.isRuntimeConfigured
    ? undefined
    : (
        await query(
          'SELECT data_revision::text AS data,policy_revision::text AS policy FROM liekan_log_state WHERE website_id=$1::uuid',
          website.id,
        )
      )[0] || { data: '0', policy: '0' };
  const key = analyticsCacheKey('page-report-v4-table-pages', [
    process.env.DATABASE_URL,
    website.id,
    p,
    revision,
  ]);
  const result = await analyticsCache.read(
    key,
    ttl,
    [websiteCacheTag(website.id)],
    load,
    refresh || requestedRefresh === '1',
  );
  result.value.meta.generatedAt = result.generatedAt;
  result.value.meta.expiresAt = result.expiresAt;
  return result;
}
