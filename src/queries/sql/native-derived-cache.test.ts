// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { populationFromRow } from '@/lib/liekan/upstream/browser-population';
import {
  CacheProbeMiss,
  currentCacheContext,
  probeCacheOnly,
  withQueryCacheHeaders,
} from '@/lib/liekan/upstream/cache-context';
import { analyticsCache } from '@/lib/liekan/upstream/query-cache';
import { getQuerySnapshot, withinQuerySnapshot } from '@/lib/liekan/upstream/query-snapshot';
import { getWebsiteStats } from './getWebsiteStats';
import { getSessionMetrics } from './sessions/getSessionMetrics';

const mocks = vi.hoisted(() => ({
  totals: vi.fn(),
  metrics: vi.fn(),
  population: vi.fn(),
  raw: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  PRISMA: 'prisma',
  CLICKHOUSE: 'clickhouse',
  runQuery: (queries: Record<string, () => unknown>) => queries.prisma(),
}));
vi.mock('@/lib/liekan/upstream/analysis-rollups', () => ({
  readAnalysisVisitTotals: mocks.totals,
  readAnalysisVisitMetrics: mocks.metrics,
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    rawQuery: mocks.raw,
    getTimestampDiffSQL: () => 'max_time-min_time',
    parseFilters: () => ({
      filterQuery: '',
      joinSessionQuery: '',
      cohortQuery: '',
      excludeBounceQuery: '',
      queryParams: {},
    }),
  },
}));
vi.mock('@/lib/clickhouse', () => ({ default: {} }));
vi.mock('@/lib/liekan/upstream/browser-population', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/liekan/upstream/browser-population')>()),
  readBrowserPopulation: mocks.population,
}));
vi.mock('@/lib/liekan/upstream/server', () => ({ reportSnapshot: mocks.snapshot }));

const websiteId = '11111111-1111-4111-8111-111111111111';
const filters = {
  startDate: new Date('2024-01-01T00:00:00Z'),
  endDate: new Date('2024-01-02T00:00:00Z'),
  timezone: 'Asia/Shanghai',
};
const counts = { pageviews: 2, visitors: 1, visits: 1, bounces: 0, totaltime: 5 };
const metric = { type: 'browser', limit: 20, offset: 0 };
const executor = { $executeRawUnsafe: vi.fn(), $queryRawUnsafe: vi.fn() };
let population: ReturnType<typeof populationFromRow>;
beforeEach(() => {
  analyticsCache.clear();
  vi.clearAllMocks();
  population = populationFromRow(
    {
      resourceKind: 'website',
      policyRevision: '7',
      epoch: '1',
      governanceRevision: '2',
      eligibleEvents: 3,
      qualifiedEvents: 3,
      eligiblePV: 2,
      qualifiedPV: 2,
      qualifiedVisitors: 1,
      identityVersions: ['synthetic-identity-v1'],
      ruleVersions: ['synthetic-rule-v1'],
    },
    { startAt: +filters.startDate, endAt: +filters.endDate, timezone: filters.timezone },
  );
  mocks.snapshot.mockImplementation((load: () => Promise<unknown>) =>
    withinQuerySnapshot(executor, load),
  );
  mocks.totals.mockImplementation(async () => {
    expect(getQuerySnapshot()).toBeDefined();
    return { ...counts };
  });
  mocks.metrics.mockImplementation(async () => {
    expect(getQuerySnapshot()).toBeDefined();
    return [{ x: 'Synthetic Firefox', y: 1 }];
  });
  mocks.population.mockImplementation(async () => {
    expect(getQuerySnapshot()).toBeDefined();
    return structuredClone(population);
  });
  mocks.raw.mockImplementation(async () => {
    if (currentCacheContext()?.probeOnly) throw new CacheProbeMiss();
    throw new Error('covered fixture must use the derived producer');
  });
});
const entries = [
  {
    name: 'stats',
    load: () => getWebsiteStats(websiteId, filters),
    producer: mocks.totals,
    expected: counts,
  },
  {
    name: 'metrics',
    load: () => getSessionMetrics(websiteId, metric, filters),
    producer: mocks.metrics,
    expected: [{ x: 'Synthetic Firefox', y: 1 }],
  },
];
const request = (load: () => Promise<unknown>) =>
  withQueryCacheHeaders(async () => Response.json(await load()));

