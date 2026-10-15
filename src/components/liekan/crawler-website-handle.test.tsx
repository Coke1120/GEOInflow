import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { freshAggregateFixture } from '@/test/liekan-freshness';
import { LiekanPage } from './LiekanPage';
import { LiekanLocaleContext } from '@/lib/liekan/i18n/client';
import type { Resource } from './types';

const state = vi.hoisted(() => ({
  website: { id: 'b880cb21-e65a-4fdf-9c0e-3da5aed4e0fa', siteNumber: 102, name: '当前网站' },
  handle: '102',
  get: vi.fn(),
  download: vi.fn(),
  resource: 'ai/bots',
}));
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ children, prefetch: _prefetch, ...props }: any) => <a {...props}>{children}</a>,
}));
vi.mock('./data', async original => ({
  ...(await original<typeof import('./data')>()),
  downloadFile: state.download,
}));
vi.mock('./LiekanShell', () => ({ useLiekanShell: () => null }));
vi.mock('./AnalysisLoading', async () => {
  const { useReportActions } = await import('./ReportContext');
  function View({ report }: any) {
    const actions = useReportActions();
    return report ? (
      <>
        <button onClick={() => actions.onAction('蜘蛛归因与控制')}>查看蜘蛛</button>
        <button onClick={() => actions.onAction('导出')}>导出测试范围</button>
      </>
    ) : null;
  }
  return {
    AnalysisLoading: View,
    reportViews: {
      'ai/overview': View,
      'ai/preference': View,
      'ai/bots': View,
      'ai/pages': View,
      overview: View,
      content: View,
    },
  };
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
      pathname: `/websites/${state.handle}/geo${state.resource === 'overview' ? '' : '/' + state.resource}`,
      websiteId: state.handle,
      query: { date: '30day' },
      router: { push: vi.fn(), replace: vi.fn() },
      updateParams: vi.fn(),
    }),
  };
});
let client: QueryClient;
beforeEach(() => {
  state.resource = 'ai/bots';
  state.download.mockReset();
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
it.each([
  ['zh-CN', '2026-09-22T16:00:00.000Z'],
  ['en-US', '2026-08-30T16:00:00.000Z'],
] as const)(
  'exports the actual report interval and timezone while preserving %s CSV columns',
  async (locale, start) => {
    const end = '2026-09-29T15:59:59.999Z';
    state.get.mockResolvedValue(
      freshAggregateFixture({
        website: { ...state.website, domain: 'example.test' },
        range: { startAt: Date.parse(start), endAt: Date.parse(end), timezone: 'Asia/Shanghai' },
        tables: {
          botBody: [
            {
              name: 'GPTBot',
              botId: 'gptbot',
              vendor: 'OpenAI',
              type: '训练',
              requests: 12,
              daily: 2,
            },
          ],
        },
        states: {},
        cards: [],
        meta: { canManage: true, demo: false },
      }),
    );
    render(
      <LiekanLocaleContext.Provider value={locale}>
        <QueryClientProvider client={client}>
          <LiekanPage resource="ai/bots" />
        </QueryClientProvider>
      </LiekanLocaleContext.Provider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '导出测试范围' }));
    expect(state.download).toHaveBeenCalledOnce();
    const [content, filename] = state.download.mock.calls[0];
    expect(filename).toBe(
      `liekan-ai-bots-${start.replaceAll(':', '-')}--2026-09-29T15-59-59.999Z-Asia-Shanghai.csv`,
    );
    expect(filename).not.toContain('2026-09-01');
    const rows = content.slice(1).split('\r\n');
    expect(rows[0].split(',')).toHaveLength(8);
    expect(rows[0]).toContain(locale === 'zh-CN' ? '所选期间抓取' : 'Crawls in selected period');
    expect(rows[1].split(',')[0]).toBe(
      locale === 'zh-CN' ? '"GPTBot / OpenAI / 官方身份"' : '"GPTBot / OpenAI / Official identity"',
    );
    expect(rows).toHaveLength(2);
  },
);
it.each([
  'overview',
  'ai/overview',
  'ai/bots',
  'ai/pages',
  'ai/preference',
  'content',
] as Resource[])(
  'shows mixed classification definitions on the shared %s analytics surface',
  async resource => {
    state.resource = resource;
    state.get.mockResolvedValue(
      freshAggregateFixture({
        website: state.website,
        tables: {},
        states: {},
        cards: [],
        meta: {
          canManage: true,
          demo: false,
          crawlerClassification: {
            mode: 'mixed',
            versions: 2,
            legacyRequests: 1,
            unclassifiedRequests: 0,
          },
        },
      }),
    );
    render(
      <QueryClientProvider client={client}>
        <LiekanPage resource={resource} />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText('所选期间包含旧版或混合分类数据，历史记录保留采集时口径。'),
    ).toHaveAttribute('role', 'status');
  },
);
it('keeps the mixed-definition notice absent for one current classification version', async () => {
  state.get.mockResolvedValue(
    freshAggregateFixture({
      website: state.website,
      tables: {},
      states: {},
      cards: [],
      meta: {
        canManage: true,
        demo: false,
        crawlerClassification: {
          mode: 'current',
          versions: 1,
          legacyRequests: 0,
          unclassifiedRequests: 0,
        },
      },
    }),
  );
  render(
    <QueryClientProvider client={client}>
      <LiekanPage resource="ai/bots" />
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: '查看蜘蛛' });
  expect(
    screen.queryByText('所选期间包含旧版或混合分类数据，历史记录保留采集时口径。'),
  ).not.toBeInTheDocument();
});
