vi.mock('@/lib/liekan/upstream/catalog-client', () => ({ clientCatalogVersion: vi.fn(async () => '96074773-f17b-46e9-9af5-b09bca5e4281') }));
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ShareFeatureView } from './WorkspacePages';
import { ManualRefreshProvider } from '@/lib/liekan/contracts/manual-refresh';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));
vi.mock('./Chart', () => ({
  Chart: ({ title, series }: any) => (
    <section>
      <h2>{title}</h2>
      <span>{JSON.stringify(series)}</span>
    </section>
  ),
}));
let client: QueryClient;
let visibility = 'visible';
let online = true;
const share = (
  name = '当前分享',
  parameters = { overview: false, events: true, utm: false, goals: false },
) => ({
  token: 'share-proof',
  websiteId: 'site',
  name,
  parameters: { ...parameters, allowFilter: false },
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T00:00:00Z'));
  visibility = 'visible';
  online = true;
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility as any);
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  client.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const aggregate = () =>
  Response.json([{ x: 'register', t: '2026-10-04', y: 7 }], {
    headers: {
      'X-Liekan-Server-Time': String(Date.now()),
      'X-Liekan-Generated-At': String(Date.now()),
      'X-Liekan-Expires-At': String(Date.now() + 300000),
    },
  });
const advance = (time: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(time);
  });
