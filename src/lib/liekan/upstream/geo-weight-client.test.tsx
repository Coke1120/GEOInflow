import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ManualRefreshProvider } from '../contracts/manual-refresh';
import { downloadGeoWeight, geoWeightSnapshotKey, useGeoWeight } from './geo-weight-client';

vi.mock('next/navigation', () => ({
  usePathname: () => '/websites/site/geo',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/client', () => ({
  getClientAuthToken: () => 'geo-test-session',
  removeClientAuthToken: vi.fn(),
  setClientAuthToken: vi.fn(),
}));
const snapshotId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function harness(body: () => any = () => ({ taskStatus: 'ready', snapshotId, result: null })) {
  vi.useFakeTimers();
  const fetcher = vi.fn(async (url: URL, _options: RequestInit) => Response.json(body()));
  vi.stubGlobal('fetch', fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const wrapper = ({ children }: any) => (
    <QueryClientProvider client={client}>
      <ManualRefreshProvider>{children}</ManualRefreshProvider>
    </QueryClientProvider>
  );
  return { fetcher, client, wrapper };
}
async function settle(ms = 50) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

it('shares snapshot cache identities and request scopes across timezone aliases', async () => {
  expect(geoWeightSnapshotKey('user', 'site', undefined, 'Etc/UTC', 'summary')).toEqual(
    geoWeightSnapshotKey('user', 'site', undefined, 'UTC', 'summary'),
  );
  expect(geoWeightSnapshotKey('user', 'site', undefined, 'america/los_angeles', 'summary')).toEqual(
    geoWeightSnapshotKey('user', 'site', undefined, 'America/Los_Angeles', 'summary'),
  );
  const { fetcher, wrapper } = harness();
  renderHook(() => useGeoWeight('user', 'site', undefined, 'Etc/UTC', 'summary'), { wrapper });
  await settle();
  expect(fetcher.mock.calls[0][0].searchParams.get('timezone')).toBe('UTC');
});

it('rereads current snapshot on each overview entry with stable identity and no catalog pin', async () => {
  const { fetcher, wrapper, client } = harness();
  let hook = renderHook(() => useGeoWeight('user', 'site', undefined, 'Asia/Shanghai', 'summary'), {
    wrapper,
  });
  await settle();
  expect(hook.result.current.isSuccess).toBe(true);
  hook.unmount();
  hook = renderHook(() => useGeoWeight('user', 'site', undefined, 'Asia/Shanghai', 'summary'), {
    wrapper,
  });
  await settle();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(client.getQueryCache().getAll()).toHaveLength(1);
  expect(client.getQueryCache().getAll()[0].queryKey).toEqual(
    geoWeightSnapshotKey('user', 'site', undefined, 'Asia/Shanghai', 'summary'),
  );
  for (const [url, options] of fetcher.mock.calls) {
    expect(url.pathname).toBe('/api/liekan/websites/site/geo-weight/snapshot');
    expect(url.searchParams.get('mode')).toBe('current');
    expect(url.searchParams.has('asOf')).toBe(false);
    expect(url.searchParams.has('refresh')).toBe(false);
    expect(new Headers(options.headers).has('X-Liekan-Catalog-Version')).toBe(false);
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer geo-test-session');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  }
});

it('opens exact immutable historical details without refresh and exports that UUID with captured locale', async () => {
  const { fetcher, wrapper } = harness();
  const hook = renderHook(
    ({ open }) => ({
      summary: useGeoWeight('user', 'site', '2026-10-20', 'Asia/Shanghai', 'summary'),
      detail: useGeoWeight(
        'user',
        'site',
        '2026-10-20',
        'Asia/Shanghai',
        'detail',
        open,
        snapshotId,
      ),
    }),
    { wrapper, initialProps: { open: false } },
  );
  await settle();
  expect(hook.result.current.detail.data).toBeUndefined();
  hook.rerender({ open: true });
  await settle();
  expect(fetcher).toHaveBeenCalledTimes(2);
  const url = fetcher.mock.calls[1][0];
  expect(url.searchParams.get('mode')).toBe('historical');
  expect(url.searchParams.get('asOf')).toBe('2026-10-20');
  expect(url.searchParams.get('snapshotId')).toBe(snapshotId);
  expect(url.searchParams.get('view')).toBe('detail');
  expect(url.searchParams.has('refresh')).toBe(false);
  await downloadGeoWeight(
    { websiteId: 'site', snapshotId } as any,
    'en-US',
    new AbortController().signal,
  );
  const [, options] = fetcher.mock.calls[2];
  expect(JSON.parse(options.body as string)).toEqual({ snapshotId, locale: 'en-US' });
  expect(new Headers(options.headers).has('X-Liekan-Catalog-Version')).toBe(false);
});

it('never falls back to a legacy export when the saved snapshot UUID is missing', () => {
  expect(() =>
    downloadGeoWeight({ websiteId: 'site' } as any, 'zh-CN', new AbortController().signal),
  ).toThrow();
});

it('starts a fresh exact validation after retiring a pre-boundary request without cached data', async () => {
  const { fetcher, wrapper } = harness();
  let finishOld: (value: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>(resolve => {
        finishOld = resolve;
      }),
  );
  fetcher.mockImplementation(async () =>
    Response.json({
      taskStatus: 'ready',
      snapshotId,
      result: null,
      strongVersion: 'corrected',
    }),
  );
  const hook = renderHook(
    () => useGeoWeight('user', 'site', undefined, 'UTC', 'detail', true, snapshotId),
    { wrapper },
  );
  await settle();
  expect(fetcher).toHaveBeenCalledTimes(1);
  let validation: Promise<unknown>;
  act(() => {
    validation = hook.result.current.refetch({ cancelRefetch: true });
  });
  await settle();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => {
    finishOld(Response.json({ taskStatus: 'ready', snapshotId, strongVersion: 'retired' }));
    await validation;
  });
  await settle();
  expect(hook.result.current.data.strongVersion).toBe('corrected');
});

it('stops polling a completed insufficient-evidence result and ready-null responses', async () => {
  const { fetcher, wrapper } = harness();
  renderHook(() => useGeoWeight('user', 'site', undefined, 'Asia/Shanghai', 'summary'), {
    wrapper,
  });
  await settle(600000);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('polls active tasks every three seconds only while visible and bounds foreground tracking', async () => {
  const { fetcher, wrapper } = harness(() => ({
    taskStatus: 'running',
    taskId: snapshotId,
    result: null,
    snapshotId: null,
  }));
  let visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
    () => visibility as DocumentVisibilityState,
  );
  const hook = renderHook(
    () => useGeoWeight('user', 'site', undefined, 'Asia/Shanghai', 'summary'),
    { wrapper },
  );
  await settle();
  await settle(3000);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1][0].searchParams.get('taskId')).toBe(snapshotId);
  visibility = 'hidden';
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await settle(6000);
  expect(fetcher).toHaveBeenCalledTimes(2);
  visibility = 'visible';
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await settle();
  expect(fetcher).toHaveBeenCalledTimes(3);
  visibility = 'hidden';
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await settle(300000);
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(hook.result.current.pollExpired).toBe(true);
  visibility = 'visible';
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await settle(30000);
  expect(fetcher).toHaveBeenCalledTimes(3);
  hook.unmount();
  await settle(30000);
  expect(fetcher).toHaveBeenCalledTimes(3);
  vi.restoreAllMocks();
});

