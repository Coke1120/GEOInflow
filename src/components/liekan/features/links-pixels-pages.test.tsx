import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { linkPayload, resourceUrl } from '@/lib/liekan/contracts/workspace';
import { FeatureProvider } from './context';
import { LinksPixelsPages } from './LinksPixelsPages';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  all: vi.fn(),
  navigate: vi.fn(),
  notify: vi.fn(),
  preferences: vi.fn(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('./Chart', () => ({
  Chart: ({ title, series }: any) => (
    <div role="img" aria-label={title}>
      {JSON.stringify(series)}
    </div>
  ),
}));
vi.mock('@/lib/liekan/upstream/features-client', () => ({
  getAllFeatureRows: mocks.all,
  getFeaturePreferences: mocks.preferences,
  featureRequest: vi.fn(),
}));
let context: any;
const link = {
  id: 'link-1',
  name: '公告链接',
  slug: 'announcement',
  url: 'https://example.com/notes',
  teamId: 'team-1',
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.preferences.mockReturnValue({ timezone: 'America/New_York' });
  context = {
    user: { id: 'user-1', username: 'member', role: 'user' },
    route: { page: 'link-editor', teamId: 'team-1' },
    siteId: 'site-1',
    site: { id: 'site-1' },
    sites: [],
    teams: [
      { id: 'team-1', name: '增长团队', members: [{ userId: 'user-1', role: 'team-member' }] },
    ],
    range: { startAt: 100, endAt: 200, unit: 'day', timezone: 'UTC' },
    filters: {},
    query: {},
    api: { get: mocks.get, post: mocks.post, del: mocks.del },
    href: (page: string, params: any = {}) => `/${page}/${params.id || ''}`,
    navigate: mocks.navigate,
    notify: mocks.notify,
    refresh: vi.fn(),
  };
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/config')
      return {
        linksUrl: 'https://go.example',
        pixelsUrl: 'https://pixel.example',
        cloudMode: false,
      };
    if (path === '/links/link-1') return link;
    if (path === '/teams/team-1/links') return { data: [link], count: 25, pageSize: 20 };
    if (path === '/links/charts') return { data: { 'link-1': { total: 0, values: [0] } } };
    if (path.endsWith('/stats')) return { pageviews: 0, visitors: 0, visits: 0 };
    if (path.endsWith('/pageviews'))
      return { pageviews: [{ x: '2026-10-01', y: 0 }], sessions: [{ x: '2026-10-01', y: 0 }] };
    if (path.endsWith('/metrics')) return [];
    return { data: [] };
  });
  mocks.post.mockResolvedValue({ id: 'saved-link' });
  mocks.del.mockResolvedValue({});
  mocks.all.mockResolvedValue([]);
});
function mount(page: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FeatureProvider value={context}>
        <LinksPixelsPages page={page} />
      </FeatureProvider>
    </QueryClientProvider>,
  );
}

