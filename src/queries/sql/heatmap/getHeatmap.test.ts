// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import type { BrowserPopulation } from '@/lib/liekan/contracts/browser-population';
import {
  CacheProbeMiss,
  currentCacheContext,
  noteBrowserPopulation,
  probeCacheOnly,
  withQueryCacheHeaders,
} from '@/lib/liekan/upstream/cache-context';
import { analyticsCache, websiteCacheTag } from '@/lib/liekan/upstream/query-cache';
import { getQuerySnapshot, withinQuerySnapshot } from '@/lib/liekan/upstream/query-snapshot';
import {
  getHeatmap,
  getRelationalHeatmapFilterContext,
  type HeatmapParameters,
} from './getHeatmap';

const mocks = vi.hoisted(() => ({
  mode: 'prisma',
  raw: vi.fn(),
  clickhouse: vi.fn(),
  population: vi.fn(),
  snapshot: vi.fn(),
  parseFilters: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  PRISMA: 'prisma',
  CLICKHOUSE: 'clickhouse',
  runQuery: (queries: Record<string, () => unknown>) => queries[mocks.mode](),
}));
vi.mock('@/lib/prisma', () => ({
  default: { rawQuery: mocks.raw, parseFilters: mocks.parseFilters },
}));
vi.mock('@/lib/clickhouse', () => ({
  default: { rawQuery: mocks.clickhouse, parseFilters: mocks.parseFilters },
}));
vi.mock('@/queries/prisma', () => ({
  getWebsite: async () => ({ domain: 'synthetic.invalid' }),
}));
vi.mock('@/lib/liekan/upstream/browser-population', () => ({
  readBrowserPopulation: mocks.population,
}));
vi.mock('@/lib/liekan/upstream/server', () => ({ reportSnapshot: mocks.snapshot }));

const parameters: HeatmapParameters = {
  startDate: new Date('2024-01-01T00:00:00Z'),
  endDate: new Date('2024-01-02T00:00:00Z'),
  timezone: 'Asia/Shanghai',
  urlPath: '/synthetic',
};
const basePopulation: BrowserPopulation = {
  resourceKind: 'website',
  capability: 'supported',
  scope: 'resource-window',
  populationVersion: 'traffic-quality-browser-population-v4',
  policyRevision: '7',
  epoch: '1',
  historyActiveGeneration: null,
  historyRevision: '0',
  governanceRevision: '2',
  governanceWatermark: null,
  identity: {
    status: 'complete',
    eligibleEvents: 2,
    eligiblePV: 2,
    qualifiedPV: 2,
    qualifiedVisitors: 1,
    coverage: 1,
    versions: ['synthetic-identity-v1'],
  },
  ruleVersions: ['synthetic-rule-v1'],
  catalogVersions: [],
  versionSetsTruncated: false,
  range: {
    startAt: +parameters.startDate,
    endAt: +parameters.endDate,
    timezone: parameters.timezone,
  },
};
let population: BrowserPopulation;
const executor = { $executeRawUnsafe: vi.fn(), $queryRawUnsafe: vi.fn() };
const rows = (sql: string, bindings: Record<string, unknown>) => {
  if (/group by h\.url_path/.test(sql))
    return [{ urlPath: bindings.urlPath || '/synthetic', count: 2, sessions: 1 }];
  if (/per_session/.test(sql))
    return [{ depth: 90, sessions: 1, pageW: 1000, pageH: 2000, viewportW: 1000, viewportH: 800 }];
  return [
    {
      x: 10,
      y: 20,
      pageX: 10,
      pageY: 20,
      pageW: 1000,
      pageH: 2000,
      viewportW: 1000,
      viewportH: 800,
      count: 2,
    },
  ];
};
beforeEach(() => {
  analyticsCache.clear();
  vi.clearAllMocks();
  mocks.mode = 'prisma';
  population = structuredClone(basePopulation);
  mocks.snapshot.mockImplementation((load: () => Promise<unknown>) =>
    withinQuerySnapshot(executor, load),
  );
  mocks.parseFilters.mockImplementation((filters: Record<string, unknown>) => ({
    queryParams: { websiteId: filters.websiteId, browser: filters.browser },
    filterQuery: filters.browser ? 'and website_event.browser = {{browser}}' : '',
    joinSessionQuery: '',
    cohortQuery: '',
    excludeBounceQuery: '',
  }));
  mocks.raw.mockImplementation(async (sql: string, bindings: Record<string, unknown>) => {
    if (currentCacheContext()?.probeOnly) throw new CacheProbeMiss();
    expect(getQuerySnapshot()).toBeDefined();
    return rows(sql, bindings);
  });
  mocks.clickhouse.mockImplementation(async (sql: string, bindings: Record<string, unknown>) =>
    rows(sql, bindings),
  );
  mocks.population.mockImplementation(async (site: string) => {
    expect(getQuerySnapshot()).toBeDefined();
    noteBrowserPopulation(site, population);
    return structuredClone(population);
  });
});
const request = (input = parameters, site = 'synthetic-site') =>
  withQueryCacheHeaders(async () => Response.json(await getHeatmap(site, input)));

it('checks filtered membership within each candidate heatmap visit', () => {
  const context = getRelationalHeatmapFilterContext('synthetic-site', {
    ...parameters,
    browser: 'eq.Synthetic Firefox',
  });
  expect(context.joinQuery).toBe('');
  expect(context.filterQuery).toContain('exists (');
  expect(context.filterQuery).toContain('website_event.session_id = h.session_id');
  expect(context.filterQuery).toContain('website_event.visit_id = h.visit_id');
  expect(context.filterQuery).toContain('website_event.website_id = h.website_id');
  expect(context.filterQuery).toContain('offset 0');
  expect(context.filterQuery).toContain('website_event.browser = {{browser}}');
});

