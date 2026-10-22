import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ read: vi.fn(), authorize: vi.fn(), query: vi.fn() }));
vi.mock('../upstream/query-cache', () => ({
  analyticsCache: { read: h.read },
  analyticsCacheKey: (_kind: string, value: unknown) => JSON.stringify(value),
  websiteCacheTag: (id: string) => `website:${id}`,
}));
vi.mock('../upstream/crawler-access', () => ({
  authorizeCrawler: h.authorize,
  crawlerTransaction: (work: any) => work({ query: h.query }),
}));
vi.mock('../upstream/analytics', () => ({ crawlerReferralRows: vi.fn() }));

import { crawlerAnalysis } from './analysis';
import { withQueryCacheHeaders } from '../upstream/cache-context';

beforeEach(() => {
  h.authorize.mockResolvedValue({ canDraft: true, canControl: true });
  h.query.mockResolvedValue([{ epoch: 1, data_revision: 0 }]);
  h.read.mockResolvedValue({
    value: { bots: [], criticalPaths: [] },
    generatedAt: 1000,
    expiresAt: 31000,
    status: 'hit',
    tier: 'memory',
  });
});

it('reports the actual cached crawler snapshot time through the request boundary', async () => {
  const response = await withQueryCacheHeaders(async () =>
    Response.json(
      await crawlerAnalysis({ id: 'actor', role: 'admin' }, 'site', {
        startAt: 1,
        endAt: 1000,
        timezone: 'UTC',
      }),
    ),
  );
  expect(response.headers.get('x-liekan-generated-at')).toBe('1000');
  expect(response.headers.get('x-liekan-expires-at')).toBe('31000');
  expect(response.headers.get('x-liekan-cache')).toBe('hit');
  expect(h.authorize).toHaveBeenCalledTimes(2);
});

it('replays cached current and previous identity metadata without reading a new population', async () => {
  const { populationFromRow } = await import('../upstream/browser-population');
  const population = populationFromRow(
    { eligibleEvents: 2, qualifiedEvents: 1, eligiblePV: 2, qualifiedPV: 1, qualifiedVisitors: 1 },
    { startAt: 1, endAt: 1000, timezone: 'UTC', endExclusive: true },
  );
  const previous = {
    ...population,
    range: { ...population.range, startAt: 0, endAt: 1 },
    identity: {
      ...population.identity,
      status: 'empty' as const,
      eligibleEvents: 0,
      eligiblePV: 0,
      qualifiedPV: 0,
      qualifiedVisitors: 0,
      coverage: null,
    },
  };
  h.read.mockResolvedValue({
    value: { population, previous: { population: previous }, platforms: [{ visits: null }] },
    generatedAt: 1000,
    expiresAt: 31000,
    status: 'hit',
    tier: 'memory',
  });
  const response = await withQueryCacheHeaders(async () =>
    Response.json(await crawlerAnalysis({ id: 'actor', role: 'admin' }, 'site', population.range)),
  );
  expect(
    JSON.parse(response.headers.get('X-Liekan-Population')!).populations.map(
      row => row.identity.status,
    ),
  ).toEqual(['partial', 'empty']);
  expect((await response.json()).population).toEqual(population);
  expect(
    h.query.mock.calls.every(([sql]) => !sql.includes('WITH population AS MATERIALIZED')),
  ).toBe(true);
});
