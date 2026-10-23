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
  mocks.tx.$queryRawUnsafe = vi.fn().mockResolvedValue([{ website_id: 'website' }]);
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
  expect(mocks.tx.$executeRawUnsafe.mock.calls[0][0]).toBe('SET LOCAL search_path TO "public"');
  expect(mocks.tx.$executeRawUnsafe.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.tx.$queryRawUnsafe.mock.invocationCallOrder[0],
  );
  expect(mocks.tx.$queryRawUnsafe).toHaveBeenCalledWith(
    expect.stringMatching(/FROM website WHERE website_id=\$1::uuid FOR UPDATE/),
    'website',
  );
  expect(mocks.tx.$queryRawUnsafe.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.tx.session.findFirst.mock.invocationCallOrder[0],
  );
  expect(mocks.tx.$queryRawUnsafe.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.tx.websiteEvent.deleteMany.mock.invocationCallOrder[0],
  );
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
