import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AnalyticsPages } from './AnalyticsPages';
import { FeatureProvider } from './context';
vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));
vi.mock('./Chart', () => ({
  Chart: ({ series }: any) => <div role="img">{JSON.stringify(series)}</div>,
}));
afterEach(() => vi.useRealTimers());
it('keeps the rolling window, warm-entry refresh and non-overlapping slow polls', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-04T00:00:00Z'));
  const calls: { path: string; params: any; signal: AbortSignal }[] = [];
  let finish: (data: any) => void;
  const result = { totals: { active: 1, views: 1, events: 1, ai: 1 }, pages: [], sources: [] };
  const api = {
    get: vi.fn((path, params, signal) => {
      calls.push({ path, params, signal });
      const rich = calls.filter(call => call.params.kind === 'realtime').length;
      if (params.kind === 'realtime' && rich === 2)
        return new Promise(resolve => {
          finish = resolve;
        });
      return Promise.resolve(
        params.kind === 'realtime'
          ? result
          : params.kind === 'sessions'
            ? { rows: [], count: 0 }
            : { series: { visitors: [{ x: '00:00', y: 1 }] } },
      );
    }),
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60000, refetchOnWindowFocus: false } },
  });
  const value: any = {
    user: { id: 'owner' },
    route: { page: 'realtime' },
    siteId: 'site',
    range: { startAt: 1, endAt: 2, timezone: 'Asia/Shanghai' },
    filters: { country: 'CN' },
    query: {},
    api,
    href: () => '#',
    teams: [],
    sites: [],
  };
  const app = (visible = true) => (
    <QueryClientProvider client={client}>
      <FeatureProvider value={value}>
        {visible && <AnalyticsPages page="realtime" />}
      </FeatureProvider>
    </QueryClientProvider>
  );
  const view = render(app());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(calls).toHaveLength(3);
  const canvas = screen.getByRole('img');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });
  const slow = calls.findLast(call => call.params.kind === 'realtime');
  expect(slow.params.endAt - slow.params.startAt).toBe(30 * 60000);
  expect(slow.params.endAt).toBeGreaterThan(calls[0].params.endAt);
  expect(slow.params.country).toBe('CN');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });
  expect(calls.filter(call => call.params.kind === 'realtime')).toHaveLength(2);
  expect(slow.signal.aborted).toBe(false);
  expect(screen.getByRole('img')).toBe(canvas);
  await act(async () => {
    finish(result);
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(calls.filter(call => call.params.kind === 'realtime')).toHaveLength(2);
  view.rerender(app(false));
  view.rerender(app());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(calls.filter(call => call.params.kind === 'realtime')).toHaveLength(3);
  expect(calls.filter(call => call.params.kind === 'sessions')).toHaveLength(4);
  expect(client.getQueryCache().getAll()).toHaveLength(3);
  view.unmount();
  client.clear();
});
