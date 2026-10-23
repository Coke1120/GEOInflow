import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { ManualRefreshControl } from '@/components/liekan/ManualRefreshControl';
import { pageReportQuery } from './page-report-client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ManualAuthorizationBoundary,
  ManualRefreshProvider,
  useManualInfiniteQuery,
  useManualQuery,
  useManualRefresh,
  useTaskPolling,
  observeHistoryReturn,
} from './manual-client';
import { useDateRangeClock } from './date-range-clock';
import { clientRequestOptions } from './client-freshness';
import { getClientAuthToken, setClientAuthToken, removeClientAuthToken } from '@/lib/client';
import { AUTH_TOKEN } from '@/lib/constants';
import definitions from '../contracts/feature-pages.json';

const navigation = vi.hoisted(() => ({ path: '/websites', search: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.path,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
let client: QueryClient;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-09T15:59:59Z'));
  navigation.path = '/websites';
  navigation.search = '';
  onlineManager.setOnline(true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  removeClientAuthToken();
  onlineManager.setOnline(true);
});
const wrapper = ({ children }: any) => (
  <QueryClientProvider client={client}>
    <ManualRefreshProvider>{children}</ManualRefreshProvider>
  </QueryClientProvider>
);
const advance = (ms = 50) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
it('recognizes a real cached history return and keeps a frozen current page unchanged', () => {
  const callbacks = new Map<string, (event: any) => void>();
  const target = {
    addEventListener: (name: string, callback: any) => callbacks.set(name, callback),
    removeEventListener: (name: string) => callbacks.delete(name),
  } as any;
  const reenter = vi.fn();
  const stop = observeHistoryReturn(target, reenter);
  callbacks.get('pageshow')({ isTrusted: true, persisted: true });
  expect(reenter).not.toHaveBeenCalled();
  callbacks.get('pagehide')({ isTrusted: false, persisted: true });
  callbacks.get('pageshow')({ isTrusted: false, persisted: true });
  expect(reenter).not.toHaveBeenCalled();
  callbacks.get('pagehide')({ isTrusted: true, persisted: true });
  callbacks.get('pageshow')({ isTrusted: true, persisted: true });
  expect(reenter).toHaveBeenCalledTimes(1);
  callbacks.get('pageshow')({ isTrusted: true, persisted: true });
  expect(reenter).toHaveBeenCalledTimes(1);
  stop();
  expect(callbacks.size).toBe(0);
});
it('uses a normal server read for repeated condition selections and forces an explicit refresh', async () => {
  const forced: boolean[] = [];
  const hook = renderHook(
    () => ({
      reading: useManualRefresh(),
      query: useManualQuery({
        queryKey: ['condition-read'],
        queryFn: ({ signal }) => {
          forced.push(!!clientRequestOptions(signal)?.refresh);
          return Promise.resolve(forced.length);
        },
      }),
    }),
    { wrapper },
  );
  await advance();
  for (let turn = 0; turn < 3; turn++) {
    let done: Promise<void>;
    act(() => {
      done = hook.result.current.reading.refresh(undefined, false);
    });
    await advance();
    await done;
  }
  expect(forced).toEqual([false, false, false, false]);
  let done: Promise<void>;
  act(() => {
    done = hook.result.current.reading.refresh();
  });
  await advance();
  await done;
  expect(forced).toEqual([false, false, false, false, true]);
});

it.each(definitions.pages.map(page => page.id))(
  'applies the ordinary read contract to the %s page',
  async page => {
    navigation.path = `/test/${page}`;
    const load = vi.fn(async () => ({ visitors: load.mock.calls.length }));
    const hook = renderHook(
      () => ({
        reading: useManualRefresh(),
        query: useManualQuery({ queryKey: ['liekan', page], queryFn: load }),
      }),
      { wrapper },
    );
    await advance();
    expect(hook.result.current.query.data).toEqual({ visitors: 1 });
    await advance(600000);
    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await advance();
    expect(load).toHaveBeenCalledTimes(1);
    let refresh: Promise<void>;
    act(() => {
      refresh = hook.result.current.reading.refresh();
    });
    await advance();
    await refresh;
    expect(load).toHaveBeenCalledTimes(2);
    expect(hook.result.current.query.data).toEqual({ visitors: 2 });
  },
);

it('reads on actual reentry and preserves the generation through an internal remount', async () => {
  const load = vi.fn(async () => ({ visitors: 1 }));
  const hook = renderHook(
    ({ visible }) => {
      const reading = useManualRefresh();
      const query = useManualQuery({ queryKey: ['site'], queryFn: load, enabled: visible });
      return { reading, query };
    },
    { wrapper, initialProps: { visible: true } },
  );
  await advance();
  hook.rerender({ visible: false });
  hook.rerender({ visible: true });
  await advance();
  expect(load).toHaveBeenCalledTimes(1);
  navigation.path = '/other';
  hook.rerender({ visible: true });
  await advance();
  navigation.path = '/websites';
  hook.rerender({ visible: true });
  await advance();
  expect(load).toHaveBeenCalledTimes(3);
});

it('does not queue an offline entry or offline manual read for network restoration', async () => {
  let online = false;
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  onlineManager.setOnline(false);
  const load = vi.fn(async () => ({ visitors: 1 }));
  const hook = renderHook(
    () => ({
      reading: useManualRefresh(),
      query: useManualQuery({ queryKey: ['offline'], queryFn: load }),
    }),
    { wrapper },
  );
  await advance();
  expect(hook.result.current.query.isError).toBe(true);
  expect(load).not.toHaveBeenCalled();
  await expect(hook.result.current.reading.refresh()).rejects.toThrow('断开');
  online = true;
  act(() => {
    onlineManager.setOnline(true);
    window.dispatchEvent(new Event('online'));
  });
  await advance();
  expect(load).not.toHaveBeenCalled();
  let refresh: Promise<void>;
  act(() => {
    refresh = hook.result.current.reading.refresh();
  });
  await advance();
  await refresh;
  expect(load).toHaveBeenCalledTimes(1);
  expect(hook.result.current.query.data).toEqual({ visitors: 1 });
});

it('freezes midnight and refreshes the clock once alongside the final read parameters', async () => {
  const load = vi.fn(async ({ queryKey }: any) => queryKey[1]);
  const hook = renderHook(
    () => {
      const now = useDateRangeClock('Asia/Shanghai');
      return {
        now,
        reading: useManualRefresh(),
        query: useManualQuery({ queryKey: ['clock', now], queryFn: load }),
      };
    },
    { wrapper },
  );
  await advance();
  const first = hook.result.current.now;
  await advance(600000);
  expect(hook.result.current.now).toBe(first);
  expect(load).toHaveBeenCalledTimes(1);
  let refresh: Promise<void>;
  act(() => {
    refresh = hook.result.current.reading.refresh();
  });
  await advance();
  await refresh;
  expect(load).toHaveBeenCalledTimes(2);
  expect(hook.result.current.query.data).toBe(hook.result.current.now);
});

it('keeps the previous snapshot after a failed refresh and clears it on a permission denial', async () => {
  let status = 0;
  const load = vi.fn(async () => {
    if (status) throw Object.assign(new Error('读取失败'), { status });
    return { visitors: 7 };
  });
  const hook = renderHook(
    () => ({
      reading: useManualRefresh(),
      query: useManualQuery({ queryKey: ['protected'], queryFn: load }),
    }),
    { wrapper },
  );
  await advance();
  status = 503;
  let refresh: Promise<void>;
  act(() => {
    refresh = hook.result.current.reading.refresh();
    void refresh.catch(() => {});
  });
  await advance();
  await expect(refresh).rejects.toThrow();
  expect(hook.result.current.query.data).toEqual({ visitors: 7 });
  status = 403;
  act(() => {
    refresh = hook.result.current.reading.refresh();
    void refresh.catch(() => {});
  });
  await advance();
  await expect(refresh).rejects.toThrow();
  expect(hook.result.current.query.data).toBeUndefined();
});

it('loads only the first infinite batch after explicit refresh', async () => {
  const load = vi.fn(async ({ pageParam }: any) => ({ items: [pageParam], next: pageParam + 1 }));
  const hook = renderHook(
    () => ({
      reading: useManualRefresh(),
      query: useManualInfiniteQuery({
        queryKey: ['history'],
        queryFn: load,
        initialPageParam: 1,
        getNextPageParam: (page: any) => page.next,
      }),
    }),
    { wrapper },
  );
  await advance();
  await act(async () => {
    await hook.result.current.query.fetchNextPage();
  });
  await advance();
  expect(hook.result.current.query.data.pages).toHaveLength(2);
  let refresh: Promise<void>;
  act(() => {
    refresh = hook.result.current.reading.refresh();
  });
  await advance();
  await refresh;
  expect(load).toHaveBeenCalledTimes(3);
  expect(hook.result.current.query.data.pages).toHaveLength(1);
});

it('keeps a disabled query out of the refresh round', async () => {
  const load = vi.fn(async () => 1);
  const hook = renderHook(
    () => ({
      reading: useManualRefresh(),
      query: useManualQuery({ queryKey: ['disabled'], queryFn: load, enabled: false }),
    }),
    { wrapper },
  );
  let refresh: Promise<void>;
  act(() => {
    refresh = hook.result.current.reading.refresh();
  });
  await advance();
  await refresh;
  expect(load).not.toHaveBeenCalled();
});

it('renewing authorization does not renew an already loaded ordinary snapshot', async () => {
  const load = vi.fn(async () => 7);
  const boundary = ({ children }: any) => (
    <QueryClientProvider client={client}>
      <ManualRefreshProvider>
        <ManualAuthorizationBoundary authorized={authorized}>
          {children}
        </ManualAuthorizationBoundary>
      </ManualRefreshProvider>
    </QueryClientProvider>
  );
  let authorized = true;
  const hook = renderHook(() => useManualQuery({ queryKey: ['shared-report'], queryFn: load }), {
    wrapper: boundary,
  });
  await advance();
  authorized = false;
  hook.rerender();
  await advance(30001);
  authorized = true;
  hook.rerender();
  await advance();
  expect(load).toHaveBeenCalledTimes(1);
  expect(hook.result.current.data).toBe(7);
});

it('stops following a known task at five minutes and resumes only on explicit follow-up', async () => {
  const read = vi.fn(async () => undefined);
  const hook = renderHook(() => useTaskPolling('task-1', true, read, 5000));
  await advance(300001);
  const count = read.mock.calls.length;
  expect(count).toBeGreaterThan(0);
  expect(hook.result.current.expired).toBe(true);
  await advance(600000);
  expect(read).toHaveBeenCalledTimes(count);
  act(() => hook.result.current.resume());
  await advance(5001);
  expect(read.mock.calls.length).toBeGreaterThan(count);
});

it('reads revisited conditions and keeps that snapshot through a real internal remount', async () => {
  const load = vi.fn(async () => 7);
  let value = 'a';
  function Query() {
    useManualQuery({ queryKey: ['conditions', value], queryFn: load });
    return null;
  }
  const tree = (visible: boolean) => (
    <QueryClientProvider client={client}>
      <ManualRefreshProvider>{visible && <Query />}</ManualRefreshProvider>
    </QueryClientProvider>
  );
  const view = render(tree(true));
  await advance();
  value = 'b';
  view.rerender(tree(true));
  await advance();
  value = 'a';
  view.rerender(tree(true));
  await advance();
  expect(load).toHaveBeenCalledTimes(3);
  view.rerender(tree(false));
  view.rerender(tree(true));
  await advance();
  expect(load).toHaveBeenCalledTimes(3);
});

it('keeps a local page read when its URL confirmation arrives later', async () => {
  let value = 1;
  const load = vi.fn(async ({ queryKey }: any) => queryKey[1]);
  const hook = renderHook(
    () => ({
      reading: useManualRefresh(),
      query: useManualQuery({ queryKey: ['local-page', value], queryFn: load }),
    }),
    { wrapper },
  );
  await advance();
  const token = hook.result.current.reading.page.token;
  value = 2;
  hook.rerender();
  await advance();
  navigation.search = 'page=2';
  hook.rerender();
  await advance();
  expect(load).toHaveBeenCalledTimes(2);
  expect(hook.result.current.query.data).toBe(2);
  expect(hook.result.current.reading.page.token).toBe(token);
});

it('keeps the entry identity when short website metadata arrives and the URL normalizes', async () => {
  navigation.path = '/websites/17';
  navigation.search = 'date=7day';
  const load = vi.fn(async () => 7);
  const hook = renderHook(
    () => ({
      reading: useManualRefresh(),
      query: useManualQuery({ queryKey: ['aliases'], queryFn: load }),
    }),
    { wrapper },
  );
  await advance();
  const token = hook.result.current.reading.page.token;
  client.setQueryData(['liekan-feature', 'user', 'site', '17'], {
    id: 'canonical',
    siteNumber: 17,
  });
  hook.rerender();
  await advance();
  expect(hook.result.current.reading.page.token).toBe(token);
  navigation.path = '/websites/canonical';
  hook.rerender();
  await advance();
  expect(load).toHaveBeenCalledTimes(1);
});

it('does not retry a failed statistics refresh when authorization resumes', async () => {
  let authorized = true,
    fail = false;
  const load = vi.fn(async () => {
    if (fail) throw new Error('temporary');
    return 7;
  });
  const boundary = ({ children }: any) => (
    <QueryClientProvider client={client}>
      <ManualRefreshProvider>
        <ManualAuthorizationBoundary authorized={authorized}>
          {children}
        </ManualAuthorizationBoundary>
      </ManualRefreshProvider>
    </QueryClientProvider>
  );
  const hook = renderHook(
    () => ({
      reading: useManualRefresh(),
      query: useManualQuery({ queryKey: ['failed-share'], queryFn: load }),
    }),
    { wrapper: boundary },
  );
  await advance();
  fail = true;
  let refresh: Promise<void>;
  act(() => {
    refresh = hook.result.current.reading.refresh();
    void refresh.catch(() => {});
  });
  await advance();
  await expect(refresh).rejects.toThrow();
  authorized = false;
  hook.rerender();
  await advance();
  authorized = true;
  hook.rerender();
  await advance();
  expect(load).toHaveBeenCalledTimes(2);
  expect(hook.result.current.query.data).toBe(7);
  fail = false;
  act(() => {
    refresh = hook.result.current.reading.refresh();
  });
  await advance();
  await refresh;
  expect(load).toHaveBeenCalledTimes(3);
});

it('retains a real rolling report on temporary failure and isolates another website', async () => {
  let fail = false;
  const load = vi.fn(async () => {
    if (fail) throw new Error('temporary');
    return { visitors: 7 };
  });
  const hook = renderHook(
    ({ site }) => {
      const reading = useManualRefresh();
      const input = pageReportQuery('viewer', site, {
        resource: 'logs',
        startAt: reading.page.now - 86400000,
        endAt: reading.page.now,
        timezone: 'UTC',
      });
      return { reading, query: useManualQuery({ ...input, queryFn: load }) };
    },
    { wrapper, initialProps: { site: 'a' } },
  );
  await advance();
  await advance(600000);
  fail = true;
  let refresh: Promise<void>;
  act(() => {
    refresh = hook.result.current.reading.refresh();
    void refresh.catch(() => {});
  });
  await advance();
  await expect(refresh).rejects.toThrow();
  expect(hook.result.current.query.data).toEqual({ visitors: 7 });
  hook.rerender({ site: 'b' });
  await advance();
  expect(hook.result.current.query.data).toBeUndefined();
});

it('clears the previous report when a new date range fails after a failed header refresh', async () => {
  let fail = false;
  const load = vi.fn(async () => {
    if (fail) throw Object.assign(new Error('temporary'), { status: 503 });
    return { visitors: 7 };
  });
  const hook = renderHook(
    ({ startAt, endAt }) => ({
      reading: useManualRefresh(),
      query: useManualQuery({
        ...pageReportQuery('viewer', 'site', {
          resource: 'overview',
          startAt,
          endAt,
          timezone: 'UTC',
        }),
        queryFn: load,
      }),
    }),
    { wrapper, initialProps: { startAt: 1000, endAt: 2000 } },
  );
  await advance();
  expect(hook.result.current.query.data).toEqual({ visitors: 7 });
  fail = true;
  let refresh!: Promise<void>;
  act(() => {
    refresh = hook.result.current.reading.refresh();
    void refresh.catch(() => {});
  });
  await advance();
  await expect(refresh).rejects.toThrow();
  expect(hook.result.current.query.data).toEqual({ visitors: 7 });
  navigation.search = 'date=range:3000:4000';
  hook.rerender({ startAt: 3000, endAt: 4000 });
  await advance();
  expect(hook.result.current.query.isError).toBe(true);
  expect(hook.result.current.query.data).toBeUndefined();
});

it('forces the manual round and uses normal cache transport for later condition reads', async () => {
  const forced: boolean[] = [];
  let condition = 'a';
  const load = vi.fn(async ({ signal }: any) => {
    forced.push(!!clientRequestOptions(signal)?.refresh);
    return 7;
  });
  const hook = renderHook(
    () => ({
      reading: useManualRefresh(),
      query: useManualQuery({ queryKey: ['transport', condition], queryFn: load }),
    }),
    { wrapper },
  );
  await advance();
  let refresh!: Promise<void>;
  act(() => {
    refresh = hook.result.current.reading.refresh();
  });
  await advance();
  await refresh;
  condition = 'b';
  hook.rerender();
  await advance();
  condition = 'a';
  hook.rerender();
  await advance();
  expect(forced).toEqual([false, true, false, false]);
});

it('keeps unsaved input and issues no read when the draft notice is dismissed', async () => {
  const load = vi.fn(async () => 7);
  function Draft() {
    useManualQuery({ queryKey: ['draft'], queryFn: load });
    return (
      <>
        <ManualRefreshControl />
        <form data-unsaved="true">
          <input aria-label="草稿" defaultValue="未保存内容" />
        </form>
      </>
    );
  }
  render(<Draft />, { wrapper });
  await advance();
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  await advance();
  expect(screen.getByRole('dialog')).toHaveTextContent('当前有未保存的输入');
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  await advance();
  expect(load).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('草稿')).toHaveValue('未保存内容');
});

it('keeps a draft started while identity verification is pending without issuing a new read', async () => {
  const load = vi.fn(async () => 7);
  let finish!: () => void;
  const beforeRefresh = vi.fn(() => new Promise<void>(resolve => (finish = resolve)));
  function Draft() {
    useManualQuery({ queryKey: ['pending-draft'], queryFn: load });
    return (
      <>
        <ManualRefreshControl beforeRefresh={beforeRefresh} />
        <form data-unsaved="false">
          <input aria-label="草稿" defaultValue="" />
        </form>
      </>
    );
  }
  render(<Draft />, { wrapper });
  await advance();
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  await advance();
  const input = screen.getByLabelText('草稿');
  fireEvent.change(input, { target: { value: '读取期间开始的草稿' } });
  input.closest('form').setAttribute('data-unsaved', 'true');
  await act(async () => finish());
  await advance();
  expect(load).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('dialog')).toHaveTextContent('当前有未保存的输入');
  expect(input).toHaveValue('读取期间开始的草稿');
});

