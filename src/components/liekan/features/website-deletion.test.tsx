vi.mock('@/lib/liekan/upstream/catalog-client', () => ({ clientCatalogVersion: vi.fn(async () => '96074773-f17b-46e9-9af5-b09bca5e4281') }));
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ManualRefreshProvider, useManualRefresh } from '@/lib/liekan/contracts/manual-refresh';
import { featureApi } from '@/lib/liekan/upstream/features-client';
import { ManualRefreshControl } from '../ManualRefreshControl';
import { CorePages } from './CorePages';
import { FeatureProvider, useData } from './context';

const location = vi.hoisted(() => ({ path: '/websites/101/settings' }));
vi.mock('next/navigation', () => ({
  usePathname: () => location.path,
  useSearchParams: () => new URLSearchParams('section=danger'),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ children, prefetch: _prefetch, ...props }: any) => <a {...props}>{children}</a>,
}));
vi.mock('./Chart', () => ({ Chart: () => null }));

const site = {
  id: 'site',
  siteNumber: 101,
  name: '研究站',
  domain: 'example.invalid',
  userId: 'owner',
};
let deleted = false;
let failure = false;
let remaining: (typeof site)[];
let client: QueryClient;
let requests: { method: string; path: string; afterDelete: boolean }[];
beforeEach(() => {
  location.path = '/websites/101/settings';
  deleted = failure = false;
  remaining = [];
  requests = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL, init: RequestInit = {}) => {
      const path = new URL(String(input)).pathname;
      const method = init.method || 'GET';
      requests.push({ method, path, afterDelete: deleted });
      if (method === 'DELETE') {
        if (failure)
          return Response.json({ error: { message: '删除失败，请重试。' } }, { status: 500 });
        deleted = true;
        return Response.json({ ok: true });
      }
      if (method === 'POST') return Response.json({ ok: true });
      if (path === '/api/websites')
        return Response.json({ data: deleted ? remaining : [site, ...remaining] });
      if (path === '/api/websites/site') return Response.json(deleted ? null : site);
      if (path === '/api/liekan/websites/site/installation')
        return deleted
          ? Response.json({ error: { message: 'Forbidden' } }, { status: 403 })
          : Response.json({ browser: { pageviews: 0, firstAt: null, lastAt: null } });
      if (path.endsWith('/stats'))
        return deleted
          ? Response.json({ error: { message: 'Forbidden' } }, { status: 403 })
          : Response.json({ pageviews: { value: 0 } });
      if (path.endsWith('/daterange')) return Response.json({ startDate: null, endDate: null });
      return Response.json({});
    }),
  );
});
afterEach(() => {
  client.clear();
  vi.unstubAllGlobals();
});

function WebsiteList() {
  const query = useData('websites', signal => featureApi.get('/websites', {}, signal));
  return <div>网站列表：{query.data?.data?.map((item: any) => item.name).join(',')}</div>;
}
function App() {
  const [page, setPage] = useState('website-settings');
  const [toast, notify] = useState('');
  const reading = useManualRefresh();
  const value = {
    user: { id: 'owner', role: 'user' },
    route: { page, websiteId: '101' },
    api: featureApi,
    sites: [site],
    siteId: page === 'website-settings' ? site.id : '',
    site,
    teams: [{ id: 'team', name: '研究团队', role: 'team-owner' }],
    query: { section: 'danger' },
    filters: {},
    range: { startAt: 0, endAt: 1000, timezone: 'UTC', unit: 'day' },
    href: () => '/websites',
    navigate: (next: string) => {
      location.path = '/websites';
      setPage(next);
    },
    notify,
    refresh: () => reading.refresh(reading.page.token),
  } as any;
  return (
    <FeatureProvider value={value}>
      <ManualRefreshControl />
      {page === 'website-settings' ? <CorePages page="website-settings" /> : <WebsiteList />}
      {toast && <div role="status">{toast}</div>}
    </FeatureProvider>
  );
}
async function open(title: string) {
  render(
    <QueryClientProvider client={client}>
      <ManualRefreshProvider>
        <App />
      </ManualRefreshProvider>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: title }));
  return { user, dialog: within(screen.getByRole('dialog')) };
}

