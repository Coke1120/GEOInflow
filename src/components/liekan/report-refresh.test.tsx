import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager, useQuery } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiekanPage } from './LiekanPage';
import { freshAggregateFixture } from '@/test/liekan-freshness';

const state = vi.hoisted(() => ({
  get: vi.fn(),
  compare: false,
  date: '30day' as string | undefined,
  dateMode: undefined as string | undefined,
  push: vi.fn(),
  replace: vi.fn(),
  updateParams: vi.fn(),
  afterSaved: undefined as undefined | (() => Promise<void>),
}));
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ children, prefetch: _prefetch, ...props }: any) => <a {...props}>{children}</a>,
}));
vi.mock('./LiekanShell', () => ({ useLiekanShell: () => null }));
vi.mock('./chartRuntime', () => ({ loadEcharts: () => Promise.resolve({}) }));
vi.mock('./AnalysisLoading', async () => {
  const { useReportActions } = await import('./ReportContext');
  return {
    AnalysisLoading: () => {
      const actions = useReportActions();
      return (
        <>
          <span>pending</span>
          <button onClick={() => actions.onAction('目录导入')}>打开管理</button>
          <button onClick={() => actions.onAction('生成内容建议')}>生成内容建议</button>
        </>
      );
    },
    reportViews: {
      'human/overview': ({ report }: any) => <span>{report?.value}</span>,
      content: ({ report }: any) => {
        const actions = useReportActions();
        return (
          <>
            <span data-test="report-value">{report?.value || 'pending'}</span>
            <button onClick={() => actions.onAction('目录导入')}>打开管理</button>
            <button onClick={() => actions.onAction('生成内容建议')}>生成内容建议</button>
          </>
        );
      },
    },
  };
});
vi.mock('./ManagementDrawer', () => ({
  ManagementDrawer: ({ onSaved, comparison }: any) => {
    state.afterSaved = onSaved;
    return comparison ? (
      <span data-test="comparison-value">{comparison.previous?.value || 'unavailable'}</span>
    ) : (
      <button onClick={() => onSaved()}>完成写入</button>
    );
  },
}));
vi.mock('@/lib/liekan/upstream/features-client', () => ({
  getFeaturePreferences: () => ({ timezone: 'Asia/Shanghai' }),
  featureApi: {
    get: (...args: any[]) =>
      args[0].endsWith('/settings')
        ? Promise.resolve({ aiCrawlerEnabled: true })
        : state.get(...args),
  },
}));
vi.mock('@/lib/liekan/upstream/client', async () => {
  const { useQuery } = await import('@tanstack/react-query');
  return {
    useApi: () => ({ useQuery }),
    useFeatureAppState: (select: any) => select({ user: { id: 'current-user' } }),
    useWebsite: () => ({ id: 'site-a', name: '当前网站' }),
    useFeatureDateRange: () => ({
      dateRange: { startDate: new Date('2026-09-01'), endDate: new Date('2026-10-01') },
    }),
    useNavigation: () => ({
      pathname: '/websites/site-a/geo/content',
      websiteId: 'site-a',
      query: {
        date: state.date,
        dateMode: state.dateMode,
        ...(state.compare ? { compareWeek: '1' } : {}),
      },
      router: { push: state.push, replace: state.replace },
      updateParams: state.updateParams,
    }),
  };
});
function deferred<T>() {
  let resolve: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve: (value: T) => resolve(value) };
}
const report = (value: string) =>
  freshAggregateFixture({
    value,
    website: { id: 'site-a' },
    tables: {},
    states: {},
    cards: [],
    meta: { canManage: true, demo: false },
  });
