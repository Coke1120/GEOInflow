// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ execute: vi.fn(), versions: vi.fn(), query: vi.fn() }));
vi.mock('@/lib/request', () => ({
  getQueryFilters: async () => ({
    startDate: new Date(3600000),
    endDate: new Date(7200000),
    timezone: 'UTC',
  }),
}));
vi.mock('./server', () => ({ reportSnapshot: (work: () => unknown) => work(), query: m.query }));
vi.mock('./query-snapshot', () => ({ getQuerySnapshot: () => ({}) }));
vi.mock('./analysis-rollups-db', () => ({ analysisVersions: m.versions }));
vi.mock('./analytics-revision', () => ({
  readAnalyticsVersions: async () => ({ strong: 'current' }),
}));
vi.mock('./analysis-native-execution', () => ({ executeNativeAnalysis: m.execute }));
vi.mock('./analytics-budget', () => ({
  analyticsGate: { run: (work: () => unknown) => work() },
  AnalyticsUnavailable: class extends Error {},
  AnalyticsRestart: class extends Error {},
}));
import { tryFastAnalysis } from './analysis-fast-read';
import { bypassQueryCache, noteBrowserPopulation, withQueryCacheHeaders } from './cache-context';
const site = '11111111-1111-4111-8111-111111111111';
const population = {
  resourceId: site,
  populationVersion: 'browser-population-v4',
  resourceKind: 'website' as const,
  capability: 'supported' as const,
  scope: 'resource-window' as const,
  policyRevision: '1',
  historyActiveGeneration: null,
  historyRevision: null,
  epoch: '3',
  governanceRevision: '4',
  governanceWatermark: null,
  identity: {
    status: 'partial' as const,
    eligibleEvents: 8,
    eligiblePV: 5,
    qualifiedPV: 2,
    qualifiedVisitors: 1,
    coverage: 0.4,
    versions: ['identity-v1'],
  },
  ruleVersions: ['rule-v1'],
  catalogVersions: ['catalog-v1'],
  versionSetsTruncated: false,
  range: { startAt: 3600000, endAt: 7200000, timezone: 'UTC', endExclusive: true },
};
beforeEach(() => {
  vi.resetAllMocks();
  m.versions.mockResolvedValue({ engine: 'current' });
  m.query.mockImplementation(async (sql: string) =>
    sql.includes('range_agg') ? [{ complete: true }] : [{ epoch: '3' }],
  );
  m.execute.mockImplementation(async () => {
    expect(bypassQueryCache()).toBe(true);
    noteBrowserPopulation(site, population);
    return [{ x: 'Chrome', y: null }];
  });
});
const read = () =>
  tryFastAnalysis({ id: site, name: 'fixture', domain: 'fixture.invalid' }, 'native:metrics', {
    startAt: 3600000,
    endAt: 7200000,
    timezone: 'UTC',
    type: 'browser',
  });
it('captures native population inside cache bypass and replays it after both coverage fences', async () => {
  const response = await withQueryCacheHeaders(async () => {
    const result = await read();
    expect(result?.value).toEqual([{ x: 'Chrome', y: null }]);
    return Response.json(result.value);
  });
  expect(JSON.parse(response.headers.get('X-Liekan-Population')).populations).toEqual([population]);
  expect(await response.json()).toEqual([{ x: 'Chrome', y: null }]);
});
it('discards computed population metadata if the final published version changed', async () => {
  m.versions.mockResolvedValueOnce({ engine: 'old' }).mockResolvedValueOnce({ engine: 'new' });
  const response = await withQueryCacheHeaders(async () => {
    expect(await read()).toBeUndefined();
    return Response.json({ pending: true });
  });
  expect(m.execute).toHaveBeenCalledTimes(1);
  expect(response.headers.has('X-Liekan-Population')).toBe(false);
});
it('preserves empty current and comparison stats without adding an envelope to the native DTO', async () => {
  const empty = {
    ...population,
    identity: {
      ...population.identity,
      status: 'empty' as const,
      eligibleEvents: 0,
      eligiblePV: 0,
      qualifiedPV: 0,
      qualifiedVisitors: 0,
      coverage: null,
      versions: [],
    },
  };
  const comparison = { ...empty, range: { ...empty.range, startAt: 0, endAt: 3600000 } };
  const value = { pageviews: 0, visitors: 0, visits: 0, bounces: 0, totaltime: 0 };
  m.execute.mockImplementation(async () => {
    expect(bypassQueryCache()).toBe(true);
    noteBrowserPopulation(site, empty);
    noteBrowserPopulation(site, comparison);
    return { ...value, population: empty, comparison: { ...value, population: comparison } };
  });
  const response = await withQueryCacheHeaders(async () => {
    const result = await tryFastAnalysis(
      { id: site, name: 'fixture', domain: 'fixture.invalid' },
      'native:stats',
      { startAt: 3600000, endAt: 7200000, timezone: 'UTC' },
    );
    expect(result?.value).toMatchObject({ ...value, comparison: value });
    return Response.json(result?.value);
  });
  expect(JSON.parse(response.headers.get('X-Liekan-Population')).populations).toEqual([
    empty,
    comparison,
  ]);
  expect((await response.json()).format).toBeUndefined();
});
