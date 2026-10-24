// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import type { BrowserPopulation } from '@/lib/liekan/contracts/browser-population';
import {
  noteBrowserPopulation,
  probeCacheOnly,
  withQueryCacheHeaders,
} from '@/lib/liekan/upstream/cache-context';
import { analyticsCache, websiteCacheTag } from '@/lib/liekan/upstream/query-cache';
import { getQuerySnapshot, withinQuerySnapshot } from '@/lib/liekan/upstream/query-snapshot';
import { getWebsiteListCharts } from './getWebsiteListCharts';

const mocks = vi.hoisted(() => ({
  backend: 'prisma',
  raw: vi.fn(),
  clickhouse: vi.fn(),
  population: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  PRISMA: 'prisma',
  CLICKHOUSE: 'clickhouse',
  runQuery: (backends: Record<string, () => unknown>) => backends[mocks.backend](),
}));
vi.mock('@/lib/prisma', () => ({ default: { rawQuery: mocks.raw } }));
vi.mock('@/lib/clickhouse', () => ({ default: { rawQuery: mocks.clickhouse } }));
vi.mock('@/lib/liekan/upstream/browser-population', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/liekan/upstream/browser-population')>()),
  readBrowserPopulation: mocks.population,
}));
vi.mock('@/lib/liekan/upstream/server', () => ({ reportSnapshot: mocks.snapshot }));

const parameters = {
  startDate: new Date('2024-01-01T00:00:00Z'),
  endDate: new Date('2024-01-02T00:00:00Z'),
  timezone: 'UTC',
};
const executor = { $executeRawUnsafe: vi.fn(), $queryRawUnsafe: vi.fn() };
let partial = false;
const population = (resourceId: string): BrowserPopulation => ({
  resourceId,
  resourceKind: 'website',
  capability: 'supported',
  scope: 'resource-window',
  populationVersion: 'synthetic-population',
  policyRevision: '7',
  historyActiveGeneration: null,
  historyRevision: '0',
  epoch: '1',
  governanceRevision: '2',
  governanceWatermark: null,
  identity: {
    status: partial && resourceId === 'second' ? 'partial' : 'complete',
    eligibleEvents: 2,
    eligiblePV: 2,
    qualifiedPV: partial && resourceId === 'second' ? 1 : 2,
    qualifiedVisitors: 1,
    coverage: partial && resourceId === 'second' ? 0.5 : 1,
    versions: ['synthetic-identity'],
  },
  ruleVersions: ['synthetic-rule'],
  catalogVersions: [],
  versionSetsTruncated: false,
  range: {
    startAt: +parameters.startDate,
    endAt: +parameters.endDate,
    timezone: parameters.timezone,
  },
});
const rows = (_sql: string, bindings: { websiteIds: string[] }) =>
  bindings.websiteIds.flatMap(id => [
    { websiteId: id, x: null, y: 1 },
    { websiteId: id, x: '2024-01-01 00:00:00', y: 1 },
  ]);
beforeEach(() => {
  analyticsCache.clear();
  vi.clearAllMocks();
  partial = false;
  mocks.backend = 'prisma';
  mocks.snapshot.mockImplementation((load: () => Promise<unknown>) =>
    withinQuerySnapshot(executor, load),
  );
  mocks.raw.mockImplementation(async (...args: Parameters<typeof rows>) => {
    expect(getQuerySnapshot()).toBeDefined();
    return rows(...args);
  });
  mocks.clickhouse.mockImplementation(async (...args: Parameters<typeof rows>) => rows(...args));
  mocks.population.mockImplementation(async (id: string) => {
    expect(getQuerySnapshot()).toBeDefined();
    const result = population(id);
    noteBrowserPopulation(id, result);
    return result;
  });
});
const request = (ids = ['first', 'second'], input = parameters) =>
  withQueryCacheHeaders(async () => Response.json(await getWebsiteListCharts(ids, input)));

