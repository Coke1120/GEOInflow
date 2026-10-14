import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ExtendedPages } from './ExtendedPages';
import { LiekanLocaleContext } from '@/lib/liekan/i18n/client';

const mocks = vi.hoisted(() => {
  let resolvePlayer!: () => void;
  return {
    context: null as any,
    query: {} as Record<string, any>,
    errors: {} as Record<string, Error>,
    post: vi.fn(),
    construct: vi.fn(),
    setConfig: vi.fn(),
    chart: vi.fn(),
    playerReady: new Promise<void>(resolve => {
      resolvePlayer = resolve;
    }),
    releasePlayer: () => resolvePlayer(),
  };
});
vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));
vi.mock('./context', () => ({
  useFeature: () => mocks.context,
  useData: (key: any[]) => ({
    data: mocks.query[key[0]],
    error: mocks.errors[key[0]] || null,
    isPending: false,
  }),
  useAction: () => ({
    run: async (action: () => Promise<any>) => action(),
    busy: false,
    error: '',
  }),
}));
vi.mock('./Chart', () => ({
  Chart: (props: any) => {
    mocks.chart(props);
    return null;
  },
}));
vi.mock('./Exports', () => ({ Exports: () => null }));
vi.mock('rrweb-player', async () => {
  await mocks.playerReady;
  return {
    default: class {
      constructor(settings: any) {
        mocks.construct(settings);
      }
      getReplayer() {
        return { setConfig: mocks.setConfig, getCurrentTime: () => 0 };
      }
      addEventListener() {}
      $set() {}
      $destroy() {}
    },
  };
});

beforeEach(() => {
  mocks.query = {};
  mocks.errors = {};
  mocks.post.mockReset().mockResolvedValue({});
  mocks.construct.mockClear();
  mocks.setConfig.mockClear();
  mocks.chart.mockClear();
  mocks.context = {
    user: { id: 'owner', isAdmin: true },
    siteId: 'site',
    site: { userId: 'owner' },
    route: { page: 'replay-player', id: 'visit' },
    query: {},
    range: { startAt: 1, endAt: 2, timezone: 'Asia/Shanghai' },
    filters: {},
    teams: [],
    api: { post: mocks.post },
    href: vi.fn(() => '/replays'),
  };
});

function replayEvents(): any[] {
  return [
    {
      type: 2,
      timestamp: 1000,
      data: {
        node: {
          type: 0,
          id: 1,
          childNodes: [
            {
              type: 2,
              tagName: 'html',
              id: 2,
              attributes: {},
              childNodes: [{ type: 2, tagName: 'body', id: 3, attributes: {}, childNodes: [] }],
            },
          ],
        },
      },
    },
    { type: 3, timestamp: 2000, data: {} },
  ];
}

it('initializes a delayed replay import with the current selected speed', async () => {
  mocks.query.replay = { events: replayEvents() };
  render(<ExtendedPages page="replay-player" />);
  fireEvent.change(screen.getByRole('combobox', { name: '播放速度' }), { target: { value: '4' } });
  mocks.releasePlayer();
  await waitFor(() => expect(mocks.construct).toHaveBeenCalled());
  expect(mocks.construct.mock.calls[0][0].props.speed).toBe(4);
  expect(mocks.construct.mock.calls[0][0].props.speedOption).toEqual([0.5, 1, 2, 4]);
  fireEvent.change(screen.getByRole('combobox', { name: '播放速度' }), { target: { value: '.5' } });
  expect(mocks.setConfig).toHaveBeenLastCalledWith({ speed: 0.5 });
});

it.each(['html', 'body'])(
  'offers current-site recorder settings for a snapshot missing %s',
  async missing => {
    const events = replayEvents();
    const node = events[0].data.node;
    if (missing === 'html') node.childNodes = [];
    else node.childNodes[0].childNodes = [];
    mocks.query.replay = { events };
    mocks.context.query = { websiteId: 'foreign-site' };
    render(<ExtendedPages page="replay-player" />);
    mocks.releasePlayer();
    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('此录制缺少完整页面快照，暂时无法播放。');
    expect(within(error).getByRole('link', { name: '查看当前网站采集设置' })).toBeInTheDocument();
    expect(mocks.context.href).toHaveBeenCalledWith('recorder-settings', { websiteId: 'site' });
    expect(mocks.construct).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '播放' })).toBeDisabled();
  },
);

