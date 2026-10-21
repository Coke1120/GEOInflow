import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ManualRefreshProvider } from '../contracts/manual-refresh';
import { useGeoWeight } from './geo-weight-client';

vi.mock('next/navigation', () => ({
  usePathname: () => '/websites/site/geo',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/client', () => ({
  getClientAuthToken: () => 'geo-test-session',
  removeClientAuthToken: vi.fn(),
  setClientAuthToken: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('opens details newer than the summary even when the server has an older detail cache', async () => {
  vi.useFakeTimers();
  const catalog = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const fetcher = vi.fn(async (url: URL, _options: RequestInit) => {
    if (url.pathname.endsWith('/catalog-version')) return Response.json({ version: catalog });
    const detail = url.searchParams.get('view') === 'detail';
    const fresh = url.searchParams.get('refresh') === '1';
    return Response.json({
      view: detail ? 'detail' : 'summary',
      calculatedAt: detail && !fresh ? '2026-10-21T07:09:50Z' : '2026-10-21T07:09:55Z',
    });
  });
  vi.stubGlobal('fetch', fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: any) => (
    <QueryClientProvider client={client}>
      <ManualRefreshProvider>{children}</ManualRefreshProvider>
    </QueryClientProvider>
  );
  try {
    const hook = renderHook(
      ({ open }) => ({
        summary: useGeoWeight('user', 'site', '2026-10-20', 'Asia/Shanghai', 'summary'),
        detail: useGeoWeight('user', 'site', '2026-10-20', 'Asia/Shanghai', 'detail', open),
      }),
      { wrapper, initialProps: { open: false } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(hook.result.current.summary.isSuccess).toBe(true);
    expect(hook.result.current.detail.data).toBeUndefined();
    hook.rerender({ open: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(hook.result.current.detail.isSuccess).toBe(true);
    expect(
      hook.result.current.detail.data.calculatedAt >= hook.result.current.summary.data.calculatedAt,
    ).toBe(true);
    const reads = fetcher.mock.calls.filter(([url]) => url.pathname.endsWith('/geo-weight'));
    expect(reads).toHaveLength(2);
    expect(reads[0][0].searchParams.has('refresh')).toBe(false);
    for (const [url, options] of reads) {
      expect(url.searchParams.get('asOf')).toBe('2026-10-20');
      expect(url.searchParams.get('timezone')).toBe('Asia/Shanghai');
      expect(new Headers(options.headers).get('X-Liekan-Catalog-Version')).toBe(catalog);
      expect(new Headers(options.headers).get('Authorization')).toBe('Bearer geo-test-session');
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600000);
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  } finally {
    client.clear();
  }
});
