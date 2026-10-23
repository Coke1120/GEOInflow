import { beforeEach, expect, it, vi } from 'vitest';
import { nativeAggregate } from './native-aggregate';
import { noteBrowserPopulation, withQueryCacheHeaders } from './cache-context';
import { populationFromRow } from './browser-population';
const cache = vi.hoisted(() => new Map<string, unknown>());
vi.mock('./native-snapshot', () => ({ nativeSnapshot: (work: () => unknown) => work() }));
vi.mock('./query-cache', () => ({
  analyticsCacheKey: (name: string, args: unknown) => JSON.stringify([name, args]),
  websiteCacheTag: (id: string) => id,
  analyticsCache: {
    read: async (key: string, _ttl: number, _tags: string[], load: () => unknown) => {
      const hit = cache.has(key);
      if (!hit) cache.set(key, await load());
      return {
        value: cache.get(key),
        status: hit ? 'hit' : 'miss',
        tier: 'memory',
        generatedAt: 1000,
        expiresAt: 2000,
      };
    },
  },
}));
beforeEach(() => cache.clear());
it('replays the population from the cached snapshot on warm native array responses', async () => {
  let population = populationFromRow(
    {
      resourceKind: 'website',
      governanceProcessing: {
        computedAt: new Date(900),
        nextWindow: new Date(800),
        errorCode: null,
      },
      eligibleEvents: 2,
      qualifiedEvents: 1,
      eligiblePV: 2,
      qualifiedPV: 1,
      qualifiedVisitors: 1,
    },
    { startAt: 1000, endAt: 2000, timezone: 'Asia/Shanghai' },
  );
  const load = vi.fn(async () => {
    noteBrowserPopulation('site', population);
    return [{ pageviews: 2, visitors: null }];
  });
  const request = () =>
    withQueryCacheHeaders(async () =>
      Response.json(
        await nativeAggregate(
          'fixture-native-array',
          'site',
          { startDate: new Date(1000), endDate: new Date(2000), timezone: 'Asia/Shanghai' },
          {},
          load,
        ),
      ),
    );
  const cold = await request();
  const coldMetadata = JSON.parse(cold.headers.get('X-Liekan-Population') || '{}');
  expect(coldMetadata.populations[0].identity).toMatchObject({ status: 'partial', coverage: 0.5 });
  expect(coldMetadata.populations[0].governanceProcessing).toMatchObject({
    state: 'observed',
    computedAt: new Date(900).toISOString(),
  });
  population = {
    ...population,
    identity: { ...population.identity, status: 'complete', coverage: 1 },
  };
  const warm = await request();
  expect(warm.headers.get('X-Liekan-Population')).toBe(cold.headers.get('X-Liekan-Population'));
  expect(await warm.json()).toEqual([{ pageviews: 2, visitors: null }]);
  expect(load).toHaveBeenCalledTimes(1);
});
