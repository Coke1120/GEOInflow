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
  websiteId: string,
  parameters: any,
  filters: any,
  load: () => Promise<T>,
) {
  if (!cacheHeadersEnabled() || getQuerySnapshot()) return load();
  const { refresh, ...statisticsParameters } = parameters;
  const result = await analyticsCache.read(
    analyticsCacheKey(
      `${name}-population-envelope-v1-${geographyVersion}-${TRAFFIC_POLICY_VERSION}`,
      [websiteId, statisticsParameters, filters],
    ),
    statisticsCacheTtl(parameters.endDate, parameters.timezone || filters.timezone),
    [websiteCacheTag(websiteId)],
    () => captureBrowserPopulations(() => nativeSnapshot(load)),
    refresh === '1',
  );
  noteCacheResult(result);
  for (const population of result.value.populations)
    noteBrowserPopulation(population.resourceId || websiteId, population);
  return result.value.value;
}