function mount(initialPage = 'overview') {
  return render(
    <QueryClientProvider client={client}>
      <ManualRefreshProvider>
        <ShareFeatureView slug="public" initialPage={initialPage} />
      </ManualRefreshProvider>
    </QueryClientProvider>,
  );
}
it('renders the initial public shell on the server without browser globals', () => {
  vi.stubGlobal('document', undefined);
  expect(() =>
    renderToString(
      <QueryClientProvider client={client}>
        <ShareFeatureView slug="public" initialPage="overview" />
      </QueryClientProvider>,
    ),
  ).not.toThrow();
});
it('clears public data when the board layout changes while resource identifiers stay the same', async () => {
  let authorizations = 0;
  const fetch = vi.fn(async (input: URL) =>
    String(input).includes('/api/share/')
      ? Response.json({
          ...share(),
          boardId: 'board',
          websiteIds: ['site'],
          boardLayoutHash: ++authorizations === 1 ? 'layout-a' : 'layout-b',
        })
      : aggregate(),
  );
  vi.stubGlobal('fetch', fetch);
  mount('events');
  await advance(1);
  expect(fetch.mock.calls.filter(([url]) => String(url).includes('/events/series'))).toHaveLength(
    1,
  );
  await advance(30000);
  expect(fetch.mock.calls.filter(([url]) => String(url).includes('/events/series'))).toHaveLength(
    1,
  );
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  await advance(100);
  expect(fetch.mock.calls.filter(([url]) => String(url).includes('/events/series'))).toHaveLength(
    2,
  );
});
it('shows an empty public goals configuration without classifying it as an expired aggregate', async () => {
  const fetch = vi.fn(async (input: URL) =>
    String(input).includes('/api/share/')
      ? Response.json(
          share('空目标分享', { overview: false, events: false, utm: false, goals: true }),
        )
      : Response.json({ data: [], count: 0, page: 1, pageSize: 25 }),
  );
  vi.stubGlobal('fetch', fetch);
  mount('goals');
  await advance(1);
  expect(screen.getByText('目标与漏斗')).toBeInTheDocument();
  expect(screen.queryByText(/统计数据已过期/)).not.toBeInTheDocument();
  expect(fetch.mock.calls.some(([url]) => String(url).includes('/stats'))).toBe(false);
});
it('authorizes public entry over the network before showing any cached identity or values', async () => {
  client.setQueryData(['liekan-public-share', 'public'], share('旧的缓存分享'));
  let finish!: (value: Response) => void;
  const fetch = vi.fn((input: URL) =>
    String(input).includes('/api/share/')
      ? new Promise<Response>(resolve => {
          finish = resolve;
        })
      : Promise.resolve(aggregate()),
  );
  vi.stubGlobal('fetch', fetch);
  mount();
  expect(screen.queryByText(/旧的缓存分享/)).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: '事件趋势' })).not.toBeInTheDocument();
  await advance(1);
  await act(async () => finish(Response.json(share())));
  await advance(1);
  expect(screen.getByText('当前分享 · 只读分享')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '事件趋势' })).toBeInTheDocument();
});
it('withholds data after hidden resume until a fresh authorization response succeeds', async () => {
  let shareCalls = 0;
  let finish!: (value: Response) => void;
  const fetch = vi.fn((input: URL, _init?: any) => {
    if (!String(input).includes('/api/share/')) return Promise.resolve(aggregate());
    shareCalls++;
    return shareCalls === 1
      ? Promise.resolve(Response.json(share()))
      : new Promise<Response>(resolve => {
          finish = resolve;
        });
  });
  vi.stubGlobal('fetch', fetch);
  mount();
  await advance(1);
  expect(screen.getByRole('heading', { name: '事件趋势' })).toBeInTheDocument();
  visibility = 'hidden';
  fireEvent(document, new Event('visibilitychange'));
  await advance(45000);
  expect(shareCalls).toBe(1);
  visibility = 'visible';
  fireEvent(document, new Event('visibilitychange'));
  await advance(1);
  expect(shareCalls).toBe(2);
  expect(screen.queryByRole('heading', { name: '事件趋势' })).not.toBeInTheDocument();
  expect(
    fetch.mock.calls.filter(call => String(call[0]).includes('/api/share/'))[1][1].headers[
      'x-umami-share-token'
    ],
  ).toBe('share-proof');
  await act(async () => finish(Response.json(share('重新验证的分享'))));
  await advance(1);
  expect(screen.getByText('重新验证的分享 · 只读分享')).toBeInTheDocument();
});
it('expires a historical public report after 30 seconds when authorization renewal fails offline', async () => {
  let shareCalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL) => {
      if (!String(input).includes('/api/share/')) return aggregate();
      if (++shareCalls > 1) throw new TypeError('offline');
      return Response.json(share());
    }),
  );
  mount();
  await advance(1);
  expect(screen.getByRole('heading', { name: '事件趋势' })).toBeInTheDocument();
  online = false;
  await advance(30000);
  expect(screen.queryByRole('heading', { name: '事件趋势' })).not.toBeInTheDocument();
  expect(screen.queryByText('当前分享 · 只读分享')).not.toBeInTheDocument();
});
it.each([401, 403, 404])(
  'removes public modules immediately after a %s authorization rejection',
  async status => {
    let shareCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL) => {
        if (!String(input).includes('/api/share/')) return aggregate();
        return ++shareCalls === 1 ? Response.json(share()) : Response.json({}, { status });
      }),
    );
    mount();
    await advance(1);
    expect(screen.getByRole('heading', { name: '事件趋势' })).toBeInTheDocument();
    fireEvent(window, new Event('focus'));
    await advance(1);
    expect(screen.queryByRole('heading', { name: '事件趋势' })).not.toBeInTheDocument();
    expect(
      client
        .getQueryCache()
        .getAll()
        .some(query => query.queryKey[0] === 'liekan-public'),
    ).toBe(false);
  },
);
it('applies the latest successful share name and scope and removes formerly allowed modules', async () => {
  let shareCalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL) => {
      if (!String(input).includes('/api/share/')) return aggregate();
      return Response.json(
        ++shareCalls === 1
          ? share()
          : share('收窄后的分享', {
              overview: false,
              events: false,
              utm: false,
              goals: false,
            }),
      );
    }),
  );
  mount();
  await advance(1);
  expect(screen.getByRole('heading', { name: '事件趋势' })).toBeInTheDocument();
  fireEvent(window, new Event('focus'));
  await advance(1);
  expect(screen.getByText('收窄后的分享 · 只读分享')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: '事件趋势' })).not.toBeInTheDocument();
  expect(screen.getByText('此分享未开放统计页面。')).toBeInTheDocument();
  expect(
    client
      .getQueryCache()
      .getAll()
      .some(query => query.queryKey[0] === 'liekan-public'),
  ).toBe(false);
});

