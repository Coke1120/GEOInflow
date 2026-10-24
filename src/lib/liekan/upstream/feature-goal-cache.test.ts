// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Auth } from '@/lib/types';
import { featureGoal } from './feature-analytics';
import { populationFromRow } from './browser-population';
import {
  CacheProbeMiss,
  currentCacheContext,
  noteBrowserPopulation,
  probeCacheOnly,
  withQueryCacheHeaders,
} from './cache-context';
import { analyticsCache } from './query-cache';
import { getQuerySnapshot, withinQuerySnapshot } from './query-snapshot';

const mocks = vi.hoisted(() => ({
  report: vi.fn(),
  allowed: vi.fn(),
  filters: vi.fn(),
  raw: vi.fn(),
  population: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock('@/queries/prisma', () => ({
  getReport: mocks.report,
  getWebsiteSegment: async () => null,
}));
vi.mock('@/permissions', () => ({ canViewReport: mocks.allowed }));
vi.mock('@/lib/request', () => ({ getQueryFilters: mocks.filters }));
vi.mock('@/lib/prisma', () => ({
  default: {
    parseFilters: (filters: any) => ({
      filterQuery: '',
      joinSessionQuery: '',
      cohortQuery: '',
      excludeBounceQuery: '',
      queryParams: filters,
    }),
    rawQuery: mocks.raw,
    getDateSQL: () => "to_char(created_at,'YYYY-MM-DD')",
  },
}));
vi.mock('./browser-population', async importOriginal => ({
  ...(await importOriginal<typeof import('./browser-population')>()),
  readBrowserPopulation: mocks.population,
}));
vi.mock('./server', async () => ({
  LiekanError: (await import('./errors')).LiekanError,
  reportSnapshot: mocks.snapshot,
}));
vi.mock('./analytics', () => ({ classifyEntrySource: vi.fn() }));
vi.mock('@/queries/sql/heatmap/getHeatmap', () => ({ getRelationalHeatmapFilterContext: vi.fn() }));

const site = '11111111-1111-4111-8111-111111111111';
const auth = { user: { id: 'synthetic-actor' } } as Auth;
const input = {
  startAt: Date.parse('2024-01-01T00:00:00Z'),
  endAt: Date.parse('2024-01-02T00:00:00Z'),
  timezone: 'UTC',
};
const executor = { $executeRawUnsafe: vi.fn(), $queryRawUnsafe: vi.fn() };
let report: { websiteId: string; type: string; parameters: { type: string; value: string } };
let population: ReturnType<typeof populationFromRow>;
const load = () => featureGoal(site, 'synthetic-goal', input, auth);
const request = (work = load) => withQueryCacheHeaders(async () => Response.json(await work()));
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  analyticsCache.clear();
  vi.clearAllMocks();
  vi.stubEnv('CLICKHOUSE_URL', '');
  report = { websiteId: site, type: 'goal', parameters: { type: 'path', value: '/purchase' } };
  population = populationFromRow(
    {
      resourceKind: 'website',
      eligibleEvents: 4,
      qualifiedEvents: 4,
      eligiblePV: 4,
      qualifiedPV: 4,
      qualifiedVisitors: 2,
      governanceRevision: '7',
    },
    input,
  );
  mocks.report.mockImplementation(async () => report);
  mocks.allowed.mockResolvedValue(true);
  mocks.filters.mockImplementation(async (p: typeof input) => ({
    startDate: new Date(p.startAt),
    endDate: new Date(p.endAt),
    timezone: p.timezone,
  }));
  mocks.snapshot.mockImplementation((work: () => Promise<unknown>) =>
    withinQuerySnapshot(executor, work),
  );
  mocks.population.mockImplementation(async (id: string) => {
    noteBrowserPopulation(id, population);
    return structuredClone(population);
  });
  mocks.raw.mockImplementation(async (sql: string, bindings: any) => {
    if (currentCacheContext()?.probeOnly) throw new CacheProbeMiss();
    expect(getQuerySnapshot()).toBeDefined();
    const conversions = bindings.target === '/changed' ? 3 : 2;
    return sql.includes('AS conversions')
      ? [{ conversions, num: 1, total: 4 }]
      : [{ x: '2024-01-01T00:00:00Z', y: conversions }];
  });
});

it('caches the authorized saved-goal snapshot and exact population metadata', async () => {
  const cold = await request();
  const expected = await cold.json();
  expect(expected).toMatchObject({
    conversions: 2,
    num: 1,
    total: 4,
    population: { governanceRevision: '7' },
  });
  expect(expected.series.map((point: any) => point.y)).toEqual([2, 0]);
  population.governanceRevision = '8';
  const warm = await request();
  expect(await warm.json()).toEqual(expected);
  expect(cold.headers.get('X-Liekan-Cache')).toBe('miss');
  expect(warm.headers.get('X-Liekan-Cache')).toBe('hit');
  expect(warm.headers.get('X-Liekan-Population')).toBe(cold.headers.get('X-Liekan-Population'));
  expect(mocks.raw).toHaveBeenCalledTimes(2);
  expect(mocks.population).toHaveBeenCalledTimes(1);
  expect(mocks.report).toHaveBeenCalledTimes(2);
  expect(mocks.allowed).toHaveBeenCalledTimes(2);
  expect(mocks.filters).toHaveBeenCalledTimes(2);
});

it.each(['deleted', 'denied', 'wrong-site', 'wrong-type', 'invalid-goal'] as const)(
  'rechecks %s before a warm cache hit',
  async state => {
    await request();
    mocks.raw.mockClear();
    if (state === 'deleted') mocks.report.mockResolvedValue(null);
    if (state === 'denied') mocks.allowed.mockResolvedValue(false);
    if (state === 'wrong-site') report.websiteId = 'another-site';
    if (state === 'wrong-type') report.type = 'funnel';
    if (state === 'invalid-goal') mocks.report.mockResolvedValue({ ...report, parameters: {} });
    await expect(request()).rejects.toMatchObject({
      status: state === 'denied' ? 403 : state === 'invalid-goal' ? 400 : 404,
    });
    expect(mocks.raw).not.toHaveBeenCalled();
  },
);

it('keys the producer by the freshly validated goal configuration', async () => {
  await request();
  report.parameters = { type: 'path', value: '/changed' };
  const changed = await request();
  expect((await changed.json()).conversions).toBe(3);
  expect(changed.headers.get('X-Liekan-Cache')).toBe('miss');
  expect(mocks.report).toHaveBeenCalledTimes(2);
  expect(mocks.raw.mock.calls[2][1].target).toBe('/changed');
});

it('supports cache-only probes and retains existing-snapshot bypass', async () => {
  const probe = () => request(async () => (await probeCacheOnly(load)) ?? null);
  expect(await (await probe()).json()).toBeNull();
  expect(mocks.raw).not.toHaveBeenCalled();
  await request();
  mocks.raw.mockClear();
  expect((await (await probe()).json()).conversions).toBe(2);
  expect(mocks.raw).not.toHaveBeenCalled();
  await withinQuerySnapshot(executor, () => request());
  expect(mocks.raw).toHaveBeenCalledTimes(2);
});

it('keeps ClickHouse denial ahead of a warm result', async () => {
  await request();
  mocks.raw.mockClear();
  vi.stubEnv('CLICKHOUSE_URL', 'synthetic://disabled');
  await expect(request()).rejects.toMatchObject({ status: 501 });
  expect(mocks.raw).not.toHaveBeenCalled();
});