let client: QueryClient;
beforeEach(() => {
  // offline 用例会向 window 派发 offline 事件；onlineManager 是全局的，必须在每个用例前复位。
  onlineManager.setOnline(true);
  state.get.mockReset();
  state.compare = false;
  state.date = '30day';
  state.dateMode = undefined;
  state.updateParams.mockReset().mockReturnValue('/next-range');
  state.push.mockReset();
  state.replace.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => client.clear());
describe('GEO refresh after a successful write', () => {
  it.each([false, true])(
    'replaces an old in-flight read with fresh data (cached=%s)',
    async cached => {
      const oldRead = deferred<any>();
      const latestRead = deferred<any>();
      const signals: AbortSignal[] = [];
      state.get.mockImplementation((_path, _params, signal) => {
        signals.push(signal);
        if (cached && signals.length === 1) return Promise.resolve(report('initial'));
        return signals.length === (cached ? 2 : 1) ? oldRead.promise : latestRead.promise;
      });
      render(
        <QueryClientProvider client={client}>
          <LiekanPage resource="content" />
        </QueryClientProvider>,
      );
      if (cached) {
        await screen.findByText('initial');
        act(() => {
          void client.refetchQueries({ queryKey: ['liekan', 'site-a'] });
        });
      }
      await waitFor(() => expect(state.get).toHaveBeenCalledTimes(cached ? 2 : 1));
      fireEvent.click(screen.getByRole('button', { name: '打开管理' }));
      fireEvent.click(screen.getByRole('button', { name: '完成写入' }));
      await waitFor(() => expect(state.get).toHaveBeenCalledTimes(cached ? 3 : 2));
      expect(signals[cached ? 1 : 0].aborted).toBe(true);
      expect(state.get.mock.calls.at(-1)[1]).toMatchObject({ refresh: '1' });
      await act(async () => latestRead.resolve(report('after-write')));
      await screen.findByText('after-write');
      await act(async () => oldRead.resolve(report('before-write')));
      expect(screen.getByTestId('report-value')).toHaveTextContent('after-write');
      expect(
        client.getQueryCache().find({ queryKey: ['liekan', 'site-a'], exact: false })?.state.data,
      ).toMatchObject({ value: 'after-write' });
    },
  );
});

it.each([401, 403, 404, 503])(
  'masks cached comparison values only for hard read errors (%s)',
  async status => {
    state.compare = true;
    let revoked = false;
    let currentStart: number;
    state.get.mockImplementation((_path, params) => {
      currentStart ??= params.startAt;
      if (params.startAt === currentStart) return Promise.resolve(report('current'));
      if (revoked)
        return Promise.reject(Object.assign(new Error('comparison read failed'), { status }));
      return Promise.resolve(report('previous'));
    });
    render(
      <QueryClientProvider client={client}>
        <LiekanPage resource="human/overview" />
      </QueryClientProvider>,
    );
    await screen.findByText('previous');
    revoked = true;
    await act(async () => {
      await client.refetchQueries({ queryKey: ['liekan', 'site-a'] });
    });
    await waitFor(() => {
      expect(
        client
          .getQueryCache()
          .getAll()
          .some(query => (query.state.error as any)?.status === status),
      ).toBe(true);
      expect(screen.getByTestId('comparison-value')).toHaveTextContent(
        status === 503 ? 'previous' : 'unavailable',
      );
    });
  },
);

it.each(['feature', 'report'])(
  'restarts an active %s read when a save finishes after navigation',
  async kind => {
    state.get.mockResolvedValue(report('initial'));
    const view = render(
      <QueryClientProvider client={client}>
        <LiekanPage resource="content" />
      </QueryClientProvider>,
    );
    await screen.findByText('initial');
    fireEvent.click(screen.getByRole('button', { name: '打开管理' }));
    const afterSaved = state.afterSaved!;
    const pending = deferred<string>();
    const signals: AbortSignal[] = [];
    function NextPage() {
      const next = useQuery({
        queryKey:
          kind === 'feature'
            ? ['liekan-feature', 'current-user', 'site-b', 'next-page']
            : [
                'liekan',
                'site-a',
                undefined,
                'ai/pages',
                1,
                2,
                'UTC',
                '30d',
                '',
                '',
                1,
                '',
                '',
                'current-user',
              ],
        queryFn: ({ signal }) => {
          signals.push(signal);
          return signals.length === 1 ? pending.promise : Promise.resolve('next-page-ready');
        },
      });
      return <span>{next.data || 'next-page-pending'}</span>;
    }
    view.rerender(
      <QueryClientProvider client={client}>
        <NextPage />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(signals).toHaveLength(1));
    await act(async () => {
      await afterSaved();
    });
    await screen.findByText('next-page-ready');
    expect(signals[0].aborted).toBe(true);
    expect(signals).toHaveLength(2);
    expect(state.get).toHaveBeenCalledOnce();
    await act(async () => pending.resolve('old-page-result'));
    expect(screen.getByText('next-page-ready')).toBeInTheDocument();
  },
);

it('reports a real post-write query failure to the saving drawer', async () => {
  state.get.mockResolvedValueOnce(report('initial'));
  render(
    <QueryClientProvider client={client}>
      <LiekanPage resource="content" />
    </QueryClientProvider>,
  );
  await screen.findByText('initial');
  fireEvent.click(screen.getByRole('button', { name: '打开管理' }));
  state.get.mockRejectedValue(Object.assign(new Error('statistics unavailable'), { status: 503 }));
  await act(async () => {
    await expect(state.afterSaved!()).rejects.toMatchObject({ status: 503 });
  });
  expect(screen.getByTestId('report-value')).toHaveTextContent('initial');
  await screen.findByText('更新失败，当前显示上次读取的数据');
});

it.each([false, true])(
  'forces a fresh manual read while an older read is running (cached=%s)',
  async cached => {
    const oldRead = deferred<any>();
    const latestRead = deferred<any>();
    const signals: AbortSignal[] = [];
    state.get.mockImplementation((_path, _params, signal) => {
      signals.push(signal);
      if (cached && signals.length === 1) return Promise.resolve(report('initial'));
      return signals.length === (cached ? 2 : 1) ? oldRead.promise : latestRead.promise;
    });
    render(
      <QueryClientProvider client={client}>
        <LiekanPage resource="content" />
      </QueryClientProvider>,
    );
    if (cached) {
      await screen.findByText('initial');
      act(() => {
        void client.refetchQueries({ queryKey: ['liekan', 'site-a'] });
      });
    }
    await waitFor(() => expect(state.get).toHaveBeenCalledTimes(cached ? 2 : 1));
    fireEvent.click(screen.getByRole('button', { name: '生成内容建议' }));
    await waitFor(() => expect(state.get).toHaveBeenCalledTimes(cached ? 3 : 2));
    expect(signals[cached ? 1 : 0].aborted).toBe(true);
    expect(state.get.mock.calls.at(-1)[1]).toMatchObject({ refresh: '1' });
    await act(async () => latestRead.resolve(report('manual-fresh')));
    await screen.findByText('manual-fresh');
    await screen.findByText('已根据当前数据重新生成内容建议');
    await act(async () => oldRead.resolve(report('old-read')));
    expect(screen.getByTestId('report-value')).toHaveTextContent('manual-fresh');
  },
);

it('shares repeated manual refreshes and confirms only after fresh data arrives', async () => {
  const fresh = deferred<any>();
  const signals: AbortSignal[] = [];
  state.get.mockImplementation((_path, _params, signal) => {
    signals.push(signal);
    return signals.length === 1 ? Promise.resolve(report('initial')) : fresh.promise;
  });
  render(
    <QueryClientProvider client={client}>
      <LiekanPage resource="content" />
    </QueryClientProvider>,
  );
  await screen.findByText('initial');
  const generate = screen.getByRole('button', { name: '生成内容建议' });
  fireEvent.click(generate);
  await waitFor(() => expect(state.get).toHaveBeenCalledTimes(2));
  fireEvent.click(generate);
  await act(async () => {
    await Promise.resolve();
  });
  expect(state.get).toHaveBeenCalledTimes(2);
  expect(signals[1].aborted).toBe(false);
  expect(screen.queryByText('已根据当前数据重新生成内容建议')).not.toBeInTheDocument();
  await act(async () => fresh.resolve(report('manual-fresh')));
  await screen.findByText('manual-fresh');
  await screen.findByText('已根据当前数据重新生成内容建议');
});

it('suppresses manual confirmation when a write replaces the pending read', async () => {
  const manual = deferred<any>();
  const saved = deferred<any>();
  const signals: AbortSignal[] = [];
  state.get.mockImplementation((_path, _params, signal) => {
    signals.push(signal);
    return signals.length === 1
      ? Promise.resolve(report('initial'))
      : signals.length === 2
        ? manual.promise
        : saved.promise;
  });
  render(
    <QueryClientProvider client={client}>
      <LiekanPage resource="content" />
    </QueryClientProvider>,
  );
  await screen.findByText('initial');
  fireEvent.click(screen.getByRole('button', { name: '生成内容建议' }));
  await waitFor(() => expect(state.get).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: '打开管理' }));
  fireEvent.click(screen.getByRole('button', { name: '完成写入' }));
  await waitFor(() => expect(state.get).toHaveBeenCalledTimes(3));
  expect(signals[1].aborted).toBe(true);
  expect(screen.queryByText('已根据当前数据重新生成内容建议')).not.toBeInTheDocument();
  await act(async () => saved.resolve(report('saved-fresh')));
  await screen.findByText('saved-fresh');
  await act(async () => manual.resolve(report('obsolete-manual')));
  expect(screen.getByTestId('report-value')).toHaveTextContent('saved-fresh');
  expect(screen.queryByText('已根据当前数据重新生成内容建议')).not.toBeInTheDocument();
});

