import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { pageReportParts, pageReportSchema, type LiekanPageReport } from '../contracts/page-report';
import { reportQuery } from '../contracts/query';
import { buildReport } from '../report';
import {
  analyticsCache,
  analyticsCacheKey,
  websiteCacheTag,
  type CachedResult,
} from './query-cache';
import { LiekanError } from './errors';
import { withoutQueryCache } from './cache-context';

export async function readPageReport(
  website: { id: string; name: string; domain: string },
  input: unknown,
  refresh = false,
): Promise<CachedResult<LiekanPageReport>> {
  const parsed = reportQuery.safeParse(input);
  if (!parsed.success) throw new LiekanError('统计参数无效');
  const p = parsed.data;
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
  const load = async () => {
    const report = await withoutQueryCache(() => buildReport(website, false, p, true));
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
  const key = analyticsCacheKey('page-report-v1', [process.env.DATABASE_URL, website.id, p]);
  const result = await analyticsCache.read(key, ttl, [websiteCacheTag(website.id)], load, refresh);
  result.value.meta.generatedAt = result.generatedAt;
  result.value.meta.expiresAt = result.expiresAt;
  return result;
}