it('does not display the preceding page read time while the new page is loading', async () => {
  const load = vi.fn(async () => 7);
  const hook = renderHook(
    () => ({
      reading: useManualRefresh(),
      query: useManualQuery({ queryKey: ['owned-time'], queryFn: load }),
    }),
    { wrapper },
  );
  await advance();
  expect(hook.result.current.reading.readAt).toBeGreaterThan(0);
  load.mockReturnValue(new Promise(() => {}));
  navigation.path = '/other';
  hook.rerender();
  expect(hook.result.current.reading.readAt).toBe(0);
  expect(hook.result.current.reading.error).toBe('');
});

it.each(['refresh', 'entry'])(
  'clears cross-tab identity data and waits for an explicit %s before reading again',
  async action => {
    setClientAuthToken('first-session');
    const load = vi.fn(async () => ({ identity: getClientAuthToken() }));
    const hook = renderHook(
      () => ({
        reading: useManualRefresh(),
        query: useManualQuery({ queryKey: ['identity-read'], queryFn: load }),
      }),
      { wrapper },
    );
    await advance();
    expect(hook.result.current.query.data.identity).toBe('first-session');
    await act(async () => {
      localStorage.setItem(AUTH_TOKEN, JSON.stringify('second-session'));
      window.dispatchEvent(new StorageEvent('storage', { key: AUTH_TOKEN }));
    });
    await advance(600000);
    expect(load).toHaveBeenCalledTimes(1);
    expect(hook.result.current.query.data).toBeUndefined();
    if (action === 'refresh') {
      let pending!: Promise<void>;
      act(() => {
        pending = hook.result.current.reading.refresh();
      });
      await advance();
      await pending;
    } else {
      navigation.path = '/boards';
      hook.rerender();
      await advance();
    }
    expect(load).toHaveBeenCalledTimes(2);
    expect(hook.result.current.query.data.identity).toBe('second-session');
  },
);

