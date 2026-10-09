import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { featureApi } from '@/lib/liekan/upstream/features-client';
import { FeatureProvider } from './context';
import { ManualRefreshProvider } from '@/lib/liekan/contracts/manual-refresh';
import { ManualRefreshControl } from '../ManualRefreshControl';
import { CorePages } from './CorePages';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));
vi.mock('./Chart', () => ({ Chart: () => <div /> }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

it('waits for a new entry to reload failed goal analytics and definitions', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T00:00:00Z'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const range = { startAt: 0, endAt: Date.now(), timezone: 'UTC', unit: 'day' };
  let definitions = 0,
    analytics = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL) => {
      if (new URL(String(input)).pathname.endsWith('/goals')) {
        definitions++;
        return Response.json({
          data: [{ id: 'goal', name: '报名', parameters: { type: 'event', value: 'submit' } }],
          count: 1,
        });
      }
      analytics++;
      return Response.json({}, { status: 503 });
    }),
  );
  const mount = () =>
    render(
      <QueryClientProvider client={client}>
        <FeatureProvider
          value={
            {
              user: { id: 'viewer' },
              siteId: 'site',
              site: { id: 'site', userId: 'owner' },
              route: { page: 'goals' },
              api: featureApi,
              query: {},
              filters: {},
              teams: [],
              range,
              href: () => '/edit',
            } as any
          }
        >
          <CorePages page="goals" />
        </FeatureProvider>
      </QueryClientProvider>,
    );
  try {
    const view = mount();
    await advance(1);
    expect(analytics).toBe(1);
    await advance(29998);
    expect(analytics).toBe(1);
    await advance(2);
    expect(analytics).toBe(1);
    view.unmount();
    await advance(31000);
    const next = mount();
    await advance(1);
    expect(analytics).toBe(2);
    expect(definitions).toBe(2);
    next.unmount();
  } finally {
    client.clear();
  }
});

it('keeps goal conversions after a failed manual batch and reports partial failure', async () => {
  vi.useFakeTimers();
  let fail = false;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL) => {
      if (new URL(String(input)).pathname.endsWith('/goals'))
        return Response.json({
          data: [{ id: 'goal', name: '报名', parameters: { type: 'event', value: 'submit' } }],
          count: 1,
        });
      return fail
        ? Response.json({}, { status: 503 })
        : Response.json({ conversions: 7, num: 7, total: 10, series: [] });
    }),
  );
  const value = {
    user: { id: 'viewer' },
    siteId: 'site',
    site: { id: 'site', userId: 'owner' },
    route: { page: 'goals' },
    api: featureApi,
    query: {},
    filters: {},
    teams: [],
    range: { startAt: 0, endAt: 1000, timezone: 'UTC' },
    href: () => '/edit',
  } as any;
  render(
    <QueryClientProvider client={client}>
      <ManualRefreshProvider>
        <FeatureProvider value={value}>
          <ManualRefreshControl />
          <CorePages page="goals" />
        </FeatureProvider>
      </ManualRefreshProvider>
    </QueryClientProvider>,
  );
  await advance(50);
  expect(screen.getAllByText('7')).toHaveLength(2);
  fail = true;
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  await advance(30);
  await advance(30);
  await advance(30);
  expect(screen.getAllByText('7')).toHaveLength(2);
  expect(screen.getByText(/部分数据读取失败/)).toBeInTheDocument();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: '重试读取' }));
  await advance(30);
  await advance(30);
  expect(screen.queryByText(/部分数据读取失败/)).not.toBeInTheDocument();
  client.clear();
});
it('updates successful goals and retains the failed goal in the same batch', async () => {
  vi.useFakeTimers();
  let fail = false;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/goals'))
        return Response.json({
          data: ['a', 'b'].map(id => ({
            id,
            name: id === 'a' ? '成功目标' : '失败目标',
            parameters: { type: 'event', value: id },
          })),
          count: 2,
        });
      if (fail && path.includes('/goals/b/')) return Response.json({}, { status: 503 });
      return Response.json({ conversions: fail ? 11 : 7, num: 7, total: 10, series: [] });
    }),
  );
  const value = {
    user: { id: 'viewer' },
    siteId: 'site',
    site: { id: 'site', userId: 'owner' },
    route: { page: 'goals' },
    api: featureApi,
    query: {},
    filters: {},
    teams: [],
    range: { startAt: 0, endAt: 1000, timezone: 'UTC' },
    href: () => '/edit',
  } as any;
  render(
    <QueryClientProvider client={client}>
      <ManualRefreshProvider>
        <FeatureProvider value={value}>
          <ManualRefreshControl />
          <CorePages page="goals" />
        </FeatureProvider>
      </ManualRefreshProvider>
    </QueryClientProvider>,
  );
  await advance(50);
  fail = true;
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  await advance(30);
  await advance(30);
  await advance(30);
  expect(screen.getByRole('row', { name: /失败目标/ })).toHaveTextContent('7');
  expect(screen.getByRole('row', { name: /成功目标/ })).toHaveTextContent('11');
  expect(screen.getByText(/部分数据读取失败/)).toBeInTheDocument();
  client.clear();
});

it.each(['add', 'remove', 'empty', 'failure'])(
  'waits for the current definitions before reading goal statistics after %s',
  async change => {
    vi.useFakeTimers();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let definitions = 0;
    let finish!: (response: Response) => void;
    const records: { goal: string; forced: boolean }[] = [];
    const goals = (ids: string[]) => ({
      data: ids.map(id => ({ id, name: `目标${id}`, parameters: { type: 'event', value: id } })),
      count: ids.length,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/goals')) {
          if (++definitions === 1) return Response.json(goals(['a', 'b']));
          return new Promise<Response>(resolve => (finish = resolve));
        }
        records.push({
          goal: url.pathname.match(/\/goals\/([^/]+)\/analytics/)[1],
          forced: url.searchParams.get('refresh') === '1',
        });
        return Response.json({ conversions: 7, num: 7, total: 10, series: [] });
      }),
    );
    const value = {
      user: { id: 'viewer' },
      siteId: 'site',
      site: { id: 'site', userId: 'owner' },
      route: { page: 'goals' },
      api: featureApi,
      query: {},
      filters: {},
      teams: [],
      range: { startAt: 0, endAt: 1000, timezone: 'UTC' },
      href: () => '/edit',
    } as any;
    try {
      render(
        <QueryClientProvider client={client}>
          <ManualRefreshProvider>
            <FeatureProvider value={value}>
              <ManualRefreshControl />
              <CorePages page="goals" />
            </FeatureProvider>
          </ManualRefreshProvider>
        </QueryClientProvider>,
      );
      await advance(50);
      expect(records).toHaveLength(2);
      fireEvent.click(screen.getByRole('button', { name: '刷新' }));
      await advance(100);
      expect(definitions).toBe(2);
      expect(records).toHaveLength(2);
      const ids = change === 'add' ? ['c', 'a', 'b'] : change === 'remove' ? ['a'] : [];
      await act(async () =>
        finish(
          change === 'failure' ? Response.json({}, { status: 503 }) : Response.json(goals(ids)),
        ),
      );
      await advance(1);
      await advance(30);
      await advance(30);
      expect(records).toHaveLength(2 + ids.length);
      expect(records.filter(row => row.forced).map(row => row.goal)).toEqual(ids);
      expect(screen.getByRole('button', { name: '刷新' })).toBeEnabled();
    } finally {
      client.clear();
    }
  },
);
