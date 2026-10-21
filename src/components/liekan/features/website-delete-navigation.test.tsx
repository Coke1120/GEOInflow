vi.mock('@/lib/liekan/upstream/catalog-client', () => ({ clientCatalogVersion: vi.fn(async () => '96074773-f17b-46e9-9af5-b09bca5e4281') }));
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ManualRefreshProvider } from '@/lib/liekan/contracts/manual-refresh';
import { FeatureApp } from '@/components/liekan/features/FeatureApp';
import { matchFeatureRoute } from '@/components/liekan/features/routes';

const nav = vi.hoisted(() => ({
  path: '/websites/101/settings',
  query: { section: 'danger', returnTo: '/websites?scope=all' } as Record<string, string>,
  commit: null as null | (() => void),
  pending: '',
  defer: false,
  push: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.path,
  useSearchParams: () => new URLSearchParams(nav.query),
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
}));
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ children, prefetch: _prefetch, ...props }: any) => <a {...props}>{children}</a>,
}));
vi.mock('@/lib/liekan/upstream/client', async original => ({
  ...(await original<typeof import('@/lib/liekan/upstream/client')>()),
  useFeatureDateRange: () => ({
    dateRange: {
      value: 'range:1000000000000:1000086400000:day',
      startDate: new Date(1000000000000),
      endDate: new Date(1000086400000),
      unit: 'day',
    },
  }),
}));
vi.mock('@/components/liekan/features/Chart', () => ({ Chart: () => null }));
const site = {
  id: '11111111-1111-4111-8111-111111111111',
  siteNumber: 101,
  name: '删除回归站',
  domain: 'example.invalid',
  userId: 'owner',
};
const team = {
  id: '22222222-2222-4222-8222-222222222222',
  name: '删除回归团队',
  role: 'team-owner',
  members: [{ userId: 'owner', role: 'team-owner' }],
  _count: { members: 1, websites: 0 },
};
const record = {
  id: '33333333-3333-4333-8333-333333333333',
  name: '删除回归资源',
  slug: 'isolated-test',
  userId: 'owner',
  type: 'website',
  parameters: {},
  url: 'https://example.invalid/',
  updatedAt: '2026-10-10T00:00:00Z',
};
let client: QueryClient;
let deleted: boolean;
let deleteFailure: boolean;
let actor: { id: string; username: string; role: string; isAdmin: boolean };
let holdVerify: boolean;
let releaseVerify: (() => void) | undefined;
let listFailure: boolean;
let holdDelete: boolean;
let holdSites: boolean;
let releaseDelete: (() => void) | undefined;
let releaseSites: (() => void) | undefined;
let mode: 'website' | 'team' | 'links' | 'pixels' | 'boards';
let reads: { path: string; method: string; afterDelete: boolean }[];
const list = (rows: any[]) => ({ data: rows, count: rows.length, pageSize: 100 });
beforeEach(() => {
  deleted = false;
  deleteFailure = false;
  actor = { id: 'owner', username: 'owner', role: 'admin', isAdmin: true };
  holdVerify = false;
  releaseVerify = undefined;
  listFailure = true;
  holdDelete = holdSites = false;
  releaseDelete = releaseSites = undefined;
  vi.clearAllMocks();
  mode = 'website';
  reads = [];
  nav.path = '/websites/101/settings';
  nav.query = { section: 'danger', returnTo: '/websites?scope=all' };
  nav.pending = '';
  nav.defer = false;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL, init: RequestInit = {}) => {
      const path = new URL(String(input)).pathname;
      const method = init.method || 'GET';
      reads.push({ path, method, afterDelete: deleted });
      if (method === 'POST' && path === '/api/auth/verify') {
        const verified = () =>
          Response.json({ id: 'owner', username: 'owner', role: 'admin', isAdmin: true });
        return holdVerify
          ? new Promise<Response>(resolve => {
              releaseVerify = () => resolve(verified());
            })
          : verified();
      }
      if (method === 'DELETE') {
        if (deleteFailure)
          return Response.json({ error: { message: '删除失败，请重试。' } }, { status: 500 });
        const result = () => {
          deleted = true;
          return Response.json({ ok: true });
        };
        return holdDelete
          ? new Promise<Response>(resolve => {
              releaseDelete = () => resolve(result());
            })
          : result();
      }
      const fail = () =>
        Response.json({ error: { message: '删除后列表暂时不可用' } }, { status: 500 });
      if (path === '/api/me/websites' && holdSites)
        return new Promise<Response>(resolve => {
          releaseSites = () => resolve(Response.json(list([site])));
        });
      if (path === '/api/me/websites')
        return deleted && mode === 'website' && listFailure
          ? fail()
          : Response.json(list(mode === 'website' && !deleted ? [site] : []));
      if (path === '/api/me/teams')
        return deleted && mode === 'team'
          ? fail()
          : Response.json(list(mode === 'team' ? [team] : []));
      if (path === '/api/teams')
        return deleted && mode === 'team' ? fail() : Response.json(list([team]));
      if (['links', 'pixels', 'boards'].includes(mode) && path === '/api/' + mode)
        return deleted ? fail() : Response.json(list([record]));
      if (['links', 'pixels', 'boards'].includes(mode) && path === '/api/' + mode + '/' + record.id)
        return Response.json(record);
      if (path === '/api/websites/' + site.id || path === '/api/websites/101')
        return Response.json(deleted ? null : site);
      if (path === '/api/teams/' + team.id) return Response.json(team);
      if (path === '/api/liekan/websites/summary') return Response.json([]);
      if (path.endsWith('/settings'))
        return Response.json({ isDemo: false, aiCrawlerEnabled: false });
      if (path.endsWith('/stats')) return Response.json({ pageviews: { value: 0 } });
      if (path.endsWith('/daterange')) return Response.json({ startDate: null, endDate: null });
      if (
        path.endsWith('/websites') ||
        path.endsWith('/users') ||
        path.endsWith('/boards') ||
        path.endsWith('/links') ||
        path.endsWith('/pixels')
      )
        return Response.json(list([]));
      return Response.json({});
    }),
  );
});
afterEach(() => {
  client.clear();
  vi.unstubAllGlobals();
});
function commit() {
  const u = new URL(nav.pending, 'http://localhost');
  nav.path = u.pathname;
  nav.query = Object.fromEntries(u.searchParams);
  nav.pending = '';
  nav.commit?.();
}
function Harness() {
  const [revision, setRevision] = useState(0);
  nav.commit = () => setRevision(value => value + 1);
  const navigate = (href: string) => {
    nav.pending = href;
    if (!nav.defer) commit();
  };
  nav.push.mockImplementation(navigate);
  nav.replace.mockImplementation(navigate);
  return (
    <QueryClientProvider client={client}>
      <ManualRefreshProvider>
        <FeatureApp user={actor} route={matchFeatureRoute(nav.path, nav.query)} />
      </ManualRefreshProvider>
    </QueryClientProvider>
  );
}
it('completed website deletion stays absent when the returned all-sites list fails', async () => {
  render(<Harness />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: '删除网站' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.type(dialog.getByLabelText(/输入 删除回归站 确认/), site.name);
  await user.click(dialog.getByRole('button', { name: '删除网站' }));
  await waitFor(() => expect(nav.path).toBe('/websites'));
  await waitFor(() =>
    expect(reads.some(read => read.afterDelete && read.path === '/api/me/websites')).toBe(true),
  );
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
  });
  const result = await screen.findByRole('dialog', { name: '网站删除成功' });
  expect(within(result).getByText(site.name)).toBeInTheDocument();
  expect(within(result).getByText(site.domain)).toBeInTheDocument();
  expect(
    within(result).getByText('该网站及其关联数据和设置已删除，无法恢复。'),
  ).toBeInTheDocument();
  expect(document.querySelector('.toast')).not.toBeInTheDocument();
  await user.click(within(result).getByRole('button', { name: '知道了' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(document.querySelector('main')).toHaveFocus();
  expect(screen.queryByRole('link', { name: site.name })).not.toBeInTheDocument();
});
it('keeps the final website result until dismissal and does not replay it on re-entry', async () => {
  listFailure = false;
  render(<Harness />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: '删除网站' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.type(dialog.getByLabelText(/输入 删除回归站 确认/), site.name);
  await user.click(dialog.getByRole('button', { name: '删除网站' }));
  const result = await screen.findByRole('dialog', { name: '网站删除成功' });
  expect(result.querySelector('section')).toHaveAttribute('data-dialog-size', 'wide');
  vi.useFakeTimers();
  try {
    await act(async () => vi.advanceTimersByTime(5000));
    expect(screen.getByRole('dialog', { name: '网站删除成功' })).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await act(async () => {
    nav.pending = '/liekan/help';
    commit();
  });
  await act(async () => {
    nav.pending = '/websites';
    commit();
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('retains a failed confirmation for retry and shows the result only after a successful DELETE', async () => {
  deleteFailure = true;
  render(<Harness />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: '删除网站' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.type(dialog.getByLabelText(/输入 删除回归站 确认/), site.name);
  await user.click(dialog.getByRole('button', { name: '删除网站' }));
  await dialog.findByText('删除失败，请重试。');
  expect(dialog.getByLabelText(/输入 删除回归站 确认/)).toHaveValue(site.name);
  expect(screen.queryByRole('dialog', { name: '网站删除成功' })).not.toBeInTheDocument();
  expect(nav.replace).not.toHaveBeenCalled();
  deleteFailure = false;
  await user.click(dialog.getByRole('button', { name: '删除网站' }));
  expect(await screen.findByRole('dialog', { name: '网站删除成功' })).toBeInTheDocument();
});

it.each(['identity', 'leave'] as const)(
  'clears a pending deletion result after %s changes before navigation completes',
  async change => {
    nav.defer = true;
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '删除网站' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.type(dialog.getByLabelText(/输入 删除回归站 确认/), site.name);
    await user.click(dialog.getByRole('button', { name: '删除网站' }));
    await waitFor(() => expect(nav.pending).toBe('/websites?scope=all'));
    await act(async () => {
      if (change === 'identity') actor = { ...actor, id: 'another-user' };
      else nav.pending = '/liekan/help';
      commit();
    });
    await act(async () => {
      nav.pending = '/websites';
      commit();
    });
    expect(screen.queryByRole('dialog', { name: '网站删除成功' })).not.toBeInTheDocument();
  },
);
it('checks retained team metadata independently of the newly mounted team list', async () => {
  mode = 'team';
  nav.path = '/teams/' + team.id;
  nav.query = { tab: 'settings' };
  render(<Harness />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: '删除团队' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.type(dialog.getByLabelText(/输入 DELETE 确认/), 'DELETE');
  await user.click(dialog.getByRole('button', { name: '删除团队' }));
  await waitFor(() => expect(nav.path).toBe('/teams'));
  await screen.findByText('删除后列表暂时不可用');
  expect(screen.queryByRole('link', { name: team.name })).not.toBeInTheDocument();
});
it.each(['links', 'pixels', 'boards'] as const)(
  'does not retain the previously loaded %s list after deletion and a failed return read',
  async kind => {
    mode = kind;
    nav.path = '/' + kind;
    nav.query = {};
    render(<Harness />);
    const user = userEvent.setup();
    await screen.findByText(record.name);
    const cachedList = client
      .getQueryCache()
      .getAll()
      .find(
        q =>
          Array.isArray((q.state.data as any)?.data) &&
          (q.state.data as any).data.some(row => row.id === record.id),
      );
    expect(cachedList).toBeDefined();
    const editorPage =
      kind === 'boards' ? 'board-view' : kind === 'links' ? 'link-editor' : 'pixel-editor';
    await act(async () => {
      nav.pending = `/liekan/${editorPage}?id=${record.id}&returnTo=${encodeURIComponent('/' + kind)}`;
      commit();
    });
    const title = kind === 'boards' ? '删除' : kind === 'links' ? '删除链接' : '删除追踪图片';
    await user.click(await screen.findByRole('button', { name: title }));
    const dialog = within(screen.getByRole('dialog'));
    await user.type(
      dialog.getByLabelText(kind === 'boards' ? /输入 DELETE 确认/ : /输入 删除回归资源 确认/),
      kind === 'boards' ? 'DELETE' : record.name,
    );
    await user.click(dialog.getByRole('button', { name: kind === 'boards' ? '删除看板' : title }));
    await waitFor(() => expect(nav.path).toBe('/' + kind));
    await screen.findByText('删除后列表暂时不可用');
    expect(document.querySelector('main')).not.toHaveTextContent(record.name);
    const oldRequests = reads.filter(
      read => read.afterDelete && read.path === '/api/' + kind + '/' + record.id,
    );
    expect(oldRequests).toEqual([]);
  },
);

it('seals a deleted page before a delayed identity check and navigation commit finish', async () => {
  nav.defer = true;
  holdVerify = true;
  render(<Harness />);
  const user = userEvent.setup();
  await screen.findByRole('button', { name: '删除网站' });
  await user.click(screen.getByRole('button', { name: '刷新' }));
  await waitFor(() => expect(releaseVerify).toBeDefined());
  await user.click(screen.getByRole('button', { name: '删除网站' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.type(dialog.getByLabelText(/输入 删除回归站 确认/), site.name);
  await user.click(dialog.getByRole('button', { name: '删除网站' }));
  await waitFor(() => expect(nav.pending).toBe('/websites?scope=all'));
  await act(async () => releaseVerify!());
  await waitFor(() => expect(screen.getByRole('button', { name: '刷新' })).toBeEnabled());
  expect(reads.filter(read => read.afterDelete && read.method === 'GET')).toEqual([]);
  expect(nav.replace).toHaveBeenCalledWith('/websites?scope=all');
  expect(screen.queryByRole('dialog', { name: '网站删除成功' })).not.toBeInTheDocument();
  await act(async () => commit());
  await screen.findByText('删除后列表暂时不可用');
  expect(await screen.findByRole('dialog', { name: '网站删除成功' })).toBeInTheDocument();
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
});

it('explains an already deleted website and offers the website list when its API returns null', async () => {
  deleted = true;
  listFailure = false;
  render(<Harness />);
  expect(await screen.findByText('此网站不存在或已删除。')).toBeInTheDocument();
  expect(
    within(document.querySelector('main')).getByRole('link', { name: '返回网站列表' }),
  ).toHaveAttribute('href', '/websites?scope=all');
  expect(screen.getByRole('button', { name: /网站不可用/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '删除网站' })).not.toBeInTheDocument();
});

it.each(['url-alias', 'metadata-alias'])(
  'completes deletion when the same website resolves a %s during the request',
  async kind => {
    holdDelete = true;
    if (kind === 'url-alias') nav.path = `/websites/${site.id}/settings`;
    else holdSites = true;
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '删除网站' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.type(dialog.getByLabelText(/输入 删除回归站 确认/), site.name);
    await user.click(dialog.getByRole('button', { name: '删除网站' }));
    await waitFor(() => expect(releaseDelete).toBeDefined());
    if (kind === 'url-alias') {
      await act(async () => {
        nav.pending =
          '/websites/101/settings?section=danger&returnTo=' +
          encodeURIComponent('/websites?scope=all');
        commit();
      });
    } else {
      await waitFor(() => expect(releaseSites).toBeDefined());
      await act(async () => releaseSites!());
      await waitFor(() =>
        expect(reads.some(read => read.path === '/api/websites/' + site.id)).toBe(true),
      );
      holdSites = false;
    }
    await act(async () => releaseDelete!());
    await waitFor(() => expect(nav.path).toBe('/websites'));
    expect(await screen.findByRole('dialog', { name: '网站删除成功' })).toBeInTheDocument();
    expect(
      reads.filter(read => read.afterDelete && read.path.includes('/websites/' + site.id)),
    ).toEqual([]);
  },
);
