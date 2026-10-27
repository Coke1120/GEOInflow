vi.mock('./browser-population', async importOriginal => {
  const actual = await importOriginal<typeof import('./browser-population')>();
  return {
    ...actual,
    readBrowserPopulation: async (_id: string, start: Date, end: Date, timezone: string) =>
      actual.populationFromRow(mocks.population(start), { startAt: +start, endAt: +end, timezone }),
  };
});
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  sites: vi.fn(),
  allowed: vi.fn(),
  query: vi.fn(),
  filters: vi.fn(),
  stats: vi.fn(),
  dates: vi.fn(),
  population: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ checkAuth: mocks.auth }));
vi.mock('@/lib/prisma', () => ({
  default: { client: { website: { findMany: mocks.sites } } },
  getRawQueryClient: (client: unknown) => client,
}));
vi.mock('@/permissions', () => ({ canViewWebsiteSection: mocks.allowed }));
vi.mock('@/lib/request', () => ({ getQueryFilters: mocks.filters }));
vi.mock('@/queries/sql', () => ({
  getWebsiteStats: mocks.stats,
  getWebsiteDateRange: mocks.dates,
}));
vi.mock('./server', async () => ({
  query: mocks.query,
  LiekanError: (await import('./errors')).LiekanError,
}));
import { readWebsiteSummary } from './website-summary';
import { analyticsCache } from './query-cache';