it('uses an ordinary read for a condition changed during an unfinished manual refresh', async () => {
  const forced: boolean[] = [];
  const hook = renderHook(
    ({ condition }) => ({
      reading: useManualRefresh(),
      query: useManualQuery({
        queryKey: ['concurrent-condition', condition],
        queryFn: ({ signal }) => {
          forced.push(!!clientRequestOptions(signal)?.refresh);
          if (forced.length === 2) return new Promise<string>(() => {});
          return Promise.resolve(condition);
        },
      }),
    }),
    { initialProps: { condition: 'a' }, wrapper },
  );
  await advance();
  act(() => {
    void hook.result.current.reading.refresh().catch(() => {});
  });
  await advance(1);
  expect(forced).toEqual([false, true]);
  expect(hook.result.current.reading.busy).toBe(true);
  hook.rerender({ condition: 'b' });
  await advance(1);
  expect(forced).toEqual([false, true, false]);
  hook.rerender({ condition: 'a' });
  await advance();
  expect(forced).toEqual([false, true, false, false]);
});

it('keeps cross-tab reads paused when clearing website alias metadata', async () => {
  setClientAuthToken('first-session');
  navigation.path = '/websites/17';
  client.setQueryDefaults(['liekan-feature', 'user', 'site'], {
    meta: { readPurpose: 'ordinary' },
  });
  client.setQueryData(['liekan-feature', 'user', 'site', '17'], {
    id: 'canonical',
    siteNumber: 17,
  });
  const load = vi.fn(async () => 7);
  const hook = renderHook(() => useManualQuery({ queryKey: ['alias-identity'], queryFn: load }), {
    wrapper,
  });
  await advance();
  await act(async () => {
    localStorage.setItem(AUTH_TOKEN, JSON.stringify('second-session'));
    window.dispatchEvent(new StorageEvent('storage', { key: AUTH_TOKEN }));
  });
  await advance();
  expect(client.getQueryData(['liekan-feature', 'user', 'site', '17'])).toBeUndefined();
  expect(load).toHaveBeenCalledTimes(1);
  expect(hook.result.current.data).toBeUndefined();
});

