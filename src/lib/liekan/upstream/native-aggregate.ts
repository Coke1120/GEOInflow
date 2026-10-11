import { cacheHeadersEnabled, noteCacheResult } from './cache-context';
import { statisticsCacheTtl } from './cache-policy';
import { analyticsCache, analyticsCacheKey, websiteCacheTag } from './query-cache';
import { getQuerySnapshot } from './query-snapshot';
import { geographyVersion } from '../contracts/geography';

/** Multiple native queries share one authorized result and one primary snapshot. */
export async function nativeAggregate<T>(
  name: string,
  websiteId: string,
  parameters: any,
  filters: any,
  load: () => Promise<T>,
) {
  if (!cacheHeadersEnabled() || getQuerySnapshot()) return load();
  const { refresh, ...statisticsParameters } = parameters;
  const result = await analyticsCache.read(
    analyticsCacheKey(`${name}-${geographyVersion}`, [websiteId, statisticsParameters, filters]),
    statisticsCacheTtl(parameters.endDate, parameters.timezone || filters.timezone),
    [websiteCacheTag(websiteId)],
    load,
    refresh === '1',
  );
  noteCacheResult(result);
  return result.value;
}
