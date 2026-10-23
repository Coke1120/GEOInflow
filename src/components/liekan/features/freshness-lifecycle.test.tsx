import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { featureApi, getFeatureWebsiteSummary } from '@/lib/liekan/upstream/features-client';
import { FeatureProvider, useData } from './context';
import { QueryState } from './ui';

let client: QueryClient;
let visibility = 'visible';
const key = [
  'liekan-feature',
  'viewer',
  'site',
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  'stats',
];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000000);
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility as any);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  client.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const response = (value: number, ttl = 30000) =>
  Response.json(
    { value },
    {
      headers: {
        'X-Liekan-Server-Time': String(Date.now()),
        'X-Liekan-Generated-At': String(Date.now()),
        'X-Liekan-Expires-At': String(Date.now() + ttl),
      },
    },
  );
function Module({ parameter = 'same' }: { parameter?: string }) {
  const q = useData(['stats', parameter], signal =>
    featureApi.get('/websites/site/stats', {}, signal),
  );
  return (
    <QueryState query={q}>
      <span>{q.data?.value}</span>
      <button onClick={() => q.refetch()}>刷新模块</button>
    </QueryState>
  );
}
function mount(parameter = 'same') {
  return render(
    <QueryClientProvider client={client}>
      <FeatureProvider
        value={
          {
            user: { id: 'viewer' },
            siteId: 'site',
            route: { page: 'websites' },
            api: featureApi,
          } as any
        }
      >
        <Module parameter={parameter} />
      </FeatureProvider>
    </QueryClientProvider>,
  );
}
const advance = (time: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(time);
  });
it.each([30000, 300000])(
  'retains a statistics snapshot beyond the server cache lifetime %s',
  async ttl => {
    const fetch = vi.fn(async () => response(7, ttl));
    vi.stubGlobal('fetch', fetch);
    mount();
    await advance(1);
    await advance(600000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText('7')).toBeVisible();
  },
);
it('does not read on tab, focus or network recovery', async () => {
  const fetch = vi.fn(async () => response(7));
  vi.stubGlobal('fetch', fetch);
  mount();
  await advance(1);
  visibility = 'hidden';
  fireEvent(document, new Event('visibilitychange'));
  await advance(600000);
  visibility = 'visible';
  fireEvent(document, new Event('visibilitychange'));
  fireEvent(window, new Event('focus'));
  fireEvent(window, new Event('online'));
  await advance(1);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByText('7')).toBeVisible();
});
it('retains the last successful result when a manual read temporarily fails', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(7))
    .mockImplementation(async () => Response.json({}, { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  mount();
  await advance(1);
  fireEvent.click(screen.getByRole('button', { name: '刷新模块' }));
  await advance(1);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByText('7')).toBeVisible();
  expect(screen.getByText(/更新失败/)).toBeVisible();
  await advance(600000);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByText('7')).toBeVisible();
});
it.each([401, 403, 404])(
  'clears retained values after a manual permission rejection %s',
  async status => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(7))
      .mockImplementation(async () => Response.json({}, { status }));
    vi.stubGlobal('fetch', fetch);
    mount();
    await advance(1);
    fireEvent.click(screen.getByRole('button', { name: '刷新模块' }));
    await advance(1);
    expect(screen.queryByText('7')).not.toBeInTheDocument();
    expect(
      client
        .getQueryCache()
        .findAll({ queryKey: key })
        .every(q => q.state.data === undefined),
    ).toBe(true);
  },
);
it('sends refresh=1 for a manual read and shares repeated clicks', async () => {
  let finish!: (response: Response) => void;
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(7))
    .mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
  vi.stubGlobal('fetch', fetch);
  mount();
  await advance(1);
  fireEvent.click(screen.getByRole('button', { name: '刷新模块' }));
  fireEvent.click(screen.getByRole('button', { name: '刷新模块' }));
  await advance(1);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(new URL(String(fetch.mock.calls[1][0])).searchParams.get('refresh')).toBe('1');
  await act(async () => finish(response(8)));
  await advance(1);
  expect(screen.getByText('8')).toBeVisible();
});
it('reuses fresh conditions on reentry and updates an expired entry once', async () => {
  const fetch = vi.fn(async () => response(7));
  vi.stubGlobal('fetch', fetch);
  const view = mount();
  await advance(1);
  view.unmount();
  const fresh = mount();
  await advance(1);
  expect(fetch).toHaveBeenCalledTimes(1);
  fresh.unmount();
  await advance(30000);
  mount();
  await advance(1);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('waits for a user retry after an initial error, including Retry-After', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({}, { status: 503, headers: { 'Retry-After': '90' } }))
    .mockImplementation(async () => response(7));
  vi.stubGlobal('fetch', fetch);
  mount();
  await advance(600000);
  expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '重试读取' }));
  await advance(1);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByText('7')).toBeVisible();
});
