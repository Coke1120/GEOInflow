import { beforeEach, expect, it, vi } from 'vitest';
import { GET } from './route';
import { populationFromRow } from '@/lib/liekan/upstream/browser-population';
const fixtures = vi.hoisted(() => ({ metrics: vi.fn() }));
vi.mock('@/lib/liekan/upstream/cache-context', () => ({
  withQueryCacheHeaders: (work: () => unknown) => work(),
}));
vi.mock('@/lib/request', () => ({
  parseRequest: async () => ({ auth: {}, query: { startAt: 1000, endAt: 2000 } }),
  getQueryFilters: async () => ({ startDate: new Date(1000), endDate: new Date(2000) }),
}));
vi.mock('@/permissions', () => ({ canViewWebsiteSection: async () => true }));
vi.mock('@/queries/sql', () => ({ getWebsiteSessionStats: fixtures.metrics }));
const population = populationFromRow(
  {
    resourceKind: 'website',
    eligibleEvents: 2,
    qualifiedEvents: 1,
    eligiblePV: 2,
    qualifiedPV: 1,
    qualifiedVisitors: 1,
  },
  { startAt: 1000, endAt: 2000, timezone: 'UTC' },
);
beforeEach(() => fixtures.metrics.mockReset());
const read = async () =>
  (
    await GET(new Request('https://synthetic.test/api/websites/site/sessions/stats'), {
      params: Promise.resolve({ websiteId: 'site' }),
    })
  ).json();
it('preserves unavailable values and keeps population metadata outside metric wrappers', async () => {
  fixtures.metrics.mockResolvedValue([
    { visitors: null, visits: null, pageviews: 2n, events: 1n, countries: 1n, population },
  ]);
  expect(await read()).toEqual({
    visitors: { value: null },
    visits: { value: null },
    pageviews: { value: 2 },
    events: { value: 1 },
    countries: { value: 1 },
    population,
  });
});
it('retains complete and empty numeric values', async () => {
  fixtures.metrics.mockResolvedValue([
    { visitors: 2n, visits: 3n, pageviews: 4n, events: 0n, countries: 1n },
  ]);
  expect(await read()).toMatchObject({
    visitors: { value: 2 },
    visits: { value: 3 },
    events: { value: 0 },
  });
});
