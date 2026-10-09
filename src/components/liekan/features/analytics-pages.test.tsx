import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AnalyticsPages } from './AnalyticsPages';

const mocks = vi.hoisted(() => ({
  context: null as any,
  query: {} as Record<string, any>,
  errors: {} as Record<string, Error>,
  pending: {} as Record<string, boolean>,
  href: vi.fn(),
  post: vi.fn(),
  navigate: vi.fn(),
  updateQuery: vi.fn(),
  actionBusy: false,
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));
vi.mock('./context', () => ({
  useFeature: () => mocks.context,
  useData: (key: any[]) => ({
    data:
      typeof mocks.query[key[0]] === 'function' ? mocks.query[key[0]](key) : mocks.query[key[0]],
    error: mocks.errors[key[0]] || null,
    isPending: mocks.pending[key[0]] || false,
  }),
  useAction: () => ({
    run: async (action: () => Promise<any>) => action(),
    busy: mocks.actionBusy,
    error: '',
  }),
}));
vi.mock('./Chart', () => ({
  Chart: ({ title, labels, series }: any) => (
    <div role="img" aria-label={title}>
      {JSON.stringify({ labels, series })}
    </div>
  ),
}));
vi.mock('@/lib/liekan/upstream/features-client', () => ({ getAllFeatureRows: vi.fn() }));

beforeEach(() => {
  mocks.query = {};
  mocks.errors = {};
  mocks.pending = {};
  mocks.actionBusy = false;
  mocks.href.mockReset().mockReturnValue('/sessions');
  mocks.post.mockReset().mockResolvedValue({});
  mocks.navigate.mockReset();
  mocks.updateQuery.mockReset();
  mocks.context = {
    user: { id: 'owner', isAdmin: true },
    siteId: 'site',
    site: { userId: 'owner' },
    route: { page: 'breakdown' },
    query: {},
    range: { startAt: 1, endAt: 2, timezone: 'UTC' },
    filters: {},
    teams: [],
    api: { get: vi.fn(), post: mocks.post },
    href: mocks.href,
    navigate: mocks.navigate,
    updateQuery: mocks.updateQuery,
  };
});

it('applies saved audiences to mounted retention queries and restores them from URL filters', () => {
  const audiences: string[] = [];
  mocks.context.route.page = 'retention';
  mocks.context.range = {
    startAt: Date.UTC(2026, 8, 1),
    endAt: Date.UTC(2026, 8, 30),
    timezone: 'UTC',
  };
  mocks.query['retention-audiences'] = [
    { id: 'segment-a', type: 'segment', name: '移动访客' },
    { id: 'cohort-a', type: 'cohort', name: '注册人群' },
  ];
  mocks.query.retention = (key: any[]) => {
    audiences.push(key[2]);
    return [];
  };
  const view = render(<AnalyticsPages page="retention" />);
  expect(screen.getByLabelText('人群')).toHaveValue('');
  mocks.context = { ...mocks.context, filters: { segment: 'segment-a' } };
  view.rerender(<AnalyticsPages page="retention" />);
  expect(screen.getByLabelText('人群')).toHaveValue('segment:segment-a');
  expect(audiences.at(-1)).toBe('segment:segment-a');
  fireEvent.change(screen.getByLabelText('人群'), { target: { value: 'cohort:cohort-a' } });
  expect(mocks.updateQuery).toHaveBeenCalledWith({ cohort: 'cohort-a', segment: undefined });
  mocks.context = { ...mocks.context, filters: {} };
  view.rerender(<AnalyticsPages page="retention" />);
  expect(screen.getByLabelText('人群')).toHaveValue('');
  expect(audiences.at(-1)).toBe('');
});
it('preserves the selected audience while choices load or fail, then resolves its name', () => {
  mocks.context.filters = { segment: 'segment-a' };
  mocks.pending['retention-audiences'] = true;
  const view = render(<AnalyticsPages page="retention" />);
  expect(screen.getByLabelText('人群')).toHaveValue('segment:segment-a');
  expect(screen.getByRole('option', { name: '所选分群（正在读取）' })).toBeDisabled();
  mocks.pending['retention-audiences'] = false;
  mocks.errors['retention-audiences'] = new Error('读取失败');
  view.rerender(<AnalyticsPages page="retention" />);
  expect(screen.getByLabelText('人群')).toHaveValue('segment:segment-a');
  expect(screen.getByRole('option', { name: '所选分群（读取失败）' })).toBeDisabled();
  mocks.errors = {};
  mocks.query['retention-audiences'] = [{ id: 'segment-a', type: 'segment', name: '移动访客' }];
  view.rerender(<AnalyticsPages page="retention" />);
  expect(screen.getByLabelText('人群')).toHaveValue('segment:segment-a');
  expect(screen.getByRole('option', { name: '移动访客' })).not.toBeDisabled();
});

it('explains continuous visits and exposes the access-record heading', () => {
  mocks.query['sessions-rich'] = { rows: [], count: 0 };
  render(<AnalyticsPages page="sessions" />);
  expect(screen.getByRole('heading', { name: '访问记录' })).toBeInTheDocument();
  expect(screen.getByText(/会话是一次连续访问/)).toBeInTheDocument();
});

it('creates a behavior audience while retaining the native cohort contract', async () => {
  render(<AnalyticsPages page="cohort-editor" />);
  expect(screen.getByRole('heading', { name: '创建行为人群' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/行为人群名称/), { target: { value: '注册访客' } });
  fireEvent.change(screen.getByLabelText(/行为值/), { target: { value: 'signup' } });
  fireEvent.submit(screen.getByRole('button', { name: '保存行为人群' }).closest('form'));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith('/websites/site/segments', {
      name: '注册访客',
      type: 'cohort',
      parameters: {
        filters: [],
        match: 'all',
        action: { type: 'event', value: 'signup' },
        dateRange: '30day',
      },
    }),
  );
  expect(mocks.navigate).toHaveBeenCalledWith('cohorts');
});

it('retains a goal-loading error on UTM activities instead of claiming no goal exists', () => {
  mocks.errors['utm-goal-list'] = new Error('目标读取暂不可用');
  mocks.query['utm-total'] = { views: 0, visitors: 0 };
  mocks.query['utm-dimension'] = { rows: [], dimensionTotal: 0 };
  render(<AnalyticsPages page="utm" />);
  expect(screen.getByRole('alert')).toHaveTextContent('目标读取暂不可用');
  expect(screen.queryByText('尚未配置')).not.toBeInTheDocument();
});

it('orders the breakdown chart by views and emits explicit missing-dimension drill conditions', () => {
  mocks.query.breakdown = [
    { path: '/small', country: 'CN', views: 2, visitors: 2 },
    { path: '/large', country: null, views: 20, visitors: 1 },
  ];
  render(<AnalyticsPages page="breakdown" />);
  expect(JSON.parse(screen.getByRole('img').textContent!)).toMatchObject({
    labels: ['/large × 未提供', '/small × CN'],
    series: [{ values: [20, 2] }],
  });
  expect(mocks.href).toHaveBeenCalledWith(
    'sessions',
    expect.objectContaining({
      drill_path: 'eq./large',
      drill_country: 'empty.',
    }),
  );
  expect(mocks.href).toHaveBeenCalledWith(
    'sessions',
    expect.objectContaining({ drill_path: 'eq./small', drill_country: 'eq.CN' }),
  );
});

it('keeps the selected event property while its value query is pending', () => {
  mocks.context.query.eventName = 'signup';
  const keys: string[] = [];
  let initialReads = 0;
  const data = {
    totals: { total: 3, visitors: 2 },
    properties: [{ name: 'plan', total: 3 }],
    values: [{ value: 'pro', dataType: 1, total: 3 }],
  };
  mocks.query['event-detail'] = (key: any[]) => {
    keys.push(key[2]);
    if (!key[2] && initialReads++ < 2) return data;
    return undefined;
  };
  const view = render(<AnalyticsPages page="event-detail" />);
  expect(keys.at(-1)).toBe('plan');
  view.rerender(<AnalyticsPages page="event-detail" />);
  expect(keys.at(-1)).toBe('plan');
  expect(keys.filter(key => key === '')).toHaveLength(1);
  mocks.query['event-detail'] = (key: any[]) => {
    keys.push(key[2]);
    return data;
  };
  view.rerender(<AnalyticsPages page="event-detail" />);
  expect(screen.getByText('plan 的各属性值对应触发次数。')).toBeInTheDocument();
  expect(JSON.parse(screen.getByRole('img').textContent!).series[0].values).toEqual([3]);
});

it('shows the current dimension selection and enforces the three dimension limit', async () => {
  render(<AnalyticsPages page="breakdown" />);
  fireEvent.click(screen.getByRole('button', { name: '选择维度' }));
  expect(screen.getByText('已选择 2 / 3 个维度')).toBeVisible();
  fireEvent.click(screen.getByRole('checkbox', { name: '浏览器' }));
  expect(screen.getByText('已选择 3 / 3 个维度')).toBeVisible();
  expect(screen.getByRole('checkbox', { name: '设备' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: '页面路径' }));
  expect(screen.getByRole('checkbox', { name: '设备' })).toBeEnabled();
});
it('keeps the current period and timezone visible while editing comparison dates', () => {
  mocks.context.range = {
    startAt: Date.UTC(2026, 8, 1),
    endAt: Date.UTC(2026, 8, 30),
    timezone: 'Asia/Shanghai',
  };
  render(<AnalyticsPages page="compare" />);
  fireEvent.click(screen.getByRole('button', { name: '调整对照期间' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Asia/Shanghai');
  expect(screen.getByRole('dialog')).toHaveTextContent('当前期间');
});
it('keeps a submitting annotation open until its request completes', async () => {
  let complete!: (value: any) => void;
  mocks.post.mockImplementation(() => new Promise(resolve => (complete = resolve)));
  const view = render(<AnalyticsPages page="annotations" />);
  fireEvent.click(screen.getByRole('button', { name: '添加注释' }));
  fireEvent.change(screen.getByLabelText('注释'), { target: { value: '待保存注释' } });
  fireEvent.submit(screen.getByLabelText('注释').closest('form')!);
  await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
  mocks.actionBusy = true;
  view.rerender(<AnalyticsPages page="annotations" />);
  fireEvent.click(screen.getByRole('button', { name: '关闭弹窗' }));
  const discard = screen.queryByRole('button', { name: '放弃修改并关闭' });
  if (discard) fireEvent.click(discard);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  complete({});
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('keeps retention observation cells fixed across midnight until an explicit month selection', () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-10-09T23:59:59Z'));
    mocks.context.range = { startAt: Date.UTC(2026, 9, 1), endAt: Date.now(), timezone: 'UTC' };
    mocks.query.retention = [
      { date: '2026-10-08', day: 0, visitors: 10 },
      { date: '2026-10-08', day: 1, returnVisitors: 5 },
    ];
    const view = render(<AnalyticsPages page="retention" />);
    expect(screen.queryByRole('button', { name: /第 1 天，留存 50.00%/ })).not.toBeInTheDocument();
    vi.setSystemTime(new Date('2026-10-10T00:00:01Z'));
    view.rerender(<AnalyticsPages page="retention" />);
    expect(screen.queryByRole('button', { name: /第 1 天，留存 50.00%/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('月份'), { target: { value: '2026-09' } });
    fireEvent.change(screen.getByLabelText('月份'), { target: { value: '2026-10' } });
    expect(screen.getByRole('button', { name: /第 1 天，留存 50.00%/ })).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});