const id = '11111111-1111-4111-8111-111111111111';
const p = { ids: id, startAt: 1000000000000, endAt: 1000000100000, timezone: 'Asia/Shanghai' };
const zero = { pageviews: 0, visitors: 0, visits: 0, bounces: 0, totaltime: 0, aiVisits: 0 };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('CLICKHOUSE_URL', '');
  vi.stubEnv('CLOUD_MODE', '');
  analyticsCache.clear();
  mocks.auth.mockResolvedValue({ user: { id: 'user' } });
  mocks.sites.mockResolvedValue([{ id, createdAt: new Date(0) }]);
  mocks.allowed.mockResolvedValue(true);
  mocks.population.mockReturnValue({
    resourceKind: 'website',
    metricScope: 'qualified-browser',
    eligibleEvents: 5,
    qualifiedEvents: 5,
    eligiblePV: 5,
    qualifiedPV: 5,
    qualifiedVisitors: 2,
  });
  mocks.query.mockResolvedValue([
    {
      id,
      current: { ...zero, pageviews: 4, visitors: 2, aiVisits: 1 },
      previous: { ...zero, aiVisits: 3 },
      received: true,
      last_at: new Date(1234),
    },
  ]);
});
afterEach(() => vi.unstubAllEnvs());
it('keeps received historical data unavailable instead of reporting zero qualified PV', async () => {
  mocks.population.mockReturnValue({
    resourceKind: 'website',
    metricScope: 'qualified-browser',
    eligibleEvents: 83,
    eligiblePV: 83,
    qualifiedEvents: 0,
    qualifiedPV: 0,
    qualifiedVisitors: 0,
  });
  mocks.query.mockResolvedValue([
    { id, current: {}, previous: {}, received: true, last_at: new Date(1234) },
  ]);
  const [row] = await readWebsiteSummary(new Request('http://localhost'), p);
  expect(row).toMatchObject({
    pageviews: null,
    views: null,
    visitors: null,
    aiVisits: null,
    received: true,
    lastAt: new Date(1234).toISOString(),
    population: { identity: { status: 'unavailable', eligiblePV: 83 } },
    comparison: { pageviews: null, visitors: null, aiVisits: null },
  });
});
it('retains genuine zero for an empty collection window', async () => {
  mocks.population.mockReturnValue({
    resourceKind: 'website',
    metricScope: 'qualified-browser',
    eligibleEvents: 0,
    eligiblePV: 0,
    qualifiedEvents: 0,
    qualifiedPV: 0,
    qualifiedVisitors: 0,
  });
  mocks.query.mockResolvedValue([
    { id, current: {}, previous: {}, received: false, last_at: null },
  ]);
  const [row] = await readWebsiteSummary(new Request('http://localhost'), p);
  expect(row).toMatchObject({ ...zero, views: 0, received: false, comparison: zero });
});
it('keeps the qualified subset while treating an unavailable comparison independently', async () => {
  mocks.population.mockImplementation((start: Date) => ({
    resourceKind: 'website',
    metricScope: 'qualified-browser',
    eligibleEvents: 83,
    eligiblePV: 83,
    qualifiedEvents: +start === p.startAt ? 4 : 0,
    qualifiedPV: +start === p.startAt ? 4 : 0,
    qualifiedVisitors: +start === p.startAt ? 2 : 0,
  }));
  const [row] = await readWebsiteSummary(new Request('http://localhost'), p);
  expect(row).toMatchObject({
    pageviews: 4,
    views: 4,
    visitors: 2,
    aiVisits: 1,
    population: { identity: { status: 'partial' } },
    comparison: { pageviews: null, visitors: null, aiVisits: null },
  });
});
it('preserves countable PV for legacy populations without qualified browser scope', async () => {
  mocks.population.mockReturnValue({
    resourceKind: 'website',
    eligibleEvents: 83,
    eligiblePV: 83,
    qualifiedEvents: 0,
    qualifiedPV: 0,
    qualifiedVisitors: 0,
  });
  const [row] = await readWebsiteSummary(new Request('http://localhost'), p);
  expect(row).toMatchObject({ pageviews: 4, views: 4, visitors: null, aiVisits: null });
});
it('coalesces repeated summaries and rechecks revoked access before a warm read', async () => {
  const request = new Request('http://localhost');
  const [a, b] = await Promise.all([
    readWebsiteSummary(request, p),
    readWebsiteSummary(request, p),
  ]);
  expect(a).toEqual(b);
  expect(a[0]).toMatchObject({ id, views: 4, received: true, visitors: 2, aiVisits: 1 });
  expect(a[0].comparison).toMatchObject({ aiVisits: 3 });
  expect(mocks.query).toHaveBeenCalledTimes(1);
  mocks.allowed.mockResolvedValue(false);
  await expect(readWebsiteSummary(request, p)).rejects.toMatchObject({ status: 403 });
  expect(mocks.query).toHaveBeenCalledTimes(1);
});
it('rejects share and incomplete identities without reading statistics', async () => {
  for (const auth of [
    { shareToken: { websiteId: id } },
    { user: { id: 'user' }, shareToken: {} },
    null,
  ]) {
    mocks.auth.mockResolvedValue(auth);
    await expect(readWebsiteSummary(new Request('http://localhost'), p)).rejects.toMatchObject({
      status: 401,
    });
  }
  expect(mocks.query).not.toHaveBeenCalled();
});
it('preserves native reset filtering in compatibility fallback', async () => {
  vi.stubEnv('CLICKHOUSE_URL', 'configured');
  const reset = new Date(p.startAt + 50000);
  mocks.filters.mockImplementation(async input => ({
    startDate: reset,
    endDate: new Date(input.endAt),
  }));
  mocks.stats.mockImplementation(async (_id: string, filters: any) =>
    filters.drill_channel === 'eq.AI 搜索引荐' ? { ...zero, visits: 2 } : zero,
  );
  mocks.dates.mockResolvedValue({ endDate: null });
  const rows = await readWebsiteSummary(new Request('http://localhost'), p);
  expect(rows[0].received).toBe(false);
  expect(rows[0].aiVisits).toBe(2);
  expect(rows[0].comparison.aiVisits).toBe(2);
  expect(mocks.stats.mock.calls[0][1].startDate).toEqual(reset);
  expect(mocks.stats.mock.calls[2][1].startDate).toEqual(reset);
  expect(mocks.stats.mock.calls[4][1].drill_channel).toBe('eq.AI 搜索引荐');
  expect(mocks.filters).toHaveBeenCalledTimes(2);
  expect(mocks.query).not.toHaveBeenCalled();
});
