import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LiekanPage } from './LiekanPage';
import { freshAggregateFixture } from '@/test/liekan-freshness';

const state = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  afterSaved: undefined as undefined | (() => Promise<void>),
}));
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ children, prefetch: _prefetch, ...props }: any) => <a {...props}>{children}</a>,
}));
vi.mock('./LiekanShell', () => ({ useLiekanShell: () => null }));
vi.mock('./AnalysisLoading', async () => {
  const { useReportActions } = await import('./ReportContext');
  function View({ report }: any) {
    const actions = useReportActions();
    return (
      <>
        <span>{report?.value || 'pending'}</span>
        <button onClick={() => actions.onAction('目录导入')}>打开管理</button>
      </>
    );
  }
  return { AnalysisLoading: View, reportViews: { content: View, overview: View } };
});
vi.mock('./ManagementDrawer', () => ({
  ManagementDrawer: ({ onSaved }: any) => {
    state.afterSaved = onSaved;
    return null;
  },
}));
vi.mock('@/lib/liekan/upstream/features-client', () => ({
  getFeaturePreferences: () => ({ timezone: 'Asia/Shanghai' }),
  featureApi: {
    get: (path: string, ...args: any[]) =>
      path.endsWith('/settings')
        ? Promise.resolve({ aiCrawlerEnabled: true })
        : state.get(path, ...args),
  },
}));
vi.mock('@/lib/liekan/upstream/client', async () => {
  const { useQuery } = await import('@tanstack/react-query');
  return {
    useApi: () => ({ useQuery, put: state.put }),
    useFeatureAppState: (select: any) => select({ user: { id: 'current-user' } }),
    useWebsite: () => ({ id: 'site-a', name: '当前网站' }),
    useFeatureDateRange: () => ({
      dateRange: { startDate: new Date('2026-09-01'), endDate: new Date('2026-10-01') },
    }),
    useNavigation: () => ({
      pathname: '/websites/site-a/geo/content',
      websiteId: 'site-a',
      query: { date: '30day' },
      router: { push: vi.fn(), replace: vi.fn() },
      updateParams: vi.fn(),
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
let client: QueryClient;
beforeEach(() => {
  state.get.mockReset();
  state.put.mockReset();
  state.afterSaved = undefined;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => client.clear());
it('keeps a new page read intact when the display setting save finishes after leaving', async () => {
  state.get.mockResolvedValue(
    freshAggregateFixture({
      value: 'initial',
      website: { id: 'site-a' },
      tables: {},
      states: { logs: 'not_connected' },
      cards: [],
      meta: { canManage: true, demo: false, logsConfigured: false },
    }),
  );
  const write = deferred<any>();
  state.put.mockReturnValue(write.promise);
  const view = render(
    <QueryClientProvider client={client}>
      <LiekanPage resource="overview" />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: '仅展示访客统计' }));
  const read = deferred<string>();
  const signals: AbortSignal[] = [];
  function NextPage() {
    useQuery({
      queryKey: ['liekan-feature', 'current-user', 'site-b', 'next-page'],
      initialData: 'retained',
      queryFn: ({ signal }) => {
        signals.push(signal);
        return read.promise;
      },
    });
    return <span>next</span>;
  }
  view.rerender(
    <QueryClientProvider client={client}>
      <NextPage />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(signals).toHaveLength(1));
  await act(async () => {
    write.resolve({ aiCrawlerEnabled: false });
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  expect(signals[0].aborted).toBe(false);
  expect(signals).toHaveLength(1);
  await act(async () => read.resolve('complete'));
});

it.each(['feature', 'report'])(
  'preserves an unrelated active %s read when a save finishes after navigation',
  async kind => {
    state.get.mockResolvedValue(
      freshAggregateFixture({
        value: 'initial',
        website: { id: 'site-a' },
        tables: {},
        states: {},
        cards: [],
        meta: { canManage: true, demo: false },
      }),
    );
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
    expect(signals[0].aborted).toBe(false);
    expect(signals).toHaveLength(1);
    expect(state.get).toHaveBeenCalledOnce();
    await act(async () => pending.resolve('old-page-result'));
    expect(await screen.findByText('old-page-result')).toBeInTheDocument();
  },
);
