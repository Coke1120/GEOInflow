import { afterEach, expect, it, vi } from 'vitest';
import {
  freshnessStaleTime,
  rememberFreshness,
  rememberRequestFreshness,
  shareWithFreshness,
  withClientFreshness,
} from './client-freshness';
import { statisticsCacheTtl } from './cache-policy';
afterEach(() => vi.useRealTimers());
it('preserves the earliest server expiry through composed dashboard responses', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  const signal = new AbortController().signal;
  const a = {},
    b = {};
  rememberFreshness(a, 15000);
  rememberFreshness(b, 12000);
  const data = await withClientFreshness(signal, async () => {
    rememberRequestFreshness(a, signal);
    rememberRequestFreshness(b, signal);
    return { a, b };
  });
  expect(freshnessStaleTime({ state: { data, dataUpdatedAt: 10000 } })).toBe(2000);
  vi.setSystemTime(11500);
  expect(freshnessStaleTime({ state: { data, dataUpdatedAt: 10000 } })).toBe(2000);
});
it('uses the selected timezone day boundary for historical cache expiry', () => {
  const now = +new Date('2026-10-04T02:00:00Z');
  expect(statisticsCacheTtl(+new Date('2026-10-03T15:59:59Z'), 'Asia/Shanghai', now)).toBe(300000);
  expect(statisticsCacheTtl(+new Date('2026-10-03T16:00:00Z'), 'Asia/Shanghai', now)).toBe(30000);
  expect(statisticsCacheTtl(+new Date('2026-10-03T16:00:00Z'), 'UTC', now)).toBe(300000);
});
it('preserves unchanged metadata identity while updating its response expiry', () => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  const old = { parameters: { rows: [] } },
    next = { parameters: { rows: [] } };
  rememberFreshness(old, 12000);
  rememberFreshness(next, 15000);
  const shared = shareWithFreshness(old, next);
  expect(shared).toBe(old);
  expect(freshnessStaleTime({ state: { data: shared, dataUpdatedAt: 10000 } })).toBe(5000);
});
