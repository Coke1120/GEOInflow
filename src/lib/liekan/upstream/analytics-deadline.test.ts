import { afterEach, expect, it, vi } from 'vitest';
import { timedAnalyticsClient } from './analytics-deadline';
afterEach(() => vi.useRealTimers());
it('recalculates the remaining SQL budget at execution time for concurrent statements', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  const order: string[] = [];
  const tx = timedAnalyticsClient(
    {
      $executeRawUnsafe: async (sql: string) => {
        order.push(sql);
      },
      $queryRawUnsafe: (sql: string) =>
        new Promise(resolve =>
          setTimeout(() => {
            order.push(sql);
            resolve([]);
          }, 50),
        ),
    },
    Date.now() + 100,
  );
  const result = Promise.all([tx.$queryRawUnsafe('A'), tx.$queryRawUnsafe('B')]);
  await vi.advanceTimersByTimeAsync(100);
  await result;
  expect(order).toEqual([
    'SET LOCAL statement_timeout = 100',
    'A',
    'SET LOCAL statement_timeout = 50',
    'B',
  ]);
});
it('does not run queued statements after an active query has failed and settled', async () => {
  const error = new Error('cancelled by statement timeout');
  const query = vi.fn(async () => {
    throw error;
  });
  const tx = timedAnalyticsClient(
    { $executeRawUnsafe: async () => 0, $queryRawUnsafe: query },
    Date.now() + 1000,
  );
  const results = await Promise.allSettled([tx.$queryRawUnsafe('A'), tx.$queryRawUnsafe('B')]);
  expect(results.every(result => result.status === 'rejected')).toBe(true);
  expect(query).toHaveBeenCalledOnce();
});
