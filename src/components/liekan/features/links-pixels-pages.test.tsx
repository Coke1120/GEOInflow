import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { linkPayload, resourceUrl } from '@/lib/liekan/contracts/workspace';
import { FeatureProvider } from './context';
import { freshAggregateFixture } from '@/test/liekan-freshness';
import { LinksPixelsPages } from './LinksPixelsPages';
import { LiekanLocaleContext } from '@/lib/liekan/i18n/client';

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
    api: {
      get: async (path: string, params?: any, signal?: AbortSignal) => {
        const value = await mocks.get(path, params, signal);
        return /\/(stats|pageviews|metrics|charts)$/.test(path)
          ? freshAggregateFixture(value, signal)
          : value;
      },
      post: mocks.post,
      del: mocks.del,
    },
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
function mount(page: string, locale: 'zh-CN' | 'en-US' = 'zh-CN') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LiekanLocaleContext.Provider value={locale}>
        <FeatureProvider value={context}>
          <LinksPixelsPages page={page} />
        </FeatureProvider>
      </LiekanLocaleContext.Provider>
    </QueryClientProvider>,
  );
}

describe('links and pixels use native resource and tracking contracts', () => {
  it('creates a link in the active team with its real target and native slug', async () => {
    mount('link-editor');
    await userEvent.type(await screen.findByLabelText(/链接名称/), '新品公告');
    expect(screen.getByLabelText(/所属空间/)).toHaveValue('team-1');
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
    expect(mocks.navigate).toHaveBeenCalledWith('link-detail', {
      id: 'saved-link',
      teamId: 'team-1',
    });
    expect(mocks.notify).toHaveBeenCalledWith('链接已保存');
  });
  it.each(['link', 'pixel'] as const)(
    'creates a %s in the chosen space and excludes read-only team destinations',
    async kind => {
      context.route = { page: `${kind}-editor` };
      context.teams.push({
        id: 'readonly-team',
        name: '只读团队',
        members: [{ userId: 'user-1', role: 'team-view-only' }],
      });
      mount(`${kind}-editor`);
      const owner = await screen.findByRole('combobox', { name: /所属空间/ });
      expect(owner).toHaveValue('');
      expect(within(owner).getByRole('option', { name: '增长团队' })).toBeInTheDocument();
      expect(within(owner).queryByRole('option', { name: '只读团队' })).not.toBeInTheDocument();
      await userEvent.selectOptions(owner, 'team-1');
      await userEvent.type(
        screen.getByLabelText(kind === 'link' ? /链接名称/ : /图片名称/),
        '增长资源',
      );
      if (kind === 'link')
        await userEvent.type(screen.getByLabelText(/目标 URL/), 'https://example.com/launch');
      await userEvent.click(
        screen.getByRole('button', { name: kind === 'link' ? '保存链接' : '保存图片' }),
      );
      await waitFor(() =>
        expect(mocks.post).toHaveBeenCalledWith(
          `/${kind}s`,
          expect.objectContaining({ teamId: 'team-1' }),
        ),
      );
      expect(mocks.navigate).toHaveBeenCalledWith(`${kind}-detail`, {
        id: 'saved-link',
        teamId: 'team-1',
      });
    },
  );
  it.each(['link', 'pixel'] as const)(
    'can change a new %s from team to personal space',
    async kind => {
      mount(`${kind}-editor`);
      const owner = await screen.findByRole('combobox', { name: /所属空间/ });
      expect(owner).toHaveValue('team-1');
      await userEvent.selectOptions(owner, '');
      await userEvent.type(
        screen.getByLabelText(kind === 'link' ? /链接名称/ : /图片名称/),
        '个人资源',
      );
      if (kind === 'link')
        await userEvent.type(screen.getByLabelText(/目标 URL/), 'https://example.com/personal');
      await userEvent.click(
        screen.getByRole('button', { name: kind === 'link' ? '保存链接' : '保存图片' }),
      );
      await waitFor(() => expect(mocks.post).toHaveBeenCalled());
      expect(mocks.post.mock.calls[0][1]).not.toHaveProperty('teamId');
      expect(mocks.navigate).toHaveBeenCalledWith(`${kind}-detail`, {
        id: 'saved-link',
        teamId: '',
      });
    },
  );
  it('rejects a forged creation space before sending a resource request', async () => {
    mount('link-editor');
    const owner = await screen.findByRole('combobox', { name: /所属空间/ });
    const option = document.createElement('option');
    option.value = 'foreign-team';
    owner.append(option);
    fireEvent.change(owner, { target: { value: 'foreign-team' } });
    fireEvent.submit(screen.getByRole('button', { name: '保存链接' }).closest('form'));
    expect(await screen.findByText('请选择有创建权限的所属空间')).toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it('lets a personal resource owner choose an allowed destination from a read-only team entry', async () => {
    context.teams[0].members[0].role = 'team-view-only';
    mount('pixel-editor');
    const owner = await screen.findByRole('combobox', { name: /所属空间/ });
    expect(owner).not.toBeDisabled();
    await userEvent.selectOptions(owner, '');
    await userEvent.type(screen.getByLabelText(/图片名称/), '个人像素');
    await userEvent.click(screen.getByRole('button', { name: '保存图片' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalled());
    expect(mocks.post.mock.calls[0][1]).not.toHaveProperty('teamId');
  });
  it('keeps a personal list scoped to the route despite a team website in context', async () => {
    context.route = { page: 'links' };
    context.site = { id: 'site-1', teamId: 'team-1' };
    const original = mocks.get.getMockImplementation();
    mocks.get.mockImplementation(async (path: string, params: any, signal: any) =>
      path === '/links'
        ? { data: [{ ...link, teamId: null }], count: 1 }
        : original(path, params, signal),
    );
    mount('links');
    await screen.findByText('公告链接');
    expect(screen.getByText(/所属空间：个人空间/)).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith('/links', expect.any(Object), expect.any(AbortSignal));
    expect(mocks.get.mock.calls.some(([path]) => path.startsWith('/teams/'))).toBe(false);
  });
  it('shows the saved resource space and retains its identity when the URL names another team', async () => {
    context.route = { page: 'link-editor', id: 'link-1', teamId: 'foreign-team' };
    context.query = { teamId: 'foreign-team', websiteId: 'foreign-website' };
    mocks.post.mockResolvedValue({ id: 'link-1' });
    mount('link-editor');
    await screen.findByDisplayValue('公告链接');
    expect(screen.getByLabelText(/所属空间/)).toHaveValue('增长团队');
    await userEvent.click(screen.getByRole('button', { name: '保存链接' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/links/link-1', {
        name: '公告链接',
        url: 'https://example.com/notes',
        slug: 'announcement',
      }),
    );
    expect(mocks.get.mock.calls.some(([path]) => path.includes('foreign-team'))).toBe(false);
  });
  it('names the deleted link and retains the typed-name safeguard', async () => {
    context.route.id = 'link-1';
    mount('link-editor');
    await screen.findByDisplayValue('公告链接');
    await userEvent.click(screen.getByRole('button', { name: '删除链接' }));
    const drawer = within(screen.getByRole('dialog'));
    expect(drawer.getByText(/将删除链接“公告链接”及其统计数据/)).toBeInTheDocument();
    expect(drawer.getByText(/短链地址和分享链接将失效/)).toBeInTheDocument();
    fireEvent.submit((drawer.getByRole('button', { name: '删除链接' }) as HTMLButtonElement).form);
    expect(await drawer.findByText('请输入链接名称确认删除')).toBeInTheDocument();
    expect(mocks.del).not.toHaveBeenCalled();
    await userEvent.type(drawer.getByLabelText(/输入 公告链接 确认/), '公告链接');
    await userEvent.click(drawer.getByRole('button', { name: '删除链接' }));
    await waitFor(() => expect(mocks.del).toHaveBeenCalledWith('/links/link-1'));
    expect(mocks.notify).toHaveBeenCalledWith('链接已删除');
  });
  it('closes deletion confirmation and keeps the old editor locked while navigation is delayed', async () => {
    context.route = { page: 'link-editor', id: 'link-1', teamId: 'team-1' };
    mount('link-editor');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '删除链接' }));
    const drawer = within(screen.getByRole('dialog'));
    await user.type(drawer.getByLabelText(/输入 公告链接 确认/), link.name);
    await user.click(drawer.getByRole('button', { name: '删除链接' }));
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith('links', undefined, { replace: true }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除链接' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '删除链接' }));
    expect(mocks.del).toHaveBeenCalledTimes(1);
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
  it('localizes absent link statistics without changing the resource name or measuring a zero', async () => {
    mocks.get.mockImplementation(async (path: string) =>
      path === '/teams/team-1/links'
        ? { data: [link], count: 1 }
        : path === '/links/charts'
          ? { data: {} }
          : {},
    );
    mount('links', 'en-US');
    await screen.findByText('公告链接');
    expect(await screen.findByText('Not provided')).toBeVisible();
    expect(screen.queryByText('未提供')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
  it('retains an actual statistics failure instead of presenting a measured zero', async () => {
    const original = mocks.get.getMockImplementation();
    mocks.get.mockImplementation(async (path: string, params: any, signal: any) => {
      if (path === '/links/charts') throw new Error('统计服务暂不可用');
      return original(path, params, signal);
    });
    mount('links');
    expect(await screen.findByText(/统计读取失败：统计服务暂不可用/)).toBeInTheDocument();
    expect(screen.getByText('读取失败')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
  it('pixel creation carries its native slug and uses the configured tracking host', async () => {
    mount('pixel-editor');
    await userEvent.type(await screen.findByLabelText(/图片名称/), '邮件简报');
    const url = (screen.getByLabelText(/图片地址/) as HTMLInputElement).value;
    expect(url).toMatch(/^https:\/\/pixel\.example\/[a-f0-9]{12}$/);
    await userEvent.click(screen.getByRole('button', { name: '保存图片' }));
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
      await screen.findByRole('img', { name: kind === 'link' ? '链接访问趋势' : '图片请求趋势' });
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

describe('resource addresses wait for host configuration', () => {
  it.each(['link', 'pixel'] as const)(
    'keeps %s operations unavailable until the configured address arrives',
    async kind => {
      context.route = { page: `${kind}-detail`, id: `${kind}-1`, teamId: 'team-1' };
      const original = mocks.get.getMockImplementation()!;
      let finish!: (value: any) => void;
      const configuration = new Promise(resolve => {
        finish = resolve;
      });
      mocks.get.mockImplementation((path: string, params: any, signal: any) => {
        if (path === '/config') return configuration;
        if (path === '/pixels/pixel-1') return Promise.resolve({ ...link, id: 'pixel-1' });
        return original(path, params, signal);
      });
      const user = userEvent.setup();
      const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
      mount(`${kind}-detail`);
      const button = await screen.findByRole('button', {
        name: kind === 'pixel' ? '复制图片代码' : '查看链接二维码',
      });
      expect(button).toBeDisabled();
      if (kind === 'pixel') {
        expect(screen.getByRole('button', { name: '复制图片地址' })).toBeDisabled();
        expect(
          screen.getByRole('heading', { name: '安装代码' }).closest('section')?.textContent,
        ).not.toContain(window.location.origin);
        await user.click(button);
        expect(write).not.toHaveBeenCalled();
      }
      await act(async () =>
        finish({ linksUrl: 'https://go.example', pixelsUrl: 'https://pixel.example' }),
      );
      await waitFor(() => expect(button).toBeEnabled());
      if (kind === 'pixel') {
        await user.click(button);
        expect(write).toHaveBeenCalledWith(
          '<img src="https://pixel.example/announcement" width="1" height="1" alt="" />',
        );
        await user.click(screen.getByRole('button', { name: '复制图片地址' }));
        expect(write).toHaveBeenLastCalledWith('https://pixel.example/announcement');
      } else {
        expect(screen.getByText('https://go.example/announcement')).toBeInTheDocument();
      }
    },
  );
  it('uses the instance address after an empty configuration is successfully read', async () => {
    context.route = { page: 'pixel-detail', id: 'pixel-1', teamId: 'team-1' };
    const original = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation((path: string, params: any, signal: any) => {
      if (path === '/config') return Promise.resolve({});
      if (path === '/pixels/pixel-1') return Promise.resolve({ ...link, id: 'pixel-1' });
      return original(path, params, signal);
    });
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    mount('pixel-detail');
    const copy = await screen.findByRole('button', { name: '复制图片地址' });
    await waitFor(() => expect(copy).toBeEnabled());
    await user.click(copy);
    expect(write).toHaveBeenCalledWith(`${window.location.origin}/p/announcement`);
  });
});