it('keeps a condition selected during metadata loading ordinary when the dependency resumes', async () => {
  const forced: boolean[] = [];
  let definitions = 0;
  let finish!: (value: string) => void;
  const hook = renderHook(
    ({ condition }) => {
      const reading = useManualRefresh();
      const metadata = useManualQuery({
        queryKey: ['gated-source'],
        queryFn: () =>
          ++definitions === 1
            ? Promise.resolve('v1')
            : new Promise<string>(resolve => (finish = resolve)),
      });
      const query = useManualQuery({
        queryKey: ['gated-condition', condition, metadata.data],
        enabled: metadata.isSuccess && !metadata.isPlaceholderData,
        queryFn: async ({ signal }) => {
          forced.push(!!clientRequestOptions(signal)?.refresh);
          return condition;
        },
      });
      return { reading, metadata, query };
    },
    { initialProps: { condition: 'a' }, wrapper },
  );
  await advance(1);
  await advance();
  act(() => {
    void hook.result.current.reading.refresh().catch(() => {});
  });
  await advance();
  expect(hook.result.current.metadata.isPlaceholderData).toBe(true);
  expect(hook.result.current.reading.busy).toBe(true);
  hook.rerender({ condition: 'b' });
  await advance(1);
  await act(async () => finish('v2'));
  await advance(1);
  await advance();
  expect(forced).toEqual([false, false]);
  expect(hook.result.current.query.data).toBe('b');
  expect(hook.result.current.reading.busy).toBe(false);
});

