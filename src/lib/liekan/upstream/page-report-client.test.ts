import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('./features-client', () => ({ featureApi: { get: mocks.get } }));
import { pageReportQuery } from './page-report-client';
const input = {
  resource: 'logs' as const,
  startAt: 1000,
  endAt: 2000,
  timezone: 'Asia/Shanghai',
  filter: 'ai',
  search: 'page',
  page: 1,
};
afterEach(() => vi.useRealTimers());
it('retains the live log identity while reading a new rolling window on each poll', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-04T10:00:00Z'));
  const query = pageReportQuery('user', 'site', input, undefined, undefined, true);
  const signal = new AbortController().signal;
  await query.queryFn({ signal });
  const first = mocks.get.mock.lastCall[1];
  vi.advanceTimersByTime(10000);
  const next = pageReportQuery(
    'user',
    'site',
    { ...input, startAt: 11000, endAt: 12000 },
    undefined,
    undefined,
    true,
  );
  expect(next.queryKey).toEqual(query.queryKey);
  await next.queryFn({ signal });
  expect(mocks.get.mock.lastCall[1].endAt - first.endAt).toBe(10000);
  expect(first.endAt - first.startAt).toBe(30 * 86400000);
  expect(query.refetchOnMount).toBe('always');
});
it('separates live logs from changed filters, pages, users, sites and explicit dates', () => {
  const live = pageReportQuery('user', 'site', input, undefined, undefined, true).queryKey;
  for (const changed of [
    { ...input, filter: 'abnormal' },
    { ...input, search: 'different' },
    { ...input, page: 2 },
  ])
    expect(
      pageReportQuery('user', 'site', changed, undefined, undefined, true).queryKey,
    ).not.toEqual(live);
  expect(pageReportQuery('other', 'site', input, undefined, undefined, true).queryKey).not.toEqual(
    live,
  );
  expect(pageReportQuery('user', 'other', input, undefined, undefined, true).queryKey).not.toEqual(
    live,
  );
  expect(pageReportQuery('user', 'site', input).queryKey).not.toEqual(live);
});