it('preserves replay markers matching interface copy and localizes only an absent marker fallback', () => {
  mocks.query.replay = {
    events: [
      ...replayEvents(),
      { type: 5, timestamp: 3000, data: { tag: '页面访问' } },
      { type: 5, timestamp: 4000, data: { tag: '行为标记' } },
      { type: 5, timestamp: 5000, data: {} },
    ],
  };
  const page = (locale: 'en-US' | 'zh-CN') => (
    <LiekanLocaleContext.Provider value={locale}>
      <ExtendedPages page="replay-player" />
    </LiekanLocaleContext.Provider>
  );
  const view = render(page('en-US'));
  expect(screen.getByRole('button', { name: '页面访问' })).toBeVisible();
  expect(screen.getByRole('button', { name: '行为标记' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Behavior tag' })).toBeVisible();
  view.rerender(page('zh-CN'));
  expect(screen.getAllByRole('button', { name: '行为标记' })).toHaveLength(2);
});
it('retains a player loading error without presenting a missing-snapshot settings action', async () => {
  mocks.query.replay = { events: replayEvents() };
  mocks.construct.mockImplementationOnce(() => {
    throw new Error('播放器加载中断');
  });
  render(<ExtendedPages page="replay-player" />);
  mocks.releasePlayer();
  const error = await screen.findByRole('alert');
  expect(error).toHaveTextContent('录制播放器加载失败，请重新读取。');
  expect(screen.queryByRole('link', { name: '查看当前网站采集设置' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '播放' })).toBeDisabled();
});

it('offers cancellation for an already saved replay without a duplicate creation form', async () => {
  mocks.query.replay = { events: [] };
  mocks.query['replay-saved'] = { isSaved: true, name: '收藏' };
  render(<ExtendedPages page="replay-player" />);
  fireEvent.click(screen.getByRole('button', { name: '已保存' }));
  const drawer = screen.getByRole('dialog');
  expect(drawer.querySelector('input[name="name"]')).toBeNull();
  fireEvent.click(within(drawer).getByRole('button', { name: '取消保存此回放' }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith('/websites/site/replays/saved/visit', {
      isSaved: false,
    }),
  );
});

it('retains the creation form for a replay that has not been saved', () => {
  mocks.query.replay = { events: [] };
  mocks.query['replay-saved'] = { isSaved: false };
  render(<ExtendedPages page="replay-player" />);
  fireEvent.click(screen.getByRole('button', { name: '保存会话回放' }));
  const drawer = screen.getByRole('dialog');
  expect(drawer.querySelector('input[name="name"]')).not.toBeNull();
  expect(within(drawer).getByRole('button', { name: '保存回放' })).toBeInTheDocument();
  expect(within(drawer).queryByRole('button', { name: '取消保存此回放' })).not.toBeInTheDocument();
});

it('routes missing heatmap inputs to the current website recorder settings', () => {
  mocks.query.heatmap = { pages: [], points: [] };
  render(<ExtendedPages page="heatmaps" />);
  expect(screen.getByRole('link', { name: '查看当前网站采集设置' })).toBeInTheDocument();
  expect(mocks.context.href).toHaveBeenCalledWith('recorder-settings', { websiteId: 'site' });
});

it('routes an empty replay list to the current website recorder settings', () => {
  mocks.query['replay-list'] = { rows: [], count: 0 };
  render(<ExtendedPages page="replays" />);
  expect(screen.getByText(/会话是一次连续访问/)).toBeInTheDocument();
  expect(mocks.context.href).toHaveBeenCalledWith('recorder-settings', { websiteId: 'site' });
});
it('localizes generated replay visitor labels while keeping saved names and searches raw', () => {
  mocks.query['replay-list'] = {
    rows: [
      { id: 'one', sessionId: 'session-111111', startedAt: null },
      { id: 'two', sessionId: 'session-222222', name: '访客 111111', startedAt: null },
      { id: 'three', sessionId: 'session-333333', name: '网站管理', startedAt: null },
    ],
    count: 3,
  };
  const page = (locale: 'en-US' | 'zh-CN') => (
    <LiekanLocaleContext.Provider value={locale}>
      <ExtendedPages page="replays" />
    </LiekanLocaleContext.Provider>
  );
  const view = render(page('en-US'));
  expect(screen.getByRole('cell', { name: /Visitor 111111/ })).toBeVisible();
  expect(screen.getByRole('cell', { name: '访客 111111' })).toBeVisible();
  expect(screen.getByRole('cell', { name: '网站管理' })).toBeVisible();
  const search = screen.getByRole('searchbox');
  fireEvent.change(search, { target: { value: 'Visitor 111111' } });
  expect(screen.getAllByRole('link', { name: 'Play →' })).toHaveLength(1);
  view.rerender(page('zh-CN'));
  expect(search).toHaveValue('Visitor 111111');
  expect(screen.getAllByRole('link', { name: '播放 →' })).toHaveLength(1);
});
it('formats the replay player visitor prefix without changing its masked suffix', () => {
  mocks.query.replay = { sessionId: 'session-abcdef', events: [] };
  render(
    <LiekanLocaleContext.Provider value="en-US">
      <ExtendedPages page="replay-player" />
    </LiekanLocaleContext.Provider>,
  );
  expect(screen.getByRole('heading', { name: /^Visitor abcdef ·/ })).toBeVisible();
  expect(screen.queryByText('session-abcdef')).not.toBeInTheDocument();
});

it('shows measured zero revenue but preserves a missing amount as unavailable', () => {
  mocks.query['revenue-summary'] = { sum: null, count: 0, unique_count: 0 };
  const view = render(<ExtendedPages page="revenue" />);
  expect(screen.queryByText('¥0.00')).not.toBeInTheDocument();
  mocks.query['revenue-summary'] = { sum: '0', count: 0, unique_count: 0 };
  view.rerender(<ExtendedPages page="revenue" />);
  expect(screen.getByText('¥0.00')).toBeInTheDocument();
  expect(screen.getByText('金额单位：CNY。累计从所选期间起点计算。')).toBeInTheDocument();
});

it('retains a real revenue summary failure even when detail queries succeed', () => {
  mocks.errors['revenue-summary'] = new Error('收入汇总读取暂不可用');
  mocks.query['revenue-chart'] = { chart: [] };
  mocks.query['revenue-sources'] = [];
  mocks.query['revenue-transactions'] = { rows: [], count: 0 };
  render(<ExtendedPages page="revenue" />);
  expect(screen.getByRole('alert')).toHaveTextContent('收入汇总读取暂不可用');
  expect(screen.queryByText('¥0.00')).not.toBeInTheDocument();
});

it('preserves decimal API amounts in revenue cards, transactions and cumulative tooltips', () => {
  mocks.query['revenue-summary'] = {
    sum: '99999999999999.99',
    count: 2,
    unique_count: 1,
    average: 49999999999999.99,
  };
  mocks.query['revenue-sources'] = [{ name: 'search.test', value: '99999999999999.99' }];
  mocks.query['revenue-transactions'] = {
    rows: [{ id: 'event', sessionId: 'visitor', event: 'purchase', amount: '99999999999999.99' }],
    count: 1,
  };
  mocks.query['revenue-chart'] = {
    chart: [
      { t: '2026-10-01', y: '99999999999999.98' },
      { t: '2026-10-01', y: '0.01' },
      { t: '2026-10-02', y: '0.01' },
    ],
  };
  render(<ExtendedPages page="revenue" />);
  expect(screen.getAllByText('¥99,999,999,999,999.99')).toHaveLength(3);
  expect(screen.getByText('¥50,000,000,000,000.00')).toBeInTheDocument();
  let props = mocks.chart.mock.calls.at(-1)![0];
  expect(props.option.tooltip.valueFormatter(props.series[0].values[0], 0)).toBe(
    '¥99,999,999,999,999.99',
  );
  fireEvent.click(screen.getByRole('tab', { name: '累计' }));
  props = mocks.chart.mock.calls.at(-1)![0];
  expect(props.option.tooltip.valueFormatter(props.series[0].values[1], 1)).toBe(
    '¥100,000,000,000,000.00',
  );
  expect(props.option.series[0].data[1].exactAmount).toBe('100000000000000.00');
});