it('reports a failed manual read while retaining the previous data', async () => {
  state.get.mockResolvedValueOnce(report('initial'));
  render(
    <QueryClientProvider client={client}>
      <LiekanPage resource="content" />
    </QueryClientProvider>,
  );
  await screen.findByText('initial');
  state.get.mockRejectedValue(Object.assign(new Error('statistics unavailable'), { status: 503 }));
  fireEvent.click(screen.getByRole('button', { name: '生成内容建议' }));
  await screen.findByText('更新失败，当前显示上次读取的数据');
  await screen.findByText('更新失败，当前显示上次读取的数据');
  expect(screen.getByTestId('report-value')).toHaveTextContent('initial');
});

it('advances the generated default range at site midnight and updates its URL', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T15:59:59Z'));
  state.date = 'range:old:old';
  state.dateMode = 'default';
  state.get.mockImplementation(() => Promise.resolve(report('calendar')));
  try {
    render(
      <QueryClientProvider client={client}>
        <LiekanPage resource="content" />
      </QueryClientProvider>,
    );
    await act(async () => vi.advanceTimersByTimeAsync(1));
    const first = state.get.mock.calls[0][1];
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    const second = state.get.mock.calls.at(-1)[1];
    expect(second.startAt).toBe(first.startAt + 86400000);
    expect(second.endAt).toBe(first.endAt + 86400000);
    expect(state.updateParams).toHaveBeenLastCalledWith(
      expect.objectContaining({
        date: `range:${second.startAt}:${second.endAt}`,
        dateMode: 'default',
      }),
    );
  } finally {
    vi.useRealTimers();
  }
});

