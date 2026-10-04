import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeatureApp } from './FeatureApp';

const mocks = vi.hoisted(() => ({
  navigation: {} as any,
  push: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  sites: vi.fn(),
  all: vi.fn(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, prefetch: _prefetch, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/liekan/upstream/client', () => ({
  useNavigation: () => mocks.navigation,
  useFeatureDateRange: () => ({
    dateRange: {
      value: 'range:1000000000000:1000086400000:day',
      startDate: new Date(1000000000000),
      endDate: new Date(1000086400000),
      unit: 'day',
    },
  }),
}));
vi.mock('@/lib/liekan/upstream/features-client', () => ({
  featureApi: { get: mocks.get, post: mocks.post, del: vi.fn() },
  getFeatureSites: mocks.sites,
  getAllFeatureRows: mocks.all,
  getFeaturePreferences: () => ({ timezone: 'Asia/Shanghai' }),
  refreshFeatureIdentity: vi.fn(),
  clearFeatureLogin: vi.fn(),
  featureRequest: vi.fn(),
}));
vi.mock('./Chart', () => ({ Chart: () => <div>统计图表</div> }));
vi.mock('./CorePages', () => ({ CorePages: () => null }));
vi.mock('./AnalyticsPages', () => ({
  analysisPages: new Set(['sessions', 'session-detail', 'events', 'event-detail']),
  AnalyticsPages: ({ page }: any) => <p>当前分析页面：{page}</p>,
}));
vi.mock('./ExtendedPages', () => ({ extendedPages: new Set(), ExtendedPages: () => null }));
vi.mock('./LinksPixelsPages', () => ({
  linksPixelsPages: new Set(['links', 'pixels', 'link-editor', 'pixel-editor']),
  LinksPixelsPages: ({ page }: any) => <p>资源页面：{page}</p>,
}));

const user = { id: 'user-1', username: 'owner', role: 'user' };
const personal = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '个人网站',
  domain: 'personal.example',
  userId: user.id,
};
const teamId = '33333333-3333-4333-8333-333333333333';
const teamSite = {
  id: '22222222-2222-4222-8222-222222222222',
  name: '团队网站',
  domain: 'team.example',
  teamId,
};
function mount(route: any, identity: any = user) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FeatureApp user={identity} route={route} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.navigation = {
    pathname: '/dashboard/edit',
    query: {},
    router: { push: mocks.push, replace: vi.fn() },
    updateParams: vi.fn(),
  };
  mocks.sites.mockImplementation(async (_signal: AbortSignal, scope?: string) =>
    scope ? [teamSite] : [personal, teamSite],
  );
  mocks.all.mockResolvedValue([{ id: teamId, name: '团队' }]);
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/dashboard')
      return {
        name: '工作台',
        userId: user.id,
        parameters: { rows: [], liekan: { siteIds: [personal.id, teamSite.id] } },
      };
    if (path === `/websites/${personal.id}`) return personal;
    if (path === `/websites/${teamSite.id}`) return teamSite;
    throw new Error(`Unexpected request ${path}`);
  });
  mocks.post.mockResolvedValue({});
});
describe('feature navigation scope', () => {
  it.each(['link-editor', 'pixel-editor', 'board-editor', 'onboarding'])(
    'waits for team destinations before mounting the %s creation form',
    async page => {
      let complete: (teams: any[]) => void;
      mocks.all.mockImplementation(async (path: string) =>
        path === '/me/teams'
          ? new Promise(resolve => {
              complete = resolve;
            })
          : [],
      );
      const view = mount({ page, teamId });
      expect(view.container.querySelector('main form')).toBeNull();
      expect(screen.queryByText(`资源页面：${page}`)).not.toBeInTheDocument();
      expect(screen.getByText('正在读取当前范围的数据。')).toBeInTheDocument();
      await waitFor(() => expect(complete).toBeTypeOf('function'));
      complete([{ id: teamId, name: '团队', role: 'team-member' }]);
      if (page === 'link-editor' || page === 'pixel-editor')
        expect(await screen.findByText(`资源页面：${page}`)).toBeInTheDocument();
      else if (page === 'board-editor')
        expect(await screen.findByLabelText('所属空间')).toHaveValue(teamId);
      else
        await waitFor(() =>
          expect(screen.queryByText('正在读取当前范围的数据。')).not.toBeInTheDocument(),
        );
    },
  );
  it('shows a failed team lookup with retry instead of a creation form', async () => {
    mocks.all.mockRejectedValue(new Error('空间服务暂不可用'));
    mount({ page: 'link-editor', teamId });
    expect(await screen.findByText('空间服务暂不可用')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试读取' })).toBeInTheDocument();
    expect(screen.queryByText('资源页面：link-editor')).not.toBeInTheDocument();
  });
  it('resolves an accessible team outside the membership list before mounting creation', async () => {
    mocks.all.mockResolvedValue([]);
    mocks.get.mockImplementation(async path =>
      path === `/teams/${teamId}`
        ? {
            id: teamId,
            name: '可管理团队',
            members: [{ userId: 'another-user', role: 'team-owner' }],
          }
        : { data: [] },
    );
    mount({ page: 'board-editor', teamId }, { ...user, role: 'admin', isAdmin: true });
    expect(await screen.findByRole('option', { name: '可管理团队' })).toBeInTheDocument();
    expect(screen.getByLabelText('所属空间')).toHaveValue(teamId);
    expect(mocks.sites).toHaveBeenCalledWith(expect.any(AbortSignal), teamId, 'all');
  });
  it('keeps an unlisted team visible as pending scope until its metadata arrives', async () => {
    mocks.all.mockResolvedValue([]);
    let complete: (team: any) => void;
    mocks.get.mockImplementation(
      () =>
        new Promise(resolve => {
          complete = resolve;
        }),
    );
    mount({ page: 'sharing', id: 'board-1', teamId }, { ...user, role: 'admin', isAdmin: true });
    const scope = screen.getByRole('combobox', { name: '所属空间' });
    expect(scope).toHaveValue(teamId);
    await waitFor(() => expect(complete).toBeTypeOf('function'));
    complete({ id: teamId, name: '当前团队', members: [] });
    await screen.findByRole('option', { name: '当前团队' });
    expect(scope).toHaveValue(teamId);
  });
  it('waits for website sources before mounting an existing board editor', async () => {
    let complete: (sites: any[]) => void;
    mocks.sites.mockImplementation(
      () =>
        new Promise(resolve => {
          complete = resolve;
        }),
    );
    mocks.get.mockResolvedValue({
      id: 'board-1',
      name: '已保存看板',
      type: 'website',
      userId: user.id,
      parameters: { websiteId: personal.id },
    });
    const view = mount({ page: 'board-editor', id: 'board-1' });
    await waitFor(() => expect(complete).toBeTypeOf('function'));
    await waitFor(() => expect(view.container.querySelector('main form')).toBeNull());
    complete([personal]);
    expect(await screen.findByLabelText('关联资源')).toHaveValue(personal.id);
  });
  it('keeps an inaccessible team destination in its denied state', async () => {
    mocks.all.mockResolvedValue([]);
    mocks.get.mockRejectedValue(Object.assign(new Error('此团队没有访问权限'), { status: 403 }));
    mount({ page: 'link-editor', teamId });
    expect(await screen.findByText('此团队没有访问权限')).toBeInTheDocument();
    expect(screen.queryByText('资源页面：link-editor')).not.toBeInTheDocument();
  });
  it.each([
    { page: 'session-detail', id: 'record-1', source: 'sessions' },
    { page: 'filters', from: 'events', source: 'events' },
    { page: 'exports', from: 'geo-ai-pages', source: 'geo-ai-pages' },
  ])('keeps the canonical source in the actual $page analysis tool links', async route => {
    const view = mount({ ...route, websiteId: personal.id });
    await screen.findByRole('button', { name: '切换网站，当前个人网站' });
    for (const link of view.container.querySelectorAll<HTMLAnchorElement>('.analysis-tools a')) {
      const url = new URL(link.href, 'http://liekan.local');
      expect(url.searchParams.get('from')).toBe(route.source);
      expect(url.searchParams.get('websiteId')).toBe(personal.id);
      expect(url.searchParams.has('id')).toBe(false);
    }
    expect(view.container.querySelectorAll('.analysis-tools a')).toHaveLength(3);
  });
  it('clears automatic and live modes when the user chooses explicit history dates', async () => {
    mocks.navigation.query = { dateMode: 'default', live: '1' };
    mount({ page: 'events', websiteId: personal.id });
    await screen.findByRole('button', { name: '切换网站，当前个人网站' });
    await userEvent.click(screen.getByRole('button', { name: /2001-09-/ }));
    await userEvent.click(screen.getByRole('button', { name: '应用日期范围' }));
    expect(mocks.navigation.updateParams).toHaveBeenCalledWith(
      expect.objectContaining({ dateMode: undefined, live: undefined }),
    );
  });
  it.each([
    { page: 'admin-users' },
    { page: 'admin-user', id: 'user-2' },
    { page: 'admin-websites' },
    { page: 'admin-teams' },
    { page: 'admin-security' },
    { page: 'website-settings', websiteId: personal.id, context: 'admin' },
    { page: 'team-detail', id: teamId, context: 'admin' },
  ])(
    'keeps a non-administrator bookmarked admin URL in an explicit denied state: $page',
    async route => {
      const view = mount(route);
      expect(await screen.findByText('当前账户没有访问此资源的权限。')).toBeInTheDocument();
      expect(view.container.querySelectorAll('[data-navigation-group]')).toHaveLength(9);
      expect(screen.queryByRole('link', { name: '系统管理' })).not.toBeInTheDocument();
      expect(mocks.get).not.toHaveBeenCalled();
    },
  );
  it('resolves a website-backed board name without implicitly selecting a website', async () => {
    mocks.get.mockResolvedValue({
      data: [
        {
          id: 'board-1',
          name: '团队来源看板',
          type: 'website',
          userId: user.id,
          parameters: { websiteId: teamSite.id },
          updatedAt: '2026-10-03T00:00:00Z',
        },
      ],
      count: 1,
      pageSize: 20,
    });
    const view = mount({ page: 'boards' });
    expect(await screen.findByText('团队来源看板')).toBeInTheDocument();
    expect(await screen.findByText(teamSite.name)).toBeInTheDocument();
    expect(mocks.sites).toHaveBeenCalledWith(expect.any(AbortSignal), undefined, 'all');
    expect(view.container.querySelector('.site-switch')).toBeNull();
  });
  it('shows nine approved global entries and no implicit website on an account page', async () => {
    const view = mount({ page: 'account', websiteId: personal.id, teamId });
    const sidebar = view.container.querySelector('#liekan-navigation');
    expect(sidebar.querySelectorAll('[data-navigation-group]')).toHaveLength(9);
    expect(sidebar.querySelector('.site-switch')).toBeNull();
    expect(screen.queryByRole('link', { name: '系统管理' })).not.toBeInTheDocument();
    expect(mocks.sites).not.toHaveBeenCalled();
  });
  it('requires explicit website selection when an analysis URL has no website ID', async () => {
    mount({ page: 'sessions' });
    expect(await screen.findByText('请选择需要查看的网站。')).toBeInTheDocument();
    expect(screen.queryByText('当前分析页面：sessions')).not.toBeInTheDocument();
    expect(mocks.get).not.toHaveBeenCalledWith(
      `/websites/${personal.id}`,
      expect.anything(),
      expect.anything(),
    );
  });
  it('loads and preserves all user dashboard pins when reached from a team', async () => {
    mount({ page: 'dashboard-edit', teamId });
    expect(await screen.findByRole('checkbox', { name: /个人网站/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /团队网站/ })).toBeChecked();
    expect(mocks.sites).toHaveBeenCalledWith(expect.any(AbortSignal), undefined, 'all');
    await userEvent.click(screen.getByRole('button', { name: '保存工作台' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/dashboard',
        expect.objectContaining({
          parameters: expect.objectContaining({
            liekan: expect.objectContaining({
              siteIds: [personal.id, teamSite.id],
            }),
          }),
        }),
      ),
    );
  });
  it('switches a saved-audience detail to the new website list with only time selection', async () => {
    mocks.navigation.pathname = `/websites/${personal.id}/sessions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
    mocks.navigation.query = {
      date: 'range:1000000000000:1000086400000:day',
      unit: 'day',
      offset: '1',
      compare: 'prev',
      segment: 'old-segment',
      cohort: 'old-cohort',
      path: 'eq./old',
      event: 'eq.old-event',
      retentionDate: '2026-09-01',
      retentionDay: '1',
      attributionStep: 'old-step',
      attributionModel: 'first-click',
      attributionType: 'event',
      attributionSource: 'old-source',
      id: 'old-record',
      websiteId: personal.id,
    };
    const view = mount({ page: 'session-detail', websiteId: personal.id, id: 'old-record' });
    await waitFor(() => expect(mocks.sites).toHaveBeenCalled());
    await userEvent.click(view.container.querySelector('.site-switch') as HTMLElement);
    await userEvent.selectOptions(await screen.findByLabelText('网站'), teamSite.id);
    await userEvent.click(screen.getByRole('button', { name: '切换网站' }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalled());
    const url = new URL(mocks.push.mock.calls[0][0], 'http://localhost');
    expect(url.pathname).toBe(`/websites/${teamSite.id}/sessions`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      date: 'range:1000000000000:1000086400000:day',
      unit: 'day',
      offset: '1',
      compare: 'prev',
    });
  });
});