it.each(['success', 'failure'])('stops committing an unchanged %s read while idle', async mode => {
  vi.useRealTimers();
  let renders = 0;
  const load = vi.fn(async () => {
    if (mode === 'failure') throw new Error('fixture unavailable');
    return 7;
  });
  const hook = renderHook(
    () => {
      renders++;
      return useManualQuery({ queryKey: ['idle-render'], queryFn: load });
    },
    { wrapper },
  );
  await waitFor(() =>
    expect(hook.result.current.status).toBe(mode === 'success' ? 'success' : 'error'),
  );
  await new Promise(resolve => setTimeout(resolve, 150));
  const before = renders;
  await new Promise(resolve => setTimeout(resolve, 500));
  expect(renders - before).toBeLessThan(5);
  expect(load).toHaveBeenCalledTimes(1);
});

it('finishes a failed selection and lets the next manual read recover', async () => {
  let fail = false;
  const hook = renderHook(
    () => ({
      reading: useManualRefresh(),
      normal: useManualQuery({ queryKey: ['selected-read'], queryFn: async () => 7 }),
      query: useManualQuery({
        queryKey: ['selected-read'],
        queryFn: async () => 7,
        select: value => {
          if (fail) throw new Error('无法显示本次结果');
          return value;
        },
      }),
    }),
    { wrapper },
  );
  await advance();
  expect(hook.result.current.query.data).toBe(7);
  fail = true;
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.reading.refresh();
    void pending.catch(() => {});
  });
  await advance();
  await expect(pending).rejects.toThrow('读取失败');
  expect(hook.result.current.reading.busy).toBe(false);
  expect(hook.result.current.query.error.message).toBe('无法显示本次结果');
  expect(hook.result.current.normal.data).toBe(7);
  fail = false;
  act(() => {
    pending = hook.result.current.reading.refresh();
  });
  await advance();
  await pending;
  expect(hook.result.current.query.data).toBe(7);
  expect(hook.result.current.reading.error).toBe('');
});