it('reuses a complete batch and replays each resource population from its saved snapshot', async () => {
  const cold = await request(),
    body = await cold.json();
  expect(body.first.total).toBe(1);
  expect(body.second.total).toBe(1);
  partial = true;
  const warm = await request();
  expect(await warm.json()).toEqual(body);
  expect(cold.headers.get('X-Liekan-Cache')).toBe('miss');
  expect(warm.headers.get('X-Liekan-Cache')).toBe('hit');
  expect(warm.headers.get('X-Liekan-Population')).toBe(cold.headers.get('X-Liekan-Population'));
  expect(
    JSON.parse(warm.headers.get('X-Liekan-Population')!).populations.map((p: any) => p.resourceId),
  ).toEqual(['first', 'second']);
  expect(mocks.raw).toHaveBeenCalledTimes(1);
  expect(mocks.population).toHaveBeenCalledTimes(2);
  expect(mocks.snapshot).toHaveBeenCalledTimes(1);
});

it('invalidates the batch when its second resource changes and keeps identity masking', async () => {
  await request();
  partial = true;
  analyticsCache.invalidate(websiteCacheTag('second'));
  const response = await request(),
    body = await response.json();
  expect(response.headers.get('X-Liekan-Cache')).toBe('miss');
  expect(body.first.total).toBe(1);
  expect(body.second.total).toBeNull();
  expect(body.second.values.every((value: unknown) => value === null)).toBe(true);
  expect(body.second.population.identity.status).toBe('partial');
  expect(mocks.raw).toHaveBeenCalledTimes(2);
});

it('separates all requested IDs, dates, timezones and event types', async () => {
  await request();
  await request(['first']);
  await request(['first', 'third']);
  await request(undefined, { ...parameters, timezone: 'Asia/Shanghai' });
  await request(undefined, { ...parameters, endDate: new Date(+parameters.endDate + 60000) });
  await withQueryCacheHeaders(async () =>
    Response.json(await getWebsiteListCharts(['first', 'second'], { ...parameters, eventType: 2 })),
  );
  await request();
  expect(mocks.raw).toHaveBeenCalledTimes(6);
});

it('keeps a cold cache-only probe free of fact and population reads', async () => {
  const probe = () =>
    withQueryCacheHeaders(async () =>
      Response.json(
        (await probeCacheOnly(() => getWebsiteListCharts(['first', 'second'], parameters))) ?? null,
      ),
    );
  expect(await (await probe()).json()).toBeNull();
  expect(mocks.raw).not.toHaveBeenCalled();
  expect(mocks.population).not.toHaveBeenCalled();
  await request();
  mocks.raw.mockClear();
  mocks.population.mockClear();
  const warm = await probe();
  expect((await warm.json()).first.total).toBe(1);
  expect(warm.headers.get('X-Liekan-Cache')).toBe('hit');
  expect(mocks.raw).not.toHaveBeenCalled();
  expect(mocks.population).not.toHaveBeenCalled();
});

it('preserves parent snapshots, no-context calls and empty resource lists', async () => {
  await request();
  mocks.raw.mockClear();
  mocks.snapshot.mockClear();
  await withinQuerySnapshot(executor, () => request());
  expect(mocks.raw).toHaveBeenCalledTimes(1);
  expect(mocks.snapshot).not.toHaveBeenCalled();
  await getWebsiteListCharts(['first', 'second'], parameters);
  await getWebsiteListCharts(['first', 'second'], parameters);
  expect(mocks.snapshot).toHaveBeenCalledTimes(2);
  mocks.raw.mockClear();
  mocks.population.mockClear();
  expect(await getWebsiteListCharts([], parameters)).toEqual({});
  expect(mocks.raw).not.toHaveBeenCalled();
  expect(mocks.population).not.toHaveBeenCalled();
});

it('keeps ClickHouse on its original query path', async () => {
  mocks.backend = 'clickhouse';
  const first = await request(),
    second = await request();
  expect(await second.json()).toEqual(await first.json());
  expect(second.headers.get('X-Liekan-Cache')).toBeNull();
  expect(mocks.clickhouse).toHaveBeenCalledTimes(2);
  expect(mocks.raw).not.toHaveBeenCalled();
  expect(mocks.population).not.toHaveBeenCalled();
  expect(mocks.snapshot).not.toHaveBeenCalled();
});
