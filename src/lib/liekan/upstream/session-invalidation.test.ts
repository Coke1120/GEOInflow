import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ tx: null as any }));
vi.mock('@/lib/prisma', () => ({ default: { transaction: (work: any) => work(mocks.tx) } }));
import { deleteSession } from '@/queries/prisma/session';
import { analyticsCache, websiteCacheTag } from './query-cache';
afterEach(() => analyticsCache.clear());
it('invalidates derived website statistics after a committed session deletion', async () => {
  vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost/test');
  mocks.tx = Object.fromEntries(
    [
      'session',
      'websiteEvent',
      'sessionReplay',
      'sessionReplaySaved',
      'heatmapEvent',
      'revenue',
      'sessionData',
      'sessionLink',
      'eventData',
    ].map(key => [
      key,
      {
        deleteMany: vi.fn(),
        delete: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue({ id: 'session' }),
      },
    ]),
  );
  mocks.tx.$executeRawUnsafe = vi.fn();
  const load = vi
    .fn()
    .mockResolvedValueOnce({ pageviews: 4 })
    .mockResolvedValueOnce({ pageviews: 0 });
  await analyticsCache.read<{ pageviews: number }>(
    'session-statistics',
    300000,
    [websiteCacheTag('website')],
    load,
  );
  await deleteSession('website', 'session');
  expect(
    (
      await analyticsCache.read<{ pageviews: number }>(
        'session-statistics',
        300000,
        [websiteCacheTag('website')],
        load,
      )
    ).value.pageviews,
  ).toBe(0);
  expect(load).toHaveBeenCalledTimes(2);
});