it.each(entries)(
  'caches the complete derived $name result and exact population metadata',
  async entry => {
    const cold = await request(entry.load);
    const coldBody = await cold.json();
    if (entry.name === 'stats') {
      expect(coldBody).toMatchObject(counts);
      expect(coldBody.population).toEqual(population);
    } else expect(coldBody).toEqual(entry.expected);
    const metadata = JSON.parse(cold.headers.get('X-Liekan-Population'));
    expect(metadata.populations[0]).toMatchObject({
      resourceId: websiteId,
      policyRevision: '7',
      governanceRevision: '2',
      identity: { status: 'complete', eligiblePV: 2, versions: ['synthetic-identity-v1'] },
    });
    population.governanceRevision = '3';
    population.identity = { ...population.identity, status: 'partial', coverage: 0.5 };
    const warm = await request(entry.load);
    expect(await warm.json()).toEqual(coldBody);
    expect(warm.headers.get('X-Liekan-Population')).toBe(cold.headers.get('X-Liekan-Population'));
    expect(cold.headers.get('X-Liekan-Cache')).toBe('miss');
    expect(warm.headers.get('X-Liekan-Cache')).toBe('hit');
    expect(entry.producer).toHaveBeenCalledTimes(1);
    expect(mocks.population).toHaveBeenCalledTimes(1);
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
    expect(mocks.raw).not.toHaveBeenCalled();
  },
);

it.each(entries)('probes $name without a raw or derived load', async entry => {
  const probe = () => request(async () => (await probeCacheOnly(entry.load)) ?? null);
  expect(await (await probe()).json()).toBeNull();
  expect(mocks.raw).not.toHaveBeenCalled();
  expect(entry.producer).not.toHaveBeenCalled();
  await request(entry.load);
  entry.producer.mockClear();
  mocks.population.mockClear();
  const cached = await probe();
  expect(await cached.json()).not.toBeNull();
  expect(cached.headers.get('X-Liekan-Cache')).toBe('hit');
  expect(entry.producer).not.toHaveBeenCalled();
  expect(mocks.population).not.toHaveBeenCalled();
});

it.each(entries)('retains $name existing-snapshot and no-context bypass', async entry => {
  await request(entry.load);
  mocks.snapshot.mockClear();
  entry.producer.mockClear();
  await withinQuerySnapshot(executor, () => request(entry.load));
  expect(entry.producer).toHaveBeenCalledTimes(1);
  expect(mocks.snapshot).not.toHaveBeenCalled();
  await entry.load();
  await entry.load();
  expect(entry.producer).toHaveBeenCalledTimes(3);
  expect(mocks.snapshot).toHaveBeenCalledTimes(2);
});

it('keys stats by the full filters and metrics by type, pagination and full filters', async () => {
  await request(() => getWebsiteStats(websiteId, filters));
  await request(() => getWebsiteStats(websiteId, { ...filters, browser: 'eq.Synthetic Firefox' }));
  await request(() => getWebsiteStats(websiteId, filters));
  expect(mocks.totals).toHaveBeenCalledTimes(2);
  await request(() => getSessionMetrics(websiteId, metric, filters));
  await request(() => getSessionMetrics(websiteId, { ...metric, type: 'country' }, filters));
  await request(() => getSessionMetrics(websiteId, { ...metric, offset: 20 }, filters));
  await request(() => getSessionMetrics(websiteId, { ...metric, limit: 50 }, filters));
  await request(() =>
    getSessionMetrics(websiteId, metric, { ...filters, browser: 'eq.Synthetic Firefox' }),
  );
  await request(() => getSessionMetrics(websiteId, metric, filters));
  expect(mocks.metrics).toHaveBeenCalledTimes(5);
  expect(mocks.metrics.mock.calls[2][0]).toMatchObject({ type: 'browser', offset: 20, limit: 20 });
  expect(mocks.metrics.mock.calls[4][0]).toMatchObject({
    filters: { browser: 'eq.Synthetic Firefox' },
  });
});
