import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  sites: vi.fn(),
  allowed: vi.fn(),
  query: vi.fn(),
  filters: vi.fn(),
  stats: vi.fn(),
  dates: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ checkAuth: mocks.auth }));
vi.mock('@/lib/prisma', () => ({ default: { client: { website: { findMany: mocks.sites } } } }));
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
const zero = { pageviews: 0, visitors: 0, visits: 0, bounces: 0, totaltime: 0 };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('CLICKHOUSE_URL', '');
  vi.stubEnv('CLOUD_MODE', '');
  analyticsCache.clear();
  mocks.auth.mockResolvedValue({ user: { id: 'user' } });
  mocks.sites.mockResolvedValue([{ id, createdAt: new Date(0) }]);
  mocks.allowed.mockResolvedValue(true);
  mocks.query.mockResolvedValue([
    {
      id,
      current: { ...zero, pageviews: 4, visitors: 2 },
      previous: zero,
      received: true,
      last_at: new Date(1234),
    },
  ]);
});
afterEach(() => vi.unstubAllEnvs());
it('coalesces repeated summaries and rechecks revoked access before a warm read', async () => {
  const request = new Request('http://localhost');
  const [a, b] = await Promise.all([
    readWebsiteSummary(request, p),
    readWebsiteSummary(request, p),
  ]);
  expect(a).toEqual(b);
  expect(a[0]).toMatchObject({ id, views: 4, received: true, visitors: 2 });
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
  mocks.stats.mockResolvedValue(zero);
  mocks.dates.mockResolvedValue({ endDate: null });
  const rows = await readWebsiteSummary(new Request('http://localhost'), p);
  expect(rows[0].received).toBe(false);
  expect(mocks.stats.mock.calls[0][1].startDate).toEqual(reset);
  expect(mocks.stats.mock.calls[2][1].startDate).toEqual(reset);
  expect(mocks.filters).toHaveBeenCalledTimes(2);
  expect(mocks.query).not.toHaveBeenCalled();
});