it('renders controlled refresh failures in the current language while keeping its canonical read state', async () => {
  const { LiekanLocaleContext } = await import('../i18n/client');
  let fail = false;
  let locale: 'zh-CN' | 'en-US' = 'en-US';
  function Scope() {
    const query = useManualQuery({
      queryKey: ['localized-refresh-error'],
      queryFn: async () => {
        if (fail) throw new Error('fixture unavailable');
        return 7;
      },
    });
    return (
      <>
        <output>{query.isPending ? 'Pending' : query.data}</output>
        <span>{query.error ? 'Read failed' : ''}</span>
        <ManualRefreshControl />
      </>
    );
  }
  const content = () => (
    <LiekanLocaleContext.Provider value={locale}>
      <Scope />
    </LiekanLocaleContext.Provider>
  );
  const view = render(content(), { wrapper });
  await advance();
  fail = true;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await advance(100);
  await advance(100);
  expect(document.querySelector('[data-manual-reading] [role="status"]')).toHaveTextContent(
    'Some data could not be loaded. Previous results are still shown. Retry.',
  );
  locale = 'zh-CN';
  view.rerender(content());
  expect(document.querySelector('[data-manual-reading] [role="status"]')).toHaveTextContent(
    '部分数据读取失败，仍显示上次读取结果，请主动重试。',
  );
});