describe('links and pixels use native resource and tracking contracts', () => {
  it('creates a link in the active team with its real target and native slug', async () => {
    mount('link-editor');
    await userEvent.type(await screen.findByLabelText(/链接名称/), '新品公告');
    await userEvent.type(screen.getByLabelText(/目标 URL/), 'https://example.com/launch');
    fireEvent.change(screen.getByLabelText(/短链标识/), { target: { value: 'launch_2026' } });
    expect(screen.getByLabelText(/预览地址/)).toHaveValue('https://go.example/launch_2026');
    await userEvent.click(screen.getByRole('button', { name: '保存链接' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/links', {
        name: '新品公告',
        url: 'https://example.com/launch',
        slug: 'launch_2026',
        teamId: 'team-1',
      }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith('link-detail', { id: 'saved-link' });
  });
  it('rejects non-web target schemes before issuing an update', async () => {
    mount('link-editor');
    await userEvent.type(await screen.findByLabelText(/链接名称/), '链接');
    fireEvent.change(screen.getByLabelText(/目标 URL/), {
      target: { value: 'javascript:alert(1)' },
    });
    fireEvent.submit(screen.getByRole('button', { name: '保存链接' }).closest('form'));
    expect(
      await screen.findByText('目标地址需要 http:// 或 https:// 开头，最多 500 个字符'),
    ).toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it('keeps edits restricted for team viewers', async () => {
    context.route.id = 'link-1';
    context.teams[0].members[0].role = 'team-view-only';
    mount('link-editor');
    expect(await screen.findByRole('button', { name: '保存链接' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '删除链接' })).toBeDisabled();
  });
  it('uses actual paging and passes the selected range into batch statistics, including measured zero', async () => {
    mount('links');
    await screen.findByText('公告链接');
    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith(
        '/links/charts',
        expect.objectContaining({ ids: 'link-1', startAt: 100, endAt: 200, timezone: 'UTC' }),
        expect.any(AbortSignal),
      ),
    );
    expect(await screen.findByText('0')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith(
        '/teams/team-1/links',
        expect.objectContaining({ page: 2, pageSize: 20 }),
        expect.any(AbortSignal),
      ),
    );
  });
  it('shows absent statistics as unavailable and never as a zero count', async () => {
    mocks.get.mockImplementation(async (path: string) =>
      path === '/teams/team-1/links'
        ? { data: [link], count: 1 }
        : path === '/links/charts'
          ? { data: {} }
          : {},
    );
    mount('links');
    await screen.findByText('公告链接');
    expect(await screen.findByText('未提供')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
  it('pixel creation carries its native slug and uses the configured tracking host', async () => {
    mount('pixel-editor');
    await userEvent.type(await screen.findByLabelText(/像素名称/), '邮件简报');
    const url = (screen.getByLabelText(/像素地址/) as HTMLInputElement).value;
    expect(url).toMatch(/^https:\/\/pixel\.example\/[a-f0-9]{12}$/);
    await userEvent.click(screen.getByRole('button', { name: '保存像素' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/pixels', {
        name: '邮件简报',
        slug: url.split('/').at(-1),
        teamId: 'team-1',
      }),
    );
  });
  it.each(['link', 'pixel'])(
    '%s detail excludes foreign website segments and property filters from native analytics',
    async kind => {
      const id = `${kind}-1`;
      context.route = { page: `${kind}-detail`, id, teamId: 'team-1' };
      context.filters = {
        segment: 'foreign-segment',
        cohort: 'foreign-cohort',
        spf: 'sensitive=eq.x',
        epf: 'plan=eq.y',
      };
      const original = mocks.get.getMockImplementation();
      mocks.get.mockImplementation(async (path: string, params: any, signal: any) => {
        if (path === `/pixels/${id}`) return { ...link, id, name: '邮件像素' };
        if (path === `/liekan/links/${id}/sources`)
          return { rows: [{ source: 'newsletter', country: 'CN', clicks: 2 }], count: 26 };
        if (path.endsWith('/daterange')) return { endDate: '2026-10-01T00:00:00.000Z' };
        return original(path, params, signal);
      });
      mount(`${kind}-detail`);
      await screen.findByRole('img', { name: kind === 'link' ? '链接访问趋势' : '像素请求趋势' });
      const calls = mocks.get.mock.calls.filter(
        call => call[0].startsWith(`/websites/${id}/`) && !call[0].endsWith('/daterange'),
      );
      expect(calls.length).toBeGreaterThan(0);
      for (const [, params] of calls) {
        expect(params).toMatchObject({
          startAt: 100,
          endAt: 200,
          eventType: kind === 'link' ? 3 : 4,
        });
        for (const key of ['segment', 'cohort', 'spf', 'epf'])
          expect(params).not.toHaveProperty(key);
      }
      if (kind === 'link') {
        expect(await screen.findByText('newsletter')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: '下一页' }));
        await waitFor(() =>
          expect(mocks.get).toHaveBeenCalledWith(
            `/liekan/links/${id}/sources`,
            { ...context.range, page: 2 },
            expect.any(AbortSignal),
          ),
        );
        const jointCalls = mocks.get.mock.calls.filter(
          call => call[0] === `/liekan/links/${id}/sources`,
        );
        expect(jointCalls.length).toBeGreaterThan(0);
        for (const [, params] of jointCalls)
          for (const key of ['segment', 'cohort', 'spf', 'epf'])
            expect(params).not.toHaveProperty(key);
      } else {
        const expected = new Date('2026-10-01T00:00:00.000Z').toLocaleString('zh-CN', {
          timeZone: 'America/New_York',
        });
        expect(await screen.findByText(expected)).toBeInTheDocument();
      }
    },
  );
  it('configured tracking origins and base paths remain SDK-compatible', () => {
    expect(resourceUrl('https://app.example', '/stats', 'link', 'reference_01')).toBe(
      'https://app.example/stats/q/reference_01',
    );
    expect(
      resourceUrl('https://app.example', '/stats', 'pixel', 'reference_01', 'https://px.example/'),
    ).toBe('https://px.example/reference_01');
    expect(() => linkPayload({ name: '邮件', slug: 'short' }, 'pixel')).toThrow('标识需要 8');
  });
});