it('tracks the existing task across midnight and leaves the next day demand to an entry read', async () => {
  const { fetcher, wrapper } = harness();
  vi.setSystemTime(new Date('2026-10-22T15:59:59Z'));
  fetcher.mockImplementation(async (url: URL) =>
    Response.json({
      taskStatus: 'running',
      snapshotId: null,
      result: null,
      taskId:
        url.searchParams.get('taskId') ||
        (Date.now() >= Date.parse('2026-10-22T16:00:00Z')
          ? 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
          : snapshotId),
      requestedAsOf: '2026-10-21',
    }),
  );
  const hook = renderHook(
    () => useGeoWeight('user', 'site', undefined, 'Asia/Shanghai', 'summary'),
    { wrapper },
  );
  await settle();
  await settle(3000);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1][0].searchParams.get('taskId')).toBe(snapshotId);
  expect(hook.result.current.data.taskId).toBe(snapshotId);
});

it('stops task polling once the server publishes a saved result, including a null score', async () => {
  let done = false;
  const { fetcher, wrapper } = harness(() => ({
    taskStatus: done ? 'ready' : 'queued',
    taskId: snapshotId,
    snapshotId: done ? snapshotId : null,
    result: done ? { current: { level: null } } : null,
  }));
  renderHook(() => useGeoWeight('user', 'site', undefined, 'Asia/Shanghai', 'summary'), {
    wrapper,
  });
  await settle();
  done = true;
  await settle(3000);
  expect(fetcher).toHaveBeenCalledTimes(2);
  await settle(300000);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('submits an explicit idempotent recalculation without changing its business scope', async () => {
  const { fetcher, wrapper } = harness();
  const hook = renderHook(() => useGeoWeight('user', 'site', '2026-09-30', 'UTC', 'summary'), {
    wrapper,
  });
  await settle();
  await act(async () => {
    await hook.result.current.recalculate(snapshotId, new AbortController().signal);
  });
  const [url, options] = fetcher.mock.calls[1];
  expect(url.pathname).toBe('/api/liekan/websites/site/geo-weight/recalculate');
  expect(options.method).toBe('POST');
  expect(JSON.parse(options.body as string)).toEqual({
    mode: 'historical',
    asOf: '2026-09-30',
    timezone: 'UTC',
    requestId: snapshotId,
  });
});