it('records changed date and timezone conditions on the new page clock', async () => {
  navigation.path = '/clock-conditions';
  navigation.search = 'date=7day&timezone=UTC';
  const hook = renderHook(
    () => {
      const reading = useManualRefresh();
      useManualQuery({
        queryKey: ['clock-metadata', reading.page.now],
        queryFn: async () => ({ value: 1 }),
      });
      return reading;
    },
    { wrapper },
  );
  await advance();
  navigation.search = 'date=30day&timezone=Asia%2FShanghai';
  hook.rerender();
  await advance();
  expect(hook.result.current.page.clockConditions).toBe('30day|||Asia/Shanghai');
  const current = client
    .getQueryCache()
    .find({ queryKey: ['clock-metadata', hook.result.current.page.now], exact: true });
  expect((current.meta.manualClock as any).conditions).toBe('30day|||Asia/Shanghai');
  expect(hook.result.current.page.clockReady).toBe(true);
});

it('keeps a successful GEO day result out of the ordinary relative-time anchor after report failure', async () => {
  const { rememberFreshness } = await import('./client-freshness');
  navigation.path = '/ordinary-anchor-failure';
  const hook = renderHook(
    () => {
      const reading = useManualRefresh();
      useManualQuery({
        queryKey: ['anchor-ordinary-failed'],
        queryFn: async () => {
          throw new Error('temporary');
        },
      });
      useManualQuery({
        queryKey: ['anchor-geo-success'],
        meta: { geoSnapshot: true },
        queryFn: async () => {
          const value = { saved: true };
          rememberFreshness(value, Date.now() + 86400000);
          return value;
        },
      });
      return reading;
    },
    { wrapper },
  );
  await advance();
  const first = hook.result.current.page.now;
  await advance(60000);
  navigation.path = '/ordinary-anchor-other';
  hook.rerender();
  await advance();
  navigation.path = '/ordinary-anchor-failure';
  hook.rerender();
  await advance();
  expect(hook.result.current.page.now).toBeGreaterThan(first + 60000);
});
