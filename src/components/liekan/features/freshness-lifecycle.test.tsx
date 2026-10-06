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
it('renews an ongoing view at server expiry and hides failed old values after the current grace window', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(7))
    .mockImplementation(async () => Response.json({}, { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  mount();
  await advance(1);
  expect(screen.getByText('7')).toBeInTheDocument();
  await advance(30000);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByText('7')).toBeInTheDocument();
  expect(screen.getByText(/更新失败/)).toBeInTheDocument();
  await advance(29998);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByText('7')).toBeInTheDocument();
  await advance(2);
  expect(screen.queryByText('7')).not.toBeInTheDocument();
});
it('pauses automatic reads while hidden and validates an expired module on restored visibility', async () => {
  const fetch = vi.fn().mockImplementation(async () => response(7));
  vi.stubGlobal('fetch', fetch);
  mount();
  await advance(1);
  visibility = 'hidden';
  fireEvent(document, new Event('visibilitychange'));
  await advance(35000);
  expect(fetch).toHaveBeenCalledTimes(1);
  visibility = 'visible';
  fireEvent(document, new Event('visibilitychange'));
  await advance(1);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it.each([30000, 300000])(
  'backs off an already expired successful response for %s ms',
  async ttl => {
    const fetch = vi.fn(async () =>
      Response.json(
        { value: 7 },
        {
          headers: {
            'X-Liekan-Server-Time': String(Date.now()),
            'X-Liekan-Generated-At': String(Date.now() - ttl - 5000),
            'X-Liekan-Expires-At': String(Date.now() - 5000),
          },
        },
      ),
    );
    vi.stubGlobal('fetch', fetch);
    mount();
    await advance(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    await advance(ttl - 2);
    expect(fetch).toHaveBeenCalledTimes(1);
    await advance(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  },
);
it('honors Retry-After without extending the display deadline', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(7))
    .mockImplementation(async () =>
      Response.json({}, { status: 503, headers: { 'Retry-After': '90' } }),
    );
  vi.stubGlobal('fetch', fetch);
  mount();
  await advance(30001);
  expect(fetch).toHaveBeenCalledTimes(2);
  await advance(60000);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('7')).not.toBeInTheDocument();
  await advance(30000);
  expect(fetch).toHaveBeenCalledTimes(3);
});
it('clears cached values immediately when authorization is rejected', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(7))
    .mockImplementation(async () => Response.json({}, { status: 403 }));
  vi.stubGlobal('fetch', fetch);
  mount();
  await advance(30001);
  expect(screen.queryByText('7')).not.toBeInTheDocument();
  expect(screen.getByText('没有访问权限')).toBeInTheDocument();
  expect(
    client.getQueryCache().find({ queryKey: [...key, 'same'], exact: true })?.state.data,
  ).toBeUndefined();
});
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
  expect(screen.getByText('8')).toBeInTheDocument();
});
it('uses a skeleton when parameters change and the new aggregate has not arrived', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(7))
    .mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal('fetch', fetch);
  const view = mount();
  await advance(1);
  expect(screen.getByText('7')).toBeInTheDocument();
  view.rerender(
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
        <Module parameter="new" />
      </FeatureProvider>
    </QueryClientProvider>,
  );
  expect(screen.queryByText('7')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toBeInTheDocument();
});
it('uses the historical server lifetime for renewal, retry and the retained-data cutoff', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(7, 300000))
    .mockImplementation(async () => Response.json({}, { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  mount();
  await advance(300001);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByText('7')).toBeInTheDocument();
  await advance(299998);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByText('7')).toBeInTheDocument();
  await advance(2);
  expect(screen.queryByText('7')).not.toBeInTheDocument();
});
it('replaces an in-flight ordinary read with a forced manual read', async () => {
  let oldSignal!: AbortSignal;
  const fetch = vi.fn((input: URL, init?: any) => {
    if (new URL(String(input)).searchParams.get('refresh') === '1')
      return Promise.resolve(response(8));
    oldSignal = init.signal;
    return new Promise<Response>((_resolve, reject) =>
      init.signal.addEventListener('abort', () =>
        reject(new DOMException('cancelled', 'AbortError')),
      ),
    );
  });
  vi.stubGlobal('fetch', fetch);
  function ActiveModule() {
    const q = useData('active', signal => featureApi.get('/websites/site/stats', {}, signal));
    return (
      <>
        <button onClick={() => q.refetch()}>刷新读取</button>
        <span>{q.data?.value}</span>
      </>
    );
  }
  render(
    <QueryClientProvider client={client}>
      <FeatureProvider
        value={{ user: { id: 'viewer' }, siteId: 'site', route: { page: 'websites' } } as any}
      >
        <ActiveModule />
      </FeatureProvider>
    </QueryClientProvider>,
  );
  await advance(1);
  fireEvent.click(screen.getByRole('button', { name: '刷新读取' }));
  await advance(1);
  expect(oldSignal.aborted).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByText('8')).toBeInTheDocument();
});

