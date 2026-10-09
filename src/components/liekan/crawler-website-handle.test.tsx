import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { freshAggregateFixture } from '@/test/liekan-freshness';
import { LiekanPage } from './LiekanPage';

const state = vi.hoisted(() => ({
  website: { id: 'b880cb21-e65a-4fdf-9c0e-3da5aed4e0fa', siteNumber: 102, name: '当前网站' },
  handle: '102',
  get: vi.fn(),
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
    return report ? (
      <button onClick={() => actions.onAction('蜘蛛归因与控制')}>查看蜘蛛</button>
    ) : null;
  }
  return { AnalysisLoading: View, reportViews: { 'ai/bots': View } };
});
vi.mock('./features/CrawlerDialog', () => ({
  CrawlerDialog: ({ websiteId }: any) => <div role="dialog">{websiteId}</div>,
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
    useApi: () => ({ useQuery }),
    useFeatureAppState: (select: any) => select({ user: { id: 'current-user' } }),
    useWebsite: () => state.website,
    useFeatureDateRange: () => ({
      dateRange: { startDate: new Date('2026-09-01'), endDate: new Date('2026-10-01') },
    }),
    useNavigation: () => ({
      pathname: `/websites/${state.handle}/geo/ai/bots`,
      websiteId: state.handle,
      query: { date: '30day' },
      router: { push: vi.fn(), replace: vi.fn() },
      updateParams: vi.fn(),
    }),
  };
});
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  state.get.mockResolvedValue(
    freshAggregateFixture({
      website: state.website,
      tables: {},
      states: {},
      cards: [],
      meta: { canManage: true, demo: false },
    }),
  );
});
afterEach(() => client.clear());

it.each(['102', 'b880cb21-e65a-4fdf-9c0e-3da5aed4e0fa'])(
  'uses the resolved UUID for crawler actions on website URL %s',
  async handle => {
    state.handle = handle;
    render(
      <QueryClientProvider client={client}>
        <LiekanPage resource="ai/bots" />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '查看蜘蛛' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(state.website.id);
  },
);