it.each(['click', 'scroll'] as const)(
  'caches the complete %s snapshot and population envelope',
  async mode => {
    const cold = await request({ ...parameters, mode });
    const coldBody = await cold.json();
    expect(coldBody.pages).toEqual([{ urlPath: '/synthetic', count: 2, sessions: 1 }]);
    expect(coldBody.population).toMatchObject({
      identity: { status: 'complete' },
      policyRevision: '7',
    });
    expect(coldBody.snapshot).toMatchObject({
      kind: 'iframe',
      url: 'https://synthetic.invalid/synthetic',
    });
    population.identity.status = 'partial';
    population.identity.coverage = 0.5;
    const warm = await request({ ...parameters, mode });
    expect(await warm.json()).toEqual(coldBody);
    expect(cold.headers.get('X-Liekan-Cache')).toBe('miss');
    expect(warm.headers.get('X-Liekan-Cache')).toBe('hit');
    expect(warm.headers.get('X-Liekan-Population')).toBe(cold.headers.get('X-Liekan-Population'));
    expect(mocks.raw).toHaveBeenCalledTimes(2);
    expect(mocks.population).toHaveBeenCalledTimes(1);
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
  },
);

it('serves cache-only probes without executing a heatmap query or population load', async () => {
  const probe = () =>
    withQueryCacheHeaders(async () =>
      Response.json((await probeCacheOnly(() => getHeatmap('synthetic-site', parameters))) ?? null),
    );
  expect(await (await probe()).json()).toBeNull();
  expect(mocks.raw).not.toHaveBeenCalled();
  await request();
  mocks.raw.mockClear();
  mocks.population.mockClear();
  const warm = await probe();
  expect((await warm.json()).pages).toHaveLength(1);
  expect(warm.headers.get('X-Liekan-Cache')).toBe('hit');
  expect(mocks.raw).not.toHaveBeenCalled();
  expect(mocks.population).not.toHaveBeenCalled();
});

it('retains snapshot and internal-call bypass behavior', async () => {
  await request();
  mocks.snapshot.mockClear();
  mocks.raw.mockClear();
  await withinQuerySnapshot(executor, () => request());
  expect(mocks.raw).toHaveBeenCalledTimes(2);
  expect(mocks.snapshot).not.toHaveBeenCalled();
  mocks.raw.mockClear();
  await getHeatmap('synthetic-site', parameters);
  await getHeatmap('synthetic-site', parameters);
  expect(mocks.raw).toHaveBeenCalledTimes(4);
  expect(mocks.snapshot).toHaveBeenCalledTimes(2);
});

it('separates website, path, mode and filters in the aggregate identity', async () => {
  await request();
  await request({ ...parameters, browser: 'eq.Synthetic Firefox' });
  await request({ ...parameters, urlPath: '/another' });
  await request({ ...parameters, mode: 'scroll' });
  await request(parameters, 'another-site');
  await request();
  expect(mocks.population).toHaveBeenCalledTimes(5);
  expect(mocks.raw).toHaveBeenCalledTimes(10);
  expect(mocks.raw.mock.calls[2][0]).toContain('website_event.visit_id = h.visit_id');
  expect(mocks.raw.mock.calls[2][1]).toMatchObject({ browser: 'eq.Synthetic Firefox' });
});

it('recomputes a refresh and an invalidated website while preserving identity masking', async () => {
  await request({ ...parameters, mode: 'scroll' });
  population.identity = { ...population.identity, status: 'partial', coverage: 0.5 };
  const refreshed = await request({
    ...parameters,
    mode: 'scroll',
    refresh: '1',
  } as HeatmapParameters);
  const body = await refreshed.json();
  expect(refreshed.headers.get('X-Liekan-Cache')).toBe('miss');
  expect(body.pages[0].sessions).toBeNull();
  expect(body.scroll.buckets[0].sessions).toBeNull();
  expect(body.scroll.totalSessions).toBeNull();
  expect(body.population.identity.status).toBe('partial');
  const normal = await request({ ...parameters, mode: 'scroll' });
  expect(normal.headers.get('X-Liekan-Cache')).toBe('hit');
  expect(await normal.json()).toEqual(body);
  expect(mocks.population).toHaveBeenCalledTimes(2);
  analyticsCache.invalidate(websiteCacheTag('synthetic-site'));
  const invalidated = await request({ ...parameters, mode: 'scroll' });
  expect(invalidated.headers.get('X-Liekan-Cache')).toBe('miss');
  expect((await invalidated.json()).scroll.totalSessions).toBeNull();
  expect(mocks.population).toHaveBeenCalledTimes(3);
});

it('keeps ClickHouse queries and result shape on their existing path', async () => {
  mocks.mode = 'clickhouse';
  const first = await request();
  const second = await request();
  expect(await second.json()).toEqual(await first.json());
  expect(second.headers.get('X-Liekan-Cache')).toBeNull();
  expect(mocks.clickhouse).toHaveBeenCalledTimes(4);
  expect(mocks.raw).not.toHaveBeenCalled();
  expect(mocks.population).not.toHaveBeenCalled();
  expect(mocks.snapshot).not.toHaveBeenCalled();
});
