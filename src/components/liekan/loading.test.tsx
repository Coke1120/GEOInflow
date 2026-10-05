import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiekanPage } from './LiekanPage';
import { LiekanShell } from './LiekanShell';
import type { LiekanReport } from './types';
import { WebsiteLayout } from '@/app/(main)/websites/[websiteId]/WebsiteLayout';

const mocks = vi.hoisted(() => ({
  display: {} as { aiCrawlerEnabled?: boolean },
  metadata: { data: undefined, isPending: true, isError: false, refetch: vi.fn() } as any,
  report: { data: undefined, isPending: true, isError: false, refetch: vi.fn() } as any,
  pathname: '/websites/site-a/geo/content',
  params: { date: '30day' } as Record<string, string>,
  previous: { data: undefined, isPending: false, isError: false, refetch: vi.fn() } as any,
  website: { id: 'site-a', name: '当前网站', domain: 'a.test' },
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    getQueryData: vi.fn(),
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock('next/link', () => ({
  default: ({ children, prefetch: _prefetch, ...props }: any) => <a {...props}>{children}</a>,
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock('./Navigation', () => ({
  useSidebarWidth: () => [228, vi.fn()],
  Navigation: ({ site }: any) => <div data-test="site-name">{site?.name}</div>,
}));
vi.mock('@/store/app', () => ({ useApp: (select: any) => select({ user: { id: 'user' } }) }));
vi.mock('@/components/hooks/queries/useWebsiteQuery', () => ({
  useWebsiteQuery: () => ({
    ...mocks.metadata,
    isFetching: mocks.metadata.isPending,
    isLoading: mocks.metadata.isPending,
  }),
}));
vi.mock('@/app/(main)/websites/[websiteId]/WebsiteHeader', () => ({
  WebsiteHeader: () => <div>原生网站标题</div>,
}));
vi.mock('@/lib/liekan/upstream/client', () => ({
  useFeatureAppState: () => 'user',
  useWebsiteQuery: () => mocks.metadata,
  useWebsite: () => mocks.website,
  useFeatureDateRange: () => ({
    dateRange: { startDate: new Date('2026-09-01'), endDate: new Date('2026-10-01') },
  }),
  useApi: () => ({
    useQuery: (options: any) =>
      options.queryKey.includes('website-display-settings')
        ? { data: mocks.display, refetch: vi.fn().mockResolvedValue({}), isFetching: false }
        : options.queryKey[4] < Date.parse('2026-08-31')
          ? mocks.previous
          : mocks.report,
  }),
  useNavigation: () => ({
    pathname: mocks.pathname,
    websiteId: 'site-a',
    query: mocks.params,
    router: { push: vi.fn(), replace: vi.fn() },
    updateParams: vi.fn(),
  }),
}));
function report(): LiekanReport {
  return {
    contractVersion: 1,
    website: { id: 'site-a', name: '当前网站', domain: 'a.test' },
    range: { startAt: 1, endAt: 2, timezone: 'Asia/Shanghai' },
    states: { human: 'available', logs: 'available', catalog: 'available', goals: 'available' },
    cards: [{ key: 'pages', label: '有流量页面', value: 123, state: 'available' }],
    charts: {},
    tables: {},
    insights: [],
    meta: { demo: false, canManage: false, latestImportAt: null, ruleCount: 0 },
  };
}
describe('analysis loading states', () => {
  beforeEach(() => {
    mocks.display = {};
    mocks.pathname = '/websites/site-a/geo/content';
    mocks.params = { date: '30day' };
    mocks.previous = { data: undefined, isPending: false, isError: false, refetch: vi.fn() };
    mocks.metadata = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    mocks.report = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
  });
  it('keeps the entire fixed layout visible and withholds values until metadata arrives', () => {
    mocks.report = { ...mocks.report, data: report(), isPending: false };
    const view = render(
      <LiekanShell user={{ id: 'user' } as any}>
        <WebsiteLayout websiteId="site-a">
          <LiekanPage resource="content" />
        </WebsiteLayout>
      </LiekanShell>,
    );
    expect(screen.getByRole('heading', { name: '页面与事件' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByText('有流量页面')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '页面排行（人类访问）' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'PV' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导出页面表' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('正在读取统计数据');
    expect(screen.queryByText('123')).not.toBeInTheDocument();
    mocks.metadata = {
      ...mocks.metadata,
      isPending: false,
      data: { id: 'site-a', name: '当前网站' },
    };
    view.rerender(
      <LiekanShell user={{ id: 'user' } as any}>
        <WebsiteLayout websiteId="site-a">
          <LiekanPage resource="content" />
        </WebsiteLayout>
      </LiekanShell>,
    );
    expect(screen.getByTestId('site-name')).toHaveTextContent('当前网站');
    expect(screen.getByText('123')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('rejects cached metadata from another website and offers retry on metadata failure', () => {
    mocks.metadata = { ...mocks.metadata, data: { id: 'site-b', name: '上个网站' } };
    const view = render(
      <LiekanShell user={{ id: 'user' } as any}>
        <LiekanPage resource="content" />
      </LiekanShell>,
    );
    expect(screen.queryByText('上个网站')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    mocks.metadata = { ...mocks.metadata, isPending: false, isError: true };
    view.rerender(
      <LiekanShell user={{ id: 'user' } as any}>
        <LiekanPage resource="content" />
      </LiekanShell>,
    );
    expect(screen.getByText('无法读取网站信息')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    expect(screen.queryByText('123')).not.toBeInTheDocument();
  });
  it('distinguishes a pending report from missing data and request errors', () => {
    const view = render(<LiekanPage resource="content" />);
    expect(screen.getByRole('status')).toHaveTextContent('正在读取统计数据');
    expect(screen.queryByText('数据待接入')).not.toBeInTheDocument();
    mocks.report = { ...mocks.report, isPending: false, isError: true };
    view.rerender(<LiekanPage resource="content" />);
    expect(screen.getByText('无法读取此范围的数据')).toBeInTheDocument();
    expect(screen.queryByText('数据待接入')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    mocks.report = { ...mocks.report, isError: false, data: report() };
    view.rerender(<LiekanPage resource="content" />);
    expect(screen.getByText('123')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it.each([401, 403, 404])('hides cached metadata and report after access rejection %s', status => {
    mocks.metadata = {
      ...mocks.metadata,
      data: { id: 'site-a', name: '曾有权限的网站' },
      isPending: false,
    };
    mocks.report = { ...mocks.report, data: report(), isPending: false };
    const page = (
      <LiekanShell user={{ id: 'user' } as any}>
        <LiekanPage resource="content" />
      </LiekanShell>
    );
    const view = render(page);
    expect(screen.getByText('123')).toBeInTheDocument();
    mocks.metadata = { ...mocks.metadata, isError: true, error: { status } };
    view.rerender(
      <LiekanShell user={{ id: 'user' } as any}>
        <LiekanPage resource="content" />
      </LiekanShell>,
    );
    expect(screen.queryByText('123')).not.toBeInTheDocument();
    expect(screen.queryByText('曾有权限的网站')).not.toBeInTheDocument();
    expect(screen.getByText('无法读取网站信息')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });
  it('retains cached data after a temporary metadata server failure', () => {
    mocks.metadata = {
      ...mocks.metadata,
      data: { id: 'site-a', name: '当前网站' },
      isPending: false,
      isError: true,
      error: { status: 500 },
    };
    mocks.report = { ...mocks.report, data: report(), isPending: false };
    render(
      <LiekanShell user={{ id: 'user' } as any}>
        <LiekanPage resource="content" />
      </LiekanShell>,
    );
    expect(screen.getByText('123')).toBeInTheDocument();
    expect(screen.queryByText('无法读取网站信息')).not.toBeInTheDocument();
  });
  it.each([401, 403, 404])('hides cached comparison values after access rejection %s', status => {
    mocks.pathname = '/websites/site-a/geo/human';
    mocks.params = { date: '30day', compareWeek: '1' };
    const current = report();
    current.cards = [{ key: 'visitors', label: '访客数 UV', value: 123, state: 'available' }];
    const previous = { ...current, cards: [{ ...current.cards[0], value: 999 }] };
    mocks.report = { ...mocks.report, data: current, isPending: false };
    mocks.previous = { ...mocks.previous, data: previous };
    const view = render(<LiekanPage resource="human/overview" />);
    expect(screen.getByRole('cell', { name: '999' })).toBeInTheDocument();
    mocks.previous = { ...mocks.previous, isError: true, error: { status } };
    view.rerender(<LiekanPage resource="human/overview" />);
    expect(screen.queryByRole('cell', { name: '999' })).not.toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '123' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('上周数据读取失败');
  });
});

it('shows a reversible closed state when a hidden crawler report is opened directly', () => {
  const data = report();
  data.meta.aiCrawlerEnabled = false;
  mocks.report = { data, isPending: false, error: null, isFetching: false };
  mocks.metadata = { data: { id: 'site-a', name: '当前网站' }, isPending: false, error: null };
  const view = render(<LiekanPage resource="ai/overview" />);
  expect(screen.getByText('AI 蜘蛛数据展示已关闭')).toBeInTheDocument();
  expect(screen.queryByText('识别 AI 蜘蛛')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: '网站设置' })).toBeInTheDocument();
  data.meta.aiCrawlerEnabled = true;
  view.rerender(<LiekanPage resource="ai/overview" />);
  expect(screen.queryByText('AI 蜘蛛数据展示已关闭')).not.toBeInTheDocument();
});

it('withholds the previous crawler projection when display is off and report refresh fails', () => {
  mocks.display = { aiCrawlerEnabled: false };
  const data = report();
  data.meta.aiCrawlerEnabled = true;
  data.insights = ['旧 AI 蜘蛛发现'];
  data.charts.d1 = {
    labels: ['2026-10-01'],
    series: [
      { name: '人类 PV', values: [1] },
      { name: 'AI 蜘蛛请求', values: [8] },
    ],
  };
  mocks.report = {
    data,
    isPending: false,
    error: new Error('Temporary report failure'),
    isFetching: false,
    refetch: vi.fn().mockResolvedValue({}),
  };
  mocks.metadata = { data: { id: 'site-a', name: '当前网站' }, isPending: false, error: null };
  render(<LiekanPage resource="overview" />);
  expect(screen.queryByText('旧 AI 蜘蛛发现')).not.toBeInTheDocument();
  expect(screen.getByText('访客浏览趋势')).toBeInTheDocument();
});