it('labels retained offline statistics and shows a retryable connection state after the grace cutoff', async () => {
  let online = true;
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  const fetch = vi.fn(async (_input: unknown) => response(7));
  vi.stubGlobal('fetch', fetch);
  mount();
  await advance(1);
  online = false;
  fireEvent(window, new Event('offline'));
  await advance(30000);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByText('7')).toBeInTheDocument();
  expect(screen.getByText('统计待更新')).toBeInTheDocument();
  await advance(30000);
  expect(screen.queryByText('7')).not.toBeInTheDocument();
  expect(screen.getByText('统计数据已过期，请恢复连接后重试。')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '重试读取' })).toBeInTheDocument();
  expect(screen.queryByText('正在读取数据')).not.toBeInTheDocument();
  online = true;
  fireEvent(window, new Event('online'));
  await advance(1);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByText('7')).toBeInTheDocument();
});

it('backs off a first aggregate failure across focus and reconnect before retrying an active view', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({}, { status: 503 }))
    .mockImplementation(async () => response(7));
  vi.stubGlobal('fetch', fetch);
  mount();
  await advance(1);
  expect(screen.getByRole('button', { name: '重试读取' })).toBeInTheDocument();
  fireEvent(window, new Event('focus'));
  fireEvent(window, new Event('online'));
  await advance(29998);
  expect(fetch).toHaveBeenCalledTimes(1);
  await advance(2);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByText('7')).toBeInTheDocument();
});

it('reloads an expired cached response on reentry after the wall clock moves backwards', async () => {
  const fetch = vi.fn(async (_input: unknown) => response(7));
  vi.stubGlobal('fetch', fetch);
  const view = mount();
  await advance(1);
  view.unmount();
  await advance(61000);
  vi.setSystemTime(Date.now() - 300000);
  mount();
  await advance(1);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByText('7')).toBeInTheDocument();
});

it('retries an error-only summary at the aggregate interval and immediately on expired reentry', async () => {
  const fetch = vi.fn(async () => Response.json({}, { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  function Summary() {
    const q = useData('summary-errors', signal => getFeatureWebsiteSummary(['site'], {}, signal));
    return <span>{q.data?.[0]?.error?.status || 'pending'}</span>;
  }
  const mountSummary = () =>
    render(
      <QueryClientProvider client={client}>
        <FeatureProvider
          value={{ user: { id: 'viewer' }, siteId: 'site', route: { page: 'websites' } } as any}
        >
          <Summary />
        </FeatureProvider>
      </QueryClientProvider>,
    );
  const view = mountSummary();
  await advance(1);
  expect(screen.getByText('503')).toBeInTheDocument();
  await advance(29998);
  expect(fetch).toHaveBeenCalledTimes(1);
  await advance(2);
  expect(fetch).toHaveBeenCalledTimes(2);
  view.unmount();
  await advance(61000);
  mountSummary();
  await advance(1);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('uses the newest Retry-After when consecutive summary attempts fail', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({}, { status: 503 }))
    .mockImplementation(async () =>
      Response.json({}, { status: 503, headers: { 'Retry-After': '90' } }),
    );
  vi.stubGlobal('fetch', fetch);
  function Summary() {
    const q = useData('changing-retry', signal => getFeatureWebsiteSummary(['site'], {}, signal));
    return <span>{q.data?.[0]?.error?.status || 'pending'}</span>;
  }
  render(
    <QueryClientProvider client={client}>
      <FeatureProvider
        value={{ user: { id: 'viewer' }, siteId: 'site', route: { page: 'websites' } } as any}
      >
        <Summary />
      </FeatureProvider>
    </QueryClientProvider>,
  );
  await advance(30001);
  expect(fetch).toHaveBeenCalledTimes(2);
  await advance(30000);
  fireEvent(window, new Event('focus'));
  await advance(1);
  expect(fetch).toHaveBeenCalledTimes(2);
  await advance(60000);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('clears an unused manual flag after two observers share a forced read', async () => {
  const fetch = vi.fn(async (_input: unknown) => response(7));
  vi.stubGlobal('fetch', fetch);
  const tree = (first: boolean) => (
    <QueryClientProvider client={client}>
      <FeatureProvider
        value={{ user: { id: 'viewer' }, siteId: 'site', route: { page: 'websites' } } as any}
      >
        {first && <Module key="first" />}
        <Module key="second" />
      </FeatureProvider>
    </QueryClientProvider>
  );
  const view = render(tree(true));
  await advance(1);
  for (const button of screen.getAllByRole('button', { name: '刷新模块' })) fireEvent.click(button);
  await advance(1);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(new URL(String(fetch.mock.calls[1][0])).searchParams.get('refresh')).toBe('1');
  view.rerender(tree(false));
  await advance(30000);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(new URL(String(fetch.mock.calls[2][0])).searchParams.has('refresh')).toBe(false);
});
