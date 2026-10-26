vi.mock('@/lib/liekan/upstream/catalog-client', () => ({ clientCatalogVersion: vi.fn(async () => '96074773-f17b-46e9-9af5-b09bca5e4281') }));
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWebsiteStatsQuery } from '@/components/hooks/queries/useWebsiteStatsQuery';
import { ENTITY_TYPE } from '@/lib/constants';
import { setShareData, useApp } from '@/store/app';
import { setTestUrl } from '@/test/navigation';
import { ShareProvider } from './ShareProvider';
import { ManualRefreshProvider } from '@/lib/liekan/contracts/manual-refresh';

vi.mock('@/lib/client', () => ({ getClientAuthToken: () => null }));
vi.mock('@/components/hooks/useDateParameters', () => ({
  useDateParameters: () => ({ startAt: 100, endAt: 200, unit: 'day', timezone: 'UTC' }),
}));
vi.mock('@/components/hooks/useFilterParameters', () => ({ useFilterParameters: () => ({}) }));

const NOW = Date.parse('2026-10-01T12:00:00Z');
let client: QueryClient;
let visibility: DocumentVisibilityState;
let online: boolean;
let proofReads: number;
let statisticReads: number;
let holdProof: boolean;
let finishProof: (response: Response) => void;
let authorizationResponse: () => Response;
let scope: Record<string, any>;
let fetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  visibility = 'visible';
  online = true;
  proofReads = 0;
  statisticReads = 0;
  holdProof = false;
  scope = {
    shareId: 'public',
    shareType: ENTITY_TYPE.website,
    websiteId: 'site',
    parameters: { overview: true },
  };
  authorizationResponse = () => Response.json({ ...scope, token: `proof-${proofReads}` });
  setShareData(null, null);
  setTestUrl('/share/slug/overview');
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60000 } } });
  fetch = vi.fn(async (url: string, options: RequestInit) => {
    if (new URL(String(url), window.location.origin).pathname === '/api/share/slug') {
      proofReads++;
      if (holdProof)
        return new Promise<Response>((resolve, reject) => {
          finishProof = resolve;
          options.signal?.addEventListener('abort', () =>
            reject(new DOMException('cancelled', 'AbortError')),
          );
        });
      return authorizationResponse();
    }
    statisticReads++;
    return Response.json(
      { pageviews: 7 },
      {
        headers: {
          'X-Liekan-Generated-At': String(Date.now()),
          'X-Liekan-Expires-At': String(Date.now() + 300000),
          'X-Liekan-Server-Time': String(Date.now()),
        },
      },
    );
  });
  vi.stubGlobal('fetch', fetch);
});
afterEach(async () => {
  cleanup();
  client.clear();
  await vi.advanceTimersByTimeAsync(0);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const advance = (time: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(time);
  });
function Statistics() {
  const query = useWebsiteStatsQuery({ websiteId: 'site' });
  return <div>{query.data ? `pageviews: ${query.data.pageviews}` : 'statistics pending'}</div>;
}
function mount() {
  return render(
    <QueryClientProvider client={client}>
      <ManualRefreshProvider>
        <ShareProvider slug="slug">
          <Statistics />
        </ShareProvider>
      </ManualRefreshProvider>
    </QueryClientProvider>,
  );
}

const expectSnapshotHidden = () => {
  const value = screen.queryByText('pageviews: 7');
  expect(!value || !!value.closest('[hidden]')).toBe(true);
};

it('requires a network proof on first mount even when the share token is cached', async () => {
  const cached = { ...scope, token: 'cached-proof' };
  client.setQueryData(['share', 'slug'], cached);
  setShareData(cached, { token: cached.token });
  holdProof = true;
  mount();
  await advance(1);
  expect(proofReads).toBe(1);
  expect(statisticReads).toBe(0);
  expectSnapshotHidden();
  finishProof(authorizationResponse());
  await advance(1);
  expect(screen.getByText('pageviews: 7')).toBeInTheDocument();
  expect(statisticReads).toBe(1);
});

it('renews public authorization every 30 seconds without rereading fresh historical statistics', async () => {
  mount();
  await advance(1);
  await advance(60000);
  expect(proofReads).toBe(3);
  expect(statisticReads).toBe(1);
  const proofCalls = fetch.mock.calls.filter(([url]) => String(url).includes('/share/slug'));
  expect((proofCalls[1][1].headers as Headers).get('x-umami-share-token')).toBe('proof-1');
  expect((proofCalls[2][1].headers as Headers).get('x-umami-share-token')).toBe('proof-2');
  expect(screen.getByText('pageviews: 7')).toBeInTheDocument();
});

it('pauses proof reads while hidden and gates visible offline or pending recovery', async () => {
  mount();
  await advance(1);
  visibility = 'hidden';
  fireEvent(document, new Event('visibilitychange'));
  await advance(90000);
  expect(proofReads).toBe(1);
  online = false;
  visibility = 'visible';
  fireEvent(document, new Event('visibilitychange'));
  await advance(1);
  expect(proofReads).toBe(1);
  expectSnapshotHidden();
  online = true;
  holdProof = true;
  fireEvent(window, new Event('online'));
  await advance(1);
  expect(proofReads).toBe(2);
  expectSnapshotHidden();
  finishProof(authorizationResponse());
  await advance(1);
  expect(screen.getByText('pageviews: 7')).toBeInTheDocument();
  expect(statisticReads).toBe(1);
});

it.each([401, 403, 404])(
  'clears native share data and cached statistics after HTTP %s',
  async status => {
    mount();
    await advance(1);
    authorizationResponse = () => Response.json({ error: { message: 'revoked' } }, { status });
    await advance(30000);
    expectSnapshotHidden();
    expect(useApp.getState().share).toBeNull();
    expect(useApp.getState().shareToken).toBeNull();
    expect(
      client
        .getQueryCache()
        .findAll({ queryKey: ['websites:stats'] })
        .every(query => query.state.data === undefined),
    ).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent('分享链接已失效或访问权限已变更');
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
    await advance(90000);
    fireEvent(window, new Event('focus'));
    await advance(1);
    expect(proofReads).toBe(2);
  },
);

it('drops the old native statistics when the public board layout changes', async () => {
  scope = {
    shareId: 'public',
    shareType: ENTITY_TYPE.board,
    boardId: 'board',
    websiteIds: ['site'],
    boardLayoutHash: 'layout-a',
    parameters: {},
  };
  mount();
  await advance(1);
  const previous = client.getQueryCache().findAll({ queryKey: ['websites:stats'] })[0].queryKey;
  scope = { ...scope, boardLayoutHash: 'layout-b' };
  holdProof = true;
  await advance(30000);
  expectSnapshotHidden();
  finishProof(authorizationResponse());
  await advance(1);
  expect(statisticReads).toBe(1);
  expectSnapshotHidden();
  holdProof = false;
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  await advance(100);
  expect(statisticReads).toBe(2);
  expect(client.getQueryData(previous)).toBeUndefined();
  expect(
    client
      .getQueryCache()
      .findAll({ queryKey: ['websites:stats'] })
      .filter(query => query.state.data !== undefined),
  ).toHaveLength(1);
});

it('shows a transient failure after authorization expires and recovers through explicit retry', async () => {
  mount();
  await advance(1);
  authorizationResponse = () =>
    Response.json({ error: { message: 'unavailable' } }, { status: 503 });
  await advance(30000);
  expectSnapshotHidden();
  expect(screen.getByRole('alert')).toHaveTextContent('分享权限验证失败');
  expect(useApp.getState().shareToken?.token).toBe('proof-1');
  holdProof = true;
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await advance(1);
  expect(proofReads).toBe(3);
  expect(screen.queryByRole('alert')).toBeNull();
  expectSnapshotHidden();
  finishProof(Response.json({ ...scope, token: 'recovered-proof' }));
  await advance(1);
  expect(screen.getByText('pageviews: 7')).toBeInTheDocument();
  expect(statisticReads).toBe(1);
});

it('expires authorization by monotonic time when the wall clock moves back', async () => {
  mount();
  await advance(1);
  vi.setSystemTime(NOW - 500000);
  holdProof = true;
  await advance(30000);
  expect(proofReads).toBe(2);
  expectSnapshotHidden();
  finishProof(authorizationResponse());
  await advance(1);
  expect(screen.getByText('pageviews: 7')).toBeInTheDocument();
  expect(statisticReads).toBe(1);
});

it('waits for the first failed proof Retry-After deadline before automatically retrying', async () => {
  authorizationResponse = () =>
    Response.json(
      { error: { message: 'unavailable' } },
      {
        status: 503,
        headers: { 'Retry-After': '90' },
      },
    );
  mount();
  await advance(100);
  expect(proofReads).toBe(1);
  expect(screen.getByRole('alert')).toHaveTextContent('分享权限验证失败');
  expect(screen.getByRole('button', { name: '重试' })).toBeDisabled();
  vi.setSystemTime(NOW - 500000);
  fireEvent(window, new Event('focus'));
  await advance(89899);
  expect(proofReads).toBe(1);
  await advance(3);
  expect(proofReads).toBe(2);
  expect(statisticReads).toBe(0);
});

it("uses each later proof failure's latest Retry-After with a 30 second automatic minimum", async () => {
  mount();
  await advance(1);
  let retryAfter = '90';
  authorizationResponse = () =>
    Response.json(
      { error: { message: 'unavailable' } },
      {
        status: 503,
        headers: { 'Retry-After': retryAfter },
      },
    );
  await advance(30000);
  expect(proofReads).toBe(2);
  await advance(89998);
  expect(proofReads).toBe(2);
  retryAfter = '180';
  await advance(3);
  expect(proofReads).toBe(3);
  await advance(179996);
  expect(proofReads).toBe(3);
  retryAfter = '10';
  await advance(5);
  expect(proofReads).toBe(4);
  await advance(29995);
  expect(proofReads).toBe(4);
  await advance(6);
  expect(proofReads).toBe(5);
  expectSnapshotHidden();
});
