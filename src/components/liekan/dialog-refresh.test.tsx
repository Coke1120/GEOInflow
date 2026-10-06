import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { LiekanPage } from './LiekanPage';

const mocks = vi.hoisted(() => ({
  live: false,
  refetch: vi.fn(),
  fetchQuery: vi.fn(),
  cancelQueries: vi.fn(),
  invalidateQueries: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
}));
vi.mock('@tanstack/react-query', async importOriginal => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({
    getQueryData: () => undefined,
    getQueryCache: () => ({ find: () => undefined }),
    setQueryData: vi.fn(),
    cancelQueries: mocks.cancelQueries,
    invalidateQueries: mocks.invalidateQueries,
    fetchQuery: mocks.fetchQuery,
  }),
}));
vi.mock('next/link', () => ({
  default: ({ children, prefetch: _prefetch, ...props }: any) => <a {...props}>{children}</a>,
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock('./LiekanShell', () => ({ useLiekanShell: () => null }));
vi.mock('@/lib/liekan/upstream/client', async () => {
  const { freshAggregateFixture } = await import('@/test/liekan-freshness');
  return {
    useFeatureAppState: () => 'user',
    useWebsite: () => ({ id: 'site-a', name: '当前网站', domain: 'a.test' }),
    useFeatureDateRange: () => ({
      dateRange: { startDate: new Date('2026-09-01'), endDate: new Date('2026-10-01') },
    }),
    useApi: () => ({
      get: mocks.get,
      put: mocks.put,
      useQuery: () => ({
        isPending: false,
        isFetching: false,
        isError: false,
        error: null,
        refetch: mocks.refetch,
        data: freshAggregateFixture({
          contractVersion: 2,
          website: { id: 'site-a', name: '当前网站', domain: 'a.test' },
          range: { startAt: 1, endAt: 2, timezone: 'Asia/Shanghai' },
          states: {},
          cards: [],
          charts: {},
          tables: {},
          insights: [],
          meta: { canManage: true, demo: false },
        }),
      }),
    }),
    useNavigation: () => ({
      pathname: mocks.live ? '/websites/site-a/geo/logs' : '/websites/site-a/geo/ai',
      websiteId: 'site-a',
      query: mocks.live ? { date: '30day', live: '1' } : { date: '30day' },
      router: { push: vi.fn(), replace: vi.fn() },
      updateParams: vi.fn(),
    }),
  };
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.live = false;
  mocks.cancelQueries.mockResolvedValue(undefined);
  mocks.invalidateQueries.mockResolvedValue(undefined);
  mocks.get.mockResolvedValue({ robots: 'User-agent: *', allowlist: [], rules: [] });
  mocks.put.mockImplementation(async (_path, patch) => ({
    robots: '',
    allowlist: [],
    rules: [],
    ...patch,
  }));
});

async function saveWebsiteSettings(live: boolean) {
  mocks.live = live;
  const user = userEvent.setup();
  render(<LiekanPage resource={live ? 'logs' : 'ai/overview'} />);
  await user.click(screen.getByRole('button', { name: live ? '蜘蛛识别规则' : '编辑 robots.txt' }));
  const label = live ? '保存识别规则' : '保存 robots.txt';
  await waitFor(() => expect(screen.getByRole('button', { name: label })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: label }));
  await waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(1));
  return { user, label };
}

it.each([false, true])(
  'keeps the dialog pending until the actual report refresh finishes (live=%s)',
  async live => {
    let finish: () => void;
    const pending = new Promise<void>(resolve => {
      finish = resolve;
    });
    mocks.refetch.mockReturnValue(pending);
    mocks.fetchQuery.mockReturnValue(pending);
    const { user, label } = await saveWebsiteSettings(live);
    try {
      expect(screen.getByRole('button', { name: `正在${label}…` })).toBeDisabled();
      await user.keyboard('{Escape}');
      expect(screen.getByRole('dialog')).toBeVisible();
      if (live) expect(mocks.fetchQuery).toHaveBeenCalled();
      else expect(mocks.refetch).toHaveBeenCalledWith({ throwOnError: true });
    } finally {
      finish();
    }
    await waitFor(() => expect(screen.getByRole('button', { name: label })).toBeEnabled());
  },
);

it.each([false, true])(
  'keeps the saved result and shows a report refresh failure (live=%s)',
  async live => {
    const failure = new Error('报告服务暂不可用');
    mocks.refetch.mockImplementation((options?: { throwOnError?: boolean }) =>
      options?.throwOnError ? Promise.reject(failure) : Promise.resolve({ error: failure }),
    );
    mocks.fetchQuery.mockRejectedValue(failure);
    await saveWebsiteSettings(live);
    const savedResult = await screen.findByText(/页面状态刷新失败/);
    expect(savedResult.closest('[role="status"]')).toHaveTextContent(
      live ? '蜘蛛识别规则已保存' : 'robots.txt 已保存',
    );
    expect(mocks.put).toHaveBeenCalledTimes(1);
  },
);
