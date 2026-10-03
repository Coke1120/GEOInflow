import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ExtendedPages } from './ExtendedPages';

const mocks = vi.hoisted(() => {
  let resolvePlayer!: () => void;
  return {
    context: null as any,
    query: {} as Record<string, any>,
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
  useData: (key: any[]) => ({ data: mocks.query[key[0]], error: null, isPending: false }),
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
vi.mock('@/lib/liekan/upstream/replay-client', () => ({
  prepareReplayEvents: (events: any[]) => events,
}));
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
    href: () => '/replays',
  };
});

it('initializes a delayed replay import with the current selected speed', async () => {
  mocks.query.replay = {
    events: [
      { type: 2, timestamp: 1000, data: {} },
      { type: 3, timestamp: 2000, data: {} },
    ],
  };
  render(<ExtendedPages page="replay-player" />);
  fireEvent.change(screen.getByRole('combobox', { name: '播放速度' }), { target: { value: '4' } });
  mocks.releasePlayer();
  await waitFor(() => expect(mocks.construct).toHaveBeenCalled());
  expect(mocks.construct.mock.calls[0][0].props.speed).toBe(4);
  expect(mocks.construct.mock.calls[0][0].props.speedOption).toEqual([0.5, 1, 2, 4]);
  fireEvent.change(screen.getByRole('combobox', { name: '播放速度' }), { target: { value: '.5' } });
  expect(mocks.setConfig).toHaveBeenLastCalledWith({ speed: 0.5 });
});

it('offers cancellation for an already saved replay without a duplicate creation form', async () => {
  mocks.query.replay = { events: [] };
  mocks.query['replay-saved'] = { isSaved: true, name: '收藏' };
  render(<ExtendedPages page="replay-player" />);
  fireEvent.click(screen.getByRole('button', { name: '已保存' }));
  const drawer = screen.getByRole('dialog');
  expect(drawer.querySelector('input[name="name"]')).toBeNull();
  fireEvent.click(within(drawer).getByRole('button', { name: '取消保存' }));
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
  fireEvent.click(screen.getByRole('button', { name: '保存录制' }));
  const drawer = screen.getByRole('dialog');
  expect(drawer.querySelector('input[name="name"]')).not.toBeNull();
  expect(within(drawer).queryByRole('button', { name: '取消保存' })).not.toBeInTheDocument();
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