it('rotates credentials and names without evicting a still-valid historical aggregate', async () => {
  let shareCalls = 0;
  let aggregateCalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL) => {
      if (!String(input).includes('/api/share/')) {
        aggregateCalls++;
        return aggregate();
      }
      shareCalls++;
      return Response.json({ ...share(`名称 ${shareCalls}`), token: `proof-${shareCalls}` });
    }),
  );
  mount();
  await advance(1);
  const original = client
    .getQueryCache()
    .getAll()
    .find(query => query.queryKey[0] === 'liekan-public');
  expect(aggregateCalls).toBe(1);
  await advance(30000);
  expect(shareCalls).toBe(2);
  expect(screen.getByText('名称 2 · 只读分享')).toBeInTheDocument();
  expect(aggregateCalls).toBe(1);
  expect(
    client
      .getQueryCache()
      .getAll()
      .find(query => query.queryKey[0] === 'liekan-public'),
  ).toBe(original);
  await advance(30000);
  expect(shareCalls).toBe(3);
  expect(aggregateCalls).toBe(1);
});
it('retains a historical aggregate behind the resume authorization gate and reuses it after authorization', async () => {
  let shareCalls = 0;
  let aggregateCalls = 0;
  let finish!: (value: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: URL) => {
      if (!String(input).includes('/api/share/')) {
        aggregateCalls++;
        return Promise.resolve(aggregate());
      }
      return ++shareCalls === 1
        ? Promise.resolve(Response.json(share()))
        : new Promise<Response>(resolve => {
            finish = resolve;
          });
    }),
  );
  mount();
  await advance(1);
  visibility = 'hidden';
  fireEvent(document, new Event('visibilitychange'));
  await advance(45000);
  expect(
    client
      .getQueryCache()
      .getAll()
      .some(query => query.queryKey[0] === 'liekan-public' && query.state.data),
  ).toBe(true);
  visibility = 'visible';
  fireEvent(document, new Event('visibilitychange'));
  await advance(1);
  expect(screen.queryByRole('heading', { name: '事件趋势' })).not.toBeInTheDocument();
  expect(aggregateCalls).toBe(1);
  await act(async () => finish(Response.json({ ...share(), token: 'rotated-proof' })));
  await advance(1);
  expect(screen.getByRole('heading', { name: '事件趋势' })).toBeInTheDocument();
  expect(aggregateCalls).toBe(1);
});
it('advances the public relative calendar range across Shanghai midnight', async () => {
  vi.setSystemTime(new Date('2026-10-05T15:59:59Z'));
  const reads: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL) => {
      if (String(input).includes('/api/share/')) return Response.json(share());
      reads.push(new URL(String(input)));
      return aggregate();
    }),
  );
  mount();
  await advance(1);
  const initialEnd = Number(reads[0].searchParams.get('endAt'));
  await advance(1000);
  expect(reads.length).toBe(2);
  expect(Number(reads.at(-1)!.searchParams.get('endAt'))).toBe(initialEnd + 86400000);
});

it('keeps a selected Today preset live across publisher midnight into a 25-hour day', async () => {
  vi.setSystemTime(new Date('2026-11-01T03:59:59Z'));
  const reads: URL[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: URL) => {
    if (String(input).includes('/api/share/')) return Response.json({
      ...share(), parameters: { ...share().parameters, allowFilter: true, timezone: 'America/New_York', range: '0day' },
    });
    reads.push(new URL(String(input)));
    return aggregate();
  }));
  mount();
  await advance(20);
  fireEvent.click(screen.getByRole('button', { name: '今天' }));
  await advance(20);
  expect(reads).toHaveLength(1);
  await advance(1000);
  expect(reads).toHaveLength(2);
  const latest = reads.at(-1)!.searchParams;
  expect(latest.get('timezone')).toBe('America/New_York');
  expect(Number(latest.get('startAt'))).toBe(Date.parse('2026-11-01T04:00:00Z'));
  expect(Number(latest.get('endAt'))).toBe(Date.parse('2026-11-02T04:59:59.999Z'));
  expect(screen.getByRole('button', { name: '今天' })).toHaveAttribute('aria-pressed', 'true');
});

it('reads a newly selected public preset using the selection time after midnight', async () => {
  vi.setSystemTime(new Date('2026-10-05T15:59:59Z'));
  const reads: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL) => {
      if (String(input).includes('/api/share/'))
        return Response.json({
          ...share(),
          parameters: { ...share().parameters, allowFilter: true },
        });
      reads.push(new URL(String(input)));
      return aggregate();
    }),
  );
  mount();
  await advance(50);
  await advance(120000);
  const count = reads.length;
  fireEvent.click(screen.getByRole('button', { name: '7 天' }));
  await advance(50);
  expect(reads.length).toBe(count + 1);
  expect(Number(reads.at(-1)!.searchParams.get('endAt'))).toBeGreaterThan(
    Number(reads[0].searchParams.get('endAt')),
  );
  expect(Number(reads.at(-1)!.searchParams.get('endAt'))).toBeGreaterThanOrEqual(Date.now());
});

it('preserves explicitly selected public dates across midnight', async () => {
  vi.setSystemTime(new Date('2026-10-05T15:59:59Z'));
  const reads: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL) => {
      if (String(input).includes('/api/share/'))
        return Response.json({
          ...share(),
          parameters: { ...share().parameters, allowFilter: true },
        });
      reads.push(new URL(String(input)));
      return aggregate();
    }),
  );
  mount();
  await advance(1);
  fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-09-01' } });
  fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-09-30' } });
  await advance(1);
  const last = reads.at(-1)!;
  const count = reads.length;
  await advance(1000);
  expect(reads.length).toBe(count);
  expect(reads.at(-1)!.searchParams.get('startAt')).toBe(last.searchParams.get('startAt'));
  expect(reads.at(-1)!.searchParams.get('endAt')).toBe(last.searchParams.get('endAt'));
});
