import { nativeSnapshot } from './native-snapshot';
import {
  cacheHeadersEnabled,
  noteCacheResult,
  captureBrowserPopulations,
  noteBrowserPopulation,
} from './cache-context';
import { statisticsCacheTtl } from './cache-policy';
import { analyticsCache, analyticsCacheKey, websiteCacheTag } from './query-cache';
import { getQuerySnapshot } from './query-snapshot';
import { geographyVersion } from '../contracts/geography';
import { TRAFFIC_POLICY_VERSION } from './traffic-query';

/** Multiple native queries share one authorized result and one primary snapshot. */
export async function nativeAggregate<T>(
  name: string,
  websiteId: string | readonly string[],
  parameters: any,
  filters: any,
  load: () => Promise<T>,
) {
  if (!cacheHeadersEnabled() || getQuerySnapshot()) return load();
  const ids = typeof websiteId === 'string' ? [websiteId] : [...new Set(websiteId)];
  if (!ids.length) return load();
  const { refresh, ...statisticsParameters } = parameters;
  const { refresh: _filterRefresh, ...statisticsFilters } = filters;
  const result = await analyticsCache.read(
    analyticsCacheKey(
      `${name}-population-envelope-v1-${geographyVersion}-${TRAFFIC_POLICY_VERSION}`,
      [websiteId, statisticsParameters, statisticsFilters],
    ),
    statisticsCacheTtl(parameters.endDate, parameters.timezone || filters.timezone),
    ids.map(websiteCacheTag),
    () => captureBrowserPopulations(() => nativeSnapshot(load)),
    refresh === '1',
  );
  noteCacheResult(result);
  for (const population of result.value.populations) {
    const resourceId = population.resourceId || (typeof websiteId === 'string' ? websiteId : null);
    if (resourceId) noteBrowserPopulation(resourceId, population);
  }
  return result.value.value;
}