it('labels offline expired GEO statistics and replaces them with a connection retry state at the cutoff', async () => {
  const { rememberResponseFreshness } = await import('@/lib/liekan/upstream/client-freshness');
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T00:00:00Z'));
  let online = true;
  const onLineSpy = vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  state.get.mockImplementation(() => {
    const value = report('offline-value');
    rememberResponseFreshness(
      value,
      new Headers({
        'X-Liekan-Server-Time': String(Date.now()),
        'X-Liekan-Generated-At': String(Date.now()),
        'X-Liekan-Expires-At': String(Date.now() + 30000),
      }),
      performance.now(),
    );
    return Promise.resolve(value);
  });
  try {
    render(
      <QueryClientProvider client={client}>
        <LiekanPage resource="content" />
      </QueryClientProvider>,
    );
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByText('offline-value')).toBeInTheDocument();
    online = false;
    fireEvent(window, new Event('offline'));
    await act(async () => vi.advanceTimersByTimeAsync(30000));
    expect(screen.getByText('统计待更新')).toBeInTheDocument();
    expect(screen.getByText('offline-value')).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(30000));
    expect(screen.queryByText('offline-value')).not.toBeInTheDocument();
    expect(screen.getByText('统计数据已过期，请恢复连接后重试。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    expect(screen.queryByText('pending')).not.toBeInTheDocument();
  } finally {
    onLineSpy.mockRestore();
    vi.useRealTimers();
  }
});

it('clears dateMode and live when an empty-state range shortcut is used', async () => {
  // dateMode=default 残留会让 dynamicDefault 忽略新 token 并把 URL 回写成 range:，快捷键必须清掉它。
  state.date = 'range:1727827200000:1791388799999';
  state.dateMode = 'default';
  state.get.mockRejectedValue(new Error('statistics unavailable'));
  render(
    <QueryClientProvider client={client}>
      <LiekanPage resource="content" />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: '近 7 天' }, { timeout: 5000 }));
  expect(state.updateParams).toHaveBeenCalledWith({
    date: '7day',
    unit: undefined,
    offset: undefined,
    dateMode: undefined,
    live: undefined,
  });
  expect(state.push).toHaveBeenCalledWith('/next-range', { scroll: false });
});