it.each(['last', 'with-other-sites'])(
  'returns to the updated list after deleting a %s website',
  async mode => {
    if (mode === 'with-other-sites') remaining = [{ ...site, id: 'other', name: '保留的网站' }];
    const { user, dialog } = await open('删除网站');
    await user.type(dialog.getByLabelText(/输入 研究站 确认/), site.name);
    await user.click(dialog.getByRole('button', { name: '删除网站' }));
    const list = await screen.findByText(/^网站列表：/);
    await waitFor(() =>
      expect(requests.some(item => item.path === '/api/websites' && item.afterDelete)).toBe(true),
    );
    expect(list).not.toHaveTextContent(site.name);
    if (remaining.length) await waitFor(() => expect(list).toHaveTextContent('保留的网站'));
    expect(screen.getByRole('status')).toHaveTextContent('「研究站」已删除');
    expect(requests.filter(item => item.method === 'DELETE')).toHaveLength(1);
    expect(
      requests.filter(item => item.afterDelete && item.path.startsWith('/api/websites/site')),
    ).toEqual([]);
    expect(
      requests.filter(
        item => item.afterDelete && item.path === '/api/liekan/websites/site/installation',
      ),
    ).toEqual([]);
    expect(requests.some(item => item.path === '/api/websites' && item.afterDelete)).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  },
);

it('keeps the confirmation and retry available when deletion fails', async () => {
  failure = true;
  const { user, dialog } = await open('删除网站');
  await user.type(dialog.getByLabelText(/输入 研究站 确认/), site.name);
  await user.click(dialog.getByRole('button', { name: '删除网站' }));
  expect(await dialog.findByText('删除失败，请重试。')).toBeInTheDocument();
  expect(dialog.getByLabelText(/输入 研究站 确认/)).toHaveValue(site.name);
  expect(dialog.getByRole('button', { name: '删除网站' })).toBeEnabled();
  expect(deleted).toBe(false);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  failure = false;
  await user.click(dialog.getByRole('button', { name: '删除网站' }));
  await waitFor(() => expect(screen.getByText('网站列表：')).toBeInTheDocument());
  expect(screen.getByRole('status')).toHaveTextContent('「研究站」已删除');
});

it('does not delete a website when its confirmation name does not match', async () => {
  const { user, dialog } = await open('删除网站');
  await user.type(dialog.getByLabelText(/输入 研究站 确认/), '其他网站');
  await user.click(dialog.getByRole('button', { name: '删除网站' }));
  expect(await dialog.findByText('确认内容不匹配。')).toBeInTheDocument();
  expect(requests.filter(item => item.method === 'DELETE')).toEqual([]);
  expect(screen.queryByText(/^网站列表：/)).not.toBeInTheDocument();
});

it('refreshes the retained website once after transferring it', async () => {
  const { user, dialog } = await open('转移网站');
  const before = requests.filter(item => item.path === '/api/websites/site').length;
  await user.selectOptions(dialog.getByRole('combobox'), 'team');
  await user.click(dialog.getByRole('button', { name: '转移网站' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(requests.filter(item => item.path === '/api/websites/site')).toHaveLength(before + 1);
  expect(screen.getByRole('status')).toHaveTextContent('「研究站」已转移');
});

it('refreshes the retained website once after clearing its data', async () => {
  const { user, dialog } = await open('清空访问数据');
  const before = requests.filter(item => item.path === '/api/websites/site').length;
  await user.type(dialog.getByLabelText(/输入 RESET 确认/), 'RESET');
  await user.click(dialog.getByRole('button', { name: '清空访问数据' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(requests.filter(item => item.path === '/api/websites/site')).toHaveLength(before + 1);
  expect(screen.getByRole('status')).toHaveTextContent('「研究站」的访问数据已清空');
});
