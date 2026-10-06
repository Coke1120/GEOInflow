import { afterEach, expect, it, vi } from 'vitest';
import {
  freshnessStaleTime,
  rememberFreshness,
  rememberRequestFreshness,
  shareWithFreshness,
  withClientFreshness,
  rememberResponseFreshness,
  remainingFreshness,
  monotonicNow,
  canDisplayAggregate,
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
  vi.advanceTimersByTime(1500);
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

it.each([-300000, 300000])('uses server time despite a browser clock skew of %s ms', skew => {
  vi.useFakeTimers();
  vi.setSystemTime(1000000 + skew);
  const data = {};
  const startedAt = monotonicNow();
  vi.advanceTimersByTime(700);
  rememberResponseFreshness(
    data,
    new Headers({
      'X-Liekan-Generated-At': '1000000',
      'X-Liekan-Expires-At': '1030000',
      'X-Liekan-Server-Time': '1000100',
    }),
    startedAt,
  );
  expect(remainingFreshness(data, Date.now())).toBe(29200);
  vi.setSystemTime(Date.now() + 300000);
  expect(remainingFreshness(data, Date.now())).toBe(29200);
  vi.advanceTimersByTime(29200);
  expect(remainingFreshness(data, Date.now())).toBe(0);
});
it('subtracts Date precision and round trip when exact server time is unavailable', () => {
  vi.useFakeTimers();
  const data = {};
  rememberResponseFreshness(
    data,
    new Headers({
      'X-Liekan-Generated-At': '1000000',
      'X-Liekan-Expires-At': '1030000',
      Date: new Date(1000000).toUTCString(),
    }),
    monotonicNow() - 500,
  );
  expect(remainingFreshness(data, Date.now())).toBe(28500);
});
it.each([{}, { 'X-Liekan-Expires-At': 'invalid' }, { 'X-Liekan-Expires-At': '1030000' }])(
  'expires aggregate responses without valid freshness proof',
  headers => {
    const data = {};
    rememberResponseFreshness(data, new Headers(headers), monotonicNow());
    expect(remainingFreshness(data, Date.now())).toBe(0);
    expect(canDisplayAggregate(data, 30000)).toBe(false);
  },
);
it('does not renew an identical server expiry through structural sharing', () => {
  vi.useFakeTimers();
  const old = { rows: [] },
    next = { rows: [] };
  const headers = new Headers({
    'X-Liekan-Generated-At': '1000000',
    'X-Liekan-Expires-At': '1030000',
    'X-Liekan-Server-Time': '1000000',
  });
  rememberResponseFreshness(old, headers, monotonicNow());
  vi.advanceTimersByTime(10000);
  rememberResponseFreshness(next, headers, monotonicNow());
  const shared = shareWithFreshness(old, next);
  expect(shared).toBe(old);
  expect(remainingFreshness(shared, Date.now())).toBe(20000);
});

it('accepts fractional generation times with a rounded Date header conservatively', () => {
  vi.useFakeTimers();
  const data = {};
  rememberResponseFreshness(
    data,
    new Headers({
      'X-Liekan-Generated-At': '1000900',
      'X-Liekan-Expires-At': '1030900',
      Date: new Date(1000000).toUTCString(),
    }),
    monotonicNow() - 500,
  );
  expect(remainingFreshness(data, Date.now())).toBe(29400);
});
