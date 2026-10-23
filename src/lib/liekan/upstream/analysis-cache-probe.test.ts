// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { QueryCache } from './query-cache';
import {
  CacheProbeMiss,
  probeCacheOnly,
  noteBrowserPopulation,
  noteCacheResult,
  withQueryCacheHeaders,
} from './cache-context';
import { populationFromRow } from './browser-population';
it('returns a native cache hit without recomputing and keeps its original expiry', async () => {
  const now = Date.now(),
    cache = new QueryCache();
  cache.putLocal(
    'fixture',
    { value: { visitors: 7 }, generatedAt: now - 100, expiresAt: now + 10000, status: 'hit' },
    [],
  );
  const load = vi.fn();
  const response = await withQueryCacheHeaders(async () => {
    const value = await probeCacheOnly(async () => {
      const result = await cache.read('fixture', 30000, [], load);
      noteCacheResult(result);
      return result.value;
    });
    return Response.json(value);
  });
  expect(await response.json()).toEqual({ visitors: 7 });
  expect(response.headers.get('X-Liekan-Expires-At')).toBe(String(now + 10000));
  expect(load).not.toHaveBeenCalled();
});
it('drops partial probe freshness on a miss and never starts the query producer', async () => {
  const cache = new QueryCache(),
    load = vi.fn();
  const response = await withQueryCacheHeaders(async () => {
    expect(await probeCacheOnly(() => cache.read('missing', 30000, [], load))).toBeUndefined();
    return Response.json({ queued: true }, { status: 202 });
  });
  expect(load).not.toHaveBeenCalled();
  expect(response.headers.has('X-Liekan-Expires-At')).toBe(false);
});

const populationSite = '3e17368d-86b3-40db-8a89-d8c241b3a65d';
const originalPopulation = () =>
  populationFromRow(
    {
      resourceKind: 'website',
      eligibleEvents: 4,
      qualifiedEvents: 2,
      eligiblePV: 4,
      qualifiedPV: 2,
      qualifiedVisitors: 1,
    },
    { startAt: 1000, endAt: 2000, timezone: 'UTC' },
  );
it('replays a successful native cache probe population to the enclosing response headers', async () => {
  const population = originalPopulation(),
    cache = new QueryCache(),
    now = Date.now();
  const payload = { rows: [{ x: 'Firefox', y: null }], population };
  cache.putLocal(
    'population-hit',
    { value: payload, generatedAt: now - 100, expiresAt: now + 10000, status: 'hit' },
    [],
  );
  const load = vi.fn(async () => payload);
  const response = await withQueryCacheHeaders(async () => {
    const result = await probeCacheOnly(async () => {
      const cached = await cache.read('population-hit', 30000, [], load);
      noteCacheResult(cached);
      noteBrowserPopulation(populationSite, cached.value.population);
      return cached.value.rows;
    });
    return Response.json(result);
  });
  expect(await response.json()).toEqual([{ x: 'Firefox', y: null }]);
  expect(JSON.parse(response.headers.get('X-Liekan-Population') || '{}')).toMatchObject({
    populations: [
      { resourceId: populationSite, identity: { status: 'partial', eligibleEvents: 4 } },
    ],
  });
  expect(response.headers.get('X-Liekan-Expires-At')).toBe(String(now + 10000));
  expect(load).not.toHaveBeenCalled();
});
it.each(['miss', 'unobserved', 'failure'] as const)(
  'discards probe population metadata after %s without mutating an existing parent',
  async mode => {
    const population = originalPopulation();
    const response = await withQueryCacheHeaders(async () => {
      noteBrowserPopulation(populationSite, population);
      const probe = () =>
        probeCacheOnly(async () => {
          noteBrowserPopulation(populationSite, {
            ...population,
            identity: { ...population.identity, status: 'complete', eligibleEvents: 99 },
          });
          if (mode === 'miss') throw new CacheProbeMiss();
          if (mode === 'failure') throw new Error('synthetic probe failure');
          return { unobserved: true };
        });
      if (mode === 'failure') await expect(probe()).rejects.toThrow('synthetic probe failure');
      else expect(await probe()).toBeUndefined();
      return Response.json({ queued: true }, { status: 202 });
    });
    expect(JSON.parse(response.headers.get('X-Liekan-Population') || '{}')).toMatchObject({
      populations: [
        { resourceId: populationSite, identity: { status: 'partial', eligibleEvents: 4 } },
      ],
    });
    expect(response.headers.has('X-Liekan-Expires-At')).toBe(false);
  },
);
