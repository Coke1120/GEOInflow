import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBoardEntityIds } from '@/lib/boards';
import {
  allowedShareSections,
  boardColumns,
  boardParameters,
  canManageMember,
  canManageResource,
  moveBoardColumn,
  nativeMetric,
  setBoardColumnWidth,
  shareParameters,
} from '@/lib/liekan/contracts/workspace';
import { FeatureProvider } from './context';
import { ResourceAnalytics, ShareFeatureView, WorkspacePages } from './WorkspacePages';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  request: vi.fn(),
  all: vi.fn(),
  navigate: vi.fn(),
  notify: vi.fn(),
  refresh: vi.fn(),
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
  Chart: ({ title, labels, series, type, horizontal }: any) => {
    const chart = (
      <div role="img" aria-label={title || '统计图表'}>
        {JSON.stringify({ labels, series, type, horizontal })}
      </div>
    );
    return title ? (
      <section className="panel">
        <h2>{title}</h2>
        {chart}
      </section>
    ) : (
      chart
    );
  },
}));
vi.mock('../ReportComponents', async importOriginal => ({
  ...(await importOriginal<typeof import('../ReportComponents')>()),
  ReferenceChart: ({ id }: any) => <div role="img" aria-label={`分享图表 ${id}`} />,
}));
vi.mock('@/lib/liekan/upstream/features-client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/liekan/upstream/features-client')>()),
  featureRequest: mocks.request,
  getAllFeatureRows: mocks.all,
  getFeaturePreferences: mocks.preferences,
}));

const owner = { id: 'user-1', username: 'owner', role: 'user' };
const team = {
  id: 'team-1',
  name: '增长团队',
  members: [
    { userId: 'user-1', role: 'team-owner' },
    { userId: 'user-2', role: 'team-manager' },
  ],
  _count: { websites: 2, members: 2 },
};
const site = { id: 'site-1', name: '产品网站', domain: 'example.com', userId: 'user-1' };
const nativeBoard = {
  id: 'board-1',
  name: '观察看板',
  type: 'website',
  userId: 'user-1',
  parameters: {
    websiteId: 'site-1',
    extension: { retain: true },
    rows: [
      {
        id: 'row-1',
        size: 360,
        extension: 'row',
        columns: [
          {
            id: 'column-1',
            size: 50,
            extension: 'one',
            component: { type: 'WebsiteChart', title: '访问趋势', props: { retain: 'one' } },
          },
          {
            id: 'column-2',
            size: 50,
            extension: 'two',
            component: { type: 'MetricsTable', title: '来源构成', props: { type: 'referrer' } },
          },
        ],
      },
    ],
  },
};
let context: any;
function mount(children: ReactNode, provide = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const value = () => (
    <QueryClientProvider client={client}>
      {provide ? <FeatureProvider value={context}>{children}</FeatureProvider> : children}
    </QueryClientProvider>
  );
  const view = render(value());
  return {
    ...view,
    client,
    updateContext(next: any) {
      context = next;
      view.rerender(value());
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.preferences.mockReturnValue({ timezone: 'America/New_York' });
  context = {
    user: owner,
    route: { page: 'boards' },
    sites: [site],
    teams: [team],
    siteId: site.id,
    site,
    range: { startAt: 1, endAt: 10, unit: 'day', timezone: 'UTC' },
    filters: {},
    query: {},
    api: { get: mocks.get, post: mocks.post, del: mocks.del },
    href: (page: string, params: any = {}) => `/${page}${params.id ? `/${params.id}` : ''}`,
    navigate: mocks.navigate,
    notify: mocks.notify,
    refresh: mocks.refresh,
  };
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/boards/board-1') return nativeBoard;
    if (path === '/teams/team-1')
      return { ...team, accessCode: 'team_code', twoFactorRequired: false };
    if (path === '/teams/team-1/users')
      return {
        data: [
          { userId: 'user-1', role: 'team-owner', user: { username: 'owner' } },
          { userId: 'user-2', role: 'team-manager', user: { username: 'manager' } },
        ],
        count: 2,
      };
    if (path === '/2fa/status') return { isConfigured: true, globalRequired: false };
    if (path.endsWith('/stats'))
      return {
        visitors: 4,
        pageviews: 8,
        visits: 5,
        comparison: { visitors: 3, pageviews: 6, visits: 4 },
      };
    if (path.endsWith('/pageviews'))
      return { pageviews: [{ x: '2026-10-01', y: 8 }], sessions: [{ x: '2026-10-01', y: 4 }] };
    if (path === '/dashboard')
      return {
        parameters: {
          extension: 'retained',
          rows: [],
          liekan: { siteIds: ['site-1'], showAI: true, showCompare: true },
        },
      };
    if (path.endsWith('/metrics')) return [{ x: 'llm', y: 2 }];
    return { data: [], count: 0 };
  });
  mocks.all.mockImplementation(async (path: string) =>
    path === '/teams' ? [team] : path === '/admin/users' ? [owner] : [],
  );
  mocks.post.mockImplementation(async (path: string, body: any) => ({
    id: path.startsWith('/boards/') ? 'board-1' : 'new-id',
    ...body,
    teamId: 'team-1',
  }));
  mocks.del.mockResolvedValue({ ok: true });
  mocks.refresh.mockResolvedValue(undefined);
  mocks.request.mockResolvedValue({});
});

describe('workspace permissions and native board persistence', () => {
  it('allows a read-only team entry to create a board in personal space', async () => {
    const viewer = { ...owner, id: 'viewer' };
    const readTeam = { ...team, members: [{ userId: viewer.id, role: 'team-view-only' }] };
    context = {
      ...context,
      user: viewer,
      teams: [readTeam],
      route: { page: 'board-editor', teamId: team.id },
    };
    mocks.post.mockImplementation(async (_path: string, body: any) => ({
      id: 'personal-board',
      ...body,
    }));
    mount(<WorkspacePages page="board-editor" />);
    const space = await screen.findByRole('combobox', { name: '所属空间' });
    expect(space).toBeEnabled();
    expect(screen.queryByRole('option', { name: team.name })).not.toBeInTheDocument();
    await userEvent.selectOptions(space, '');
    await userEvent.type(screen.getByRole('textbox', { name: /^看板名称/ }), '个人观察看板');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '关联资源' }), site.id);
    await userEvent.click(screen.getByRole('button', { name: '保存并编排' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/boards',
        expect.objectContaining({ name: '个人观察看板' }),
      ),
    );
    expect(mocks.post.mock.calls[0][1].teamId).toBeUndefined();
    expect(mocks.navigate).toHaveBeenCalledWith('board-design', {
      id: 'personal-board',
      teamId: '',
    });
  });
  it('keeps member editing below the actor rank and grants read-only no resource writes', () => {
    expect(canManageMember(owner, team, { role: 'team-manager' })).toBe(true);
    expect(canManageMember({ ...owner, id: 'user-2' }, team, { role: 'team-manager' })).toBe(false);
    expect(canManageMember(owner, team, { role: 'team-owner' })).toBe(false);
    const readTeam = { ...team, members: [{ userId: 'viewer', role: 'team-view-only' }] };
    expect(
      canManageResource(
        { ...owner, id: 'viewer' },
        { id: 'resource', name: '资源', teamId: team.id },
        [readTeam],
      ),
    ).toBe(false);
  });
  it('changing board resources and ordering retains unknown metadata and original component configuration', () => {
    const next = boardParameters(nativeBoard.parameters, 'link', 'link-1');
    expect(next.websiteId).toBeUndefined();
    expect(next.linkId).toBe('link-1');
    expect(next.extension).toEqual({ retain: true });
    const reordered = moveBoardColumn(next, 'column-2', 'column-1');
    expect(boardColumns(reordered).map(entry => entry.column.id)).toEqual(['column-2', 'column-1']);
    expect(reordered.rows[0].size).toBe(360);
    expect(reordered.rows[0].extension).toBe('row');
    expect(reordered.rows[0].columns[1].component.props).toEqual({ retain: 'one' });
    const widened = setBoardColumnWidth(reordered, 'column-2', true, () => 'new-row');
    expect(boardColumns(widened).map(entry => entry.column.id)).toEqual(['column-2', 'column-1']);
    expect(widened.rows[0].columns[0].size).toBe(100);
    expect(widened.rows[0].size).toBe(360);
  });
  it('joins the real team and navigates using the returned membership team ID', async () => {
    mount(<WorkspacePages page="team-join" />);
    await userEvent.type(screen.getByLabelText(/访问码/), 'team_access_code');
    await userEvent.click(screen.getByRole('button', { name: '验证并加入' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/teams/join', { accessCode: 'team_access_code' }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith('team-detail', { id: 'team-1', teamId: 'team-1' });
  });
  it('a team viewer can read members and cannot open mutation drawers', async () => {
    context.user = { ...owner, id: 'viewer' };
    context.route = { page: 'team-detail', teamId: 'team-1' };
    mocks.get.mockImplementation(async (path: string) =>
      path === '/teams/team-1'
        ? { ...team, members: [{ userId: 'viewer', role: 'team-view-only' }] }
        : {
            data: [{ userId: 'user-2', role: 'team-manager', user: { username: 'manager' } }],
            count: 1,
          },
    );
    mount(<WorkspacePages page="team-detail" />);
    expect(await screen.findByRole('button', { name: '添加已有用户' })).toBeDisabled();
    expect(await screen.findByRole('button', { name: '编辑角色' })).toBeDisabled();
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it.each([
    ['member', 'team-member', false],
    ['viewer', 'team-view-only', false],
    ['administrator member', 'team-member', true],
  ])(
    '%s can leave its team, and deletion follows administrative authority',
    async (_label, teamRole, isAdmin) => {
      context.user = { ...owner, isAdmin };
      context.route = { page: 'team-detail', teamId: 'team-1' };
      const original = mocks.get.getMockImplementation();
      mocks.get.mockImplementation(async (path: string, ...args: any[]) =>
        path === '/teams/team-1'
          ? { ...team, members: [{ userId: owner.id, role: teamRole }] }
          : original(path, ...args),
      );
      mount(<WorkspacePages page="team-detail" />);
      await userEvent.click(await screen.findByRole('tab', { name: '设置' }));
      expect(screen.getByRole('button', { name: '退出团队' })).toBeEnabled();
      if (isAdmin) expect(screen.getByRole('button', { name: '删除团队' })).toBeEnabled();
      else expect(screen.getByRole('button', { name: '删除团队' })).toBeDisabled();
    },
  );
  it('an actual owner must transfer ownership before leaving', async () => {
    context.route = { page: 'team-detail', teamId: 'team-1' };
    mount(<WorkspacePages page="team-detail" />);
    await userEvent.click(await screen.findByRole('tab', { name: '设置' }));
    expect(screen.getByRole('button', { name: '退出团队' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '删除团队' })).toBeEnabled();
  });
  it('member timestamps use the configured time zone across calendar boundaries', async () => {
    context.route = { page: 'team-detail', teamId: 'team-1' };
    const timestamp = '2026-10-01T00:00:00.000Z';
    const original = mocks.get.getMockImplementation();
    mocks.get.mockImplementation(async (path: string, ...args: any[]) =>
      path === '/teams/team-1/users'
        ? {
            data: [
              {
                userId: owner.id,
                role: 'team-owner',
                user: { username: owner.username },
                createdAt: timestamp,
              },
            ],
            count: 1,
          }
        : original(path, ...args),
    );
    mount(<WorkspacePages page="team-detail" />);
    const preferred = new Date(timestamp).toLocaleString('zh-CN', { timeZone: 'America/New_York' });
    expect(await screen.findByText(preferred)).toBeInTheDocument();
    expect(preferred).not.toBe(new Date(timestamp).toLocaleString('zh-CN', { timeZone: 'UTC' }));
  });
  it('native link board widgets retain event type and omit foreign website conditions', async () => {
    context.route = { page: 'board-view', id: 'board-1' };
    context.filters = {
      segment: 'foreign-site-segment',
      cohort: 'foreign-site-cohort',
      spf: 'secret=eq.x',
      epf: 'plan=eq.y',
    };
    const original = mocks.get.getMockImplementation();
    mocks.get.mockImplementation(async (path: string, ...args: any[]) =>
      path === '/boards/board-1'
        ? {
            ...nativeBoard,
            type: 'link',
            parameters: { ...nativeBoard.parameters, websiteId: undefined, linkId: 'link-1' },
          }
        : original(path, ...args),
    );
    mount(<WorkspacePages page="board-view" />);
    await waitFor(() =>
      expect(mocks.get.mock.calls.some(call => call[0] === '/websites/link-1/metrics')).toBe(true),
    );
    const calls = mocks.get.mock.calls.filter(call => call[0].startsWith('/websites/link-1/'));
    expect(calls.length).toBeGreaterThan(0);
    for (const [, params] of calls) {
      expect(params).toMatchObject({ startAt: 1, endAt: 10, eventType: 3 });
      for (const key of ['segment', 'cohort', 'spf', 'epf']) expect(params).not.toHaveProperty(key);
    }
  });
  it('board summary renders its four approved fields with actual goal values and no duplicate trend', async () => {
    const firstPage = Array.from({ length: 100 }, (_, i) => ({
      id: `goal-${i}`,
      name: `其他目标 ${i}`,
    }));
    const original = mocks.get.getMockImplementation();
    mocks.get.mockImplementation(async (path: string, params: any, signal: any) => {
      if (path === '/websites/site-1/goals')
        return {
          data: params.page === 1 ? firstPage : [{ id: 'appointment', name: '预约演示' }],
          count: 101,
        };
      if (path === '/websites/site-1/goals/appointment/stats')
        return { conversions: 11, num: 7, total: 20 };
      if (path === '/websites/site-1/stats')
        return params.drill_channel ? { visitors: 12 } : { visitors: 91, pageviews: 123 };
      return original(path, params, signal);
    });
    const { container } = mount(<ResourceAnalytics id="site-1" variant="board" />);
    await screen.findByText('11');
    expect(
      Array.from(container.querySelectorAll('.metric-label'), node => node.textContent),
    ).toEqual(['访客', 'AI 引荐', '预约转化', '转化访客']);
    expect(
      Array.from(container.querySelectorAll('.metric-value'), node => node.textContent),
    ).toEqual(['91', '12', '11', '7']);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith(
      '/websites/site-1/goals',
      { page: 2, pageSize: 100 },
      expect.any(AbortSignal),
    );
  });
  it('native metrics-only and trend widgets keep one outer panel per widget', async () => {
    context.route = { page: 'board-view', id: 'board-1' };
    const original = mocks.get.getMockImplementation();
    mocks.get.mockImplementation(async (path: string, ...args: any[]) =>
      path === '/boards/board-1'
        ? {
            ...nativeBoard,
            parameters: {
              ...nativeBoard.parameters,
              rows: [
                {
                  id: 'row',
                  columns: [
                    { id: 'metrics', component: { type: 'WebsiteMetricsBar', title: '统计摘要' } },
                    nativeBoard.parameters.rows[0].columns[0],
                  ],
                },
              ],
            },
          }
        : original(path, ...args),
    );
    const { container } = mount(<WorkspacePages page="board-view" />);
    expect(await screen.findByRole('heading', { name: '统计摘要' })).toBeInTheDocument();
    await screen.findByRole('img');
    expect(screen.getAllByRole('heading', { name: '访问趋势' })).toHaveLength(1);
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(container.querySelector('.board-widget .panel')).toBeNull();
  });
  it('team owners see that the native safety policy is administered by the system administrator', async () => {
    context.route = { page: 'team-detail', teamId: 'team-1' };
    mount(<WorkspacePages page="team-detail" />);
    await userEvent.click(await screen.findByRole('tab', { name: '安全' }));
    expect(await screen.findByText('团队安全策略由系统管理员设置。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存团队策略' })).toBeDisabled();
  });
  it('saves reordered and edited board components in rows/columns without losing extension fields', async () => {
    context.route = { page: 'board-design', id: 'board-1' };
    mount(<WorkspacePages page="board-design" />);
    const up = await screen.findAllByRole('button', { name: '上移' });
    await userEvent.click(up[1]);
    await userEvent.click(screen.getByRole('button', { name: '保存编排' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalled());
    const [path, body] = mocks.post.mock.calls[0];
    expect(path).toBe('/boards/board-1');
    expect(body.parameters.extension).toEqual({ retain: true });
    expect(body.parameters.rows[0].columns.map((column: any) => column.id)).toEqual([
      'column-2',
      'column-1',
    ]);
    expect(body.parameters.rows[0].columns[1].component.props).toEqual({ retain: 'one' });
  });
  it('fixed-source widget edits inherit the board source and remove legacy resource fields on save', async () => {
    context.route = { page: 'board-design', id: 'board-1' };
    const board = structuredClone(nativeBoard);
    Object.assign(board.parameters.rows[0].columns[0].component, {
      entityType: 'website',
      entityId: 'former-site',
      websiteId: 'former-site',
    });
    const originalGet = mocks.get.getMockImplementation();
    mocks.get.mockImplementation((path: string, ...args: any[]) =>
      path === '/boards/board-1' ? board : originalGet(path, ...args),
    );
    mount(<WorkspacePages page="board-design" />);
    const edit = await screen.findAllByRole('button', { name: '编辑' });
    await userEvent.click(edit[0]);
    await userEvent.click(await screen.findByRole('button', { name: '保存组件' }));
    await userEvent.click(screen.getByRole('button', { name: '保存编排' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalled());
    const parameters = mocks.post.mock.calls[0][1].parameters;
    expect(parameters.rows[0].columns[0].component).toEqual(
      nativeBoard.parameters.rows[0].columns[0].component,
    );
    expect(getBoardEntityIds({ type: 'website', parameters })).toEqual({
      websiteIds: [site.id],
      pixelIds: [],
      linkIds: [],
    });
  });
  it('changing a fixed board source keeps only the selected source in saved layout', async () => {
    context.route = { page: 'board-editor', id: 'board-1' };
    const other = { ...site, id: 'site-2', name: '新网站' };
    context.sites = [site, other];
    const board = structuredClone(nativeBoard);
    Object.assign(board.parameters.rows[0].columns[0].component, {
      entityType: 'website',
      entityId: site.id,
      websiteId: site.id,
    });
    mocks.get.mockResolvedValue(board);
    mount(<WorkspacePages page="board-editor" />);
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: '关联资源' }),
      other.id,
    );
    await userEvent.click(screen.getByRole('button', { name: '保存并编排' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalled());
    const parameters = mocks.post.mock.calls[0][1].parameters;
    expect(getBoardEntityIds({ type: 'website', parameters })).toEqual({
      websiteIds: [other.id],
      pixelIds: [],
      linkIds: [],
    });
    expect(parameters.rows[0].columns[0].component.props).toEqual({ retain: 'one' });
  });
  it('changing a fixed board to mixed preserves the original visible widget source', async () => {
    context.route = { page: 'board-editor', id: 'board-1' };
    mount(<WorkspacePages page="board-editor" />);
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: '看板类型' }),
      'mixed',
    );
    await userEvent.click(screen.getByRole('button', { name: '保存并编排' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalled());
    const parameters = mocks.post.mock.calls[0][1].parameters;
    expect(parameters.websiteId).toBeUndefined();
    expect(
      parameters.rows[0].columns.every(
        (column: any) =>
          column.component.entityType === 'website' && column.component.entityId === site.id,
      ),
    ).toBe(true);
    expect(getBoardEntityIds({ type: 'mixed', parameters }).websiteIds).toEqual([site.id]);
  });
  it('preserves native dashboard rows and saves only accessible selected websites', async () => {
    context.route = { page: 'dashboard-edit' };
    mount(<WorkspacePages page="dashboard-edit" />);
    await userEvent.click(await screen.findByRole('checkbox', { name: /产品网站/ }));
    await userEvent.click(screen.getByRole('button', { name: '保存工作台' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/dashboard',
        expect.objectContaining({
          parameters: expect.objectContaining({
            extension: 'retained',
            rows: [],
            liekan: expect.objectContaining({ siteIds: [] }),
          }),
        }),
      ),
    );
  });
  it('loads delayed workspace sites and team resources and keeps renamed site choices current', async () => {
    context = { ...context, sites: [], teams: [], route: { page: 'board-editor' } };
    const teamLink = { id: 'team-link', name: '团队推广链接', teamId: team.id };
    mocks.all.mockImplementation(async (path: string) =>
      path === `/teams/${team.id}/links` ? [teamLink] : [],
    );
    const view = mount(<WorkspacePages page="board-editor" />);
    await screen.findByRole('combobox', { name: '关联资源' });
    expect(screen.queryByRole('option', { name: site.name })).not.toBeInTheDocument();

    view.updateContext({ ...context, sites: [site], teams: [team] });
    expect(await screen.findByRole('option', { name: site.name })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '看板类型' }), 'link');
    expect(await screen.findByRole('option', { name: teamLink.name })).toBeInTheDocument();
    expect(mocks.all).toHaveBeenCalledWith(`/teams/${team.id}/links`, {}, expect.any(AbortSignal));

    await userEvent.selectOptions(screen.getByRole('combobox', { name: '看板类型' }), 'website');
    view.updateContext({ ...context, sites: [{ ...site, name: '网站新名称' }] });
    expect(await screen.findByRole('option', { name: '网站新名称' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: site.name })).not.toBeInTheDocument();

    view.updateContext({ ...context, teams: [] });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '看板类型' }), 'link');
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: teamLink.name })).not.toBeInTheDocument(),
    );
  });
  it('waits for delayed website hydration before initializing and saving existing dashboard pins', async () => {
    context = {
      ...context,
      sites: [],
      sitesLoading: true,
      route: { page: 'dashboard-edit' },
    };
    const view = mount(<WorkspacePages page="dashboard-edit" />);
    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith('/dashboard', undefined, expect.any(AbortSignal)),
    );
    await waitFor(() =>
      expect(view.client.getQueryCache().getAll()[0]?.state.status).toBe('success'),
    );
    expect(screen.queryByRole('button', { name: '保存工作台' })).not.toBeInTheDocument();

    view.updateContext({ ...context, sites: [site], sitesLoading: false });
    expect(await screen.findByRole('checkbox', { name: /产品网站/ })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: '保存工作台' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/dashboard',
        expect.objectContaining({
          parameters: expect.objectContaining({
            extension: 'retained',
            rows: [],
            liekan: expect.objectContaining({ siteIds: [site.id] }),
          }),
        }),
      ),
    );
  });
  it('allows an actually empty accessible website set to save an empty dashboard', async () => {
    context = { ...context, sites: [], sitesLoading: false, route: { page: 'dashboard-edit' } };
    mount(<WorkspacePages page="dashboard-edit" />);
    await userEvent.click(await screen.findByRole('button', { name: '保存工作台' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/dashboard',
        expect.objectContaining({
          parameters: expect.objectContaining({ liekan: expect.objectContaining({ siteIds: [] }) }),
        }),
      ),
    );
  });
  it('waits for the saved dashboard when website choices are already ready', async () => {
    context = { ...context, sitesLoading: false, route: { page: 'dashboard-edit' } };
    let complete: (dashboard: any) => void;
    mocks.get.mockImplementation(
      (path: string) =>
        new Promise(resolve => {
          if (path === '/dashboard') complete = resolve;
        }),
    );
    mount(<WorkspacePages page="dashboard-edit" />);
    await waitFor(() => expect(complete).toBeTypeOf('function'));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存工作台' })).not.toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();

    const rows = structuredClone(nativeBoard.parameters.rows);
    await act(async () => {
      complete({
        name: '已有工作台',
        parameters: {
          extension: 'retained',
          rows,
          liekan: { siteIds: [site.id], showAI: false, showCompare: true },
        },
      });
    });
    expect(await screen.findByRole('checkbox', { name: /产品网站/ })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: '保存工作台' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/dashboard',
        expect.objectContaining({
          parameters: expect.objectContaining({
            extension: 'retained',
            rows,
            liekan: expect.objectContaining({ siteIds: [site.id], showAI: false }),
          }),
        }),
      ),
    );
  });
  it('distinguishes absent analytics from a measured zero', () => {
    expect(nativeMetric(undefined)).toBeNull();
    expect(nativeMetric(null)).toBeNull();
    expect(nativeMetric(0)).toBe(0);
    expect(nativeMetric({ value: 0 })).toBe(0);
  });
});

describe('share settings and public access from the list', () => {
  const share = {
    id: 'share-1',
    entityId: site.id,
    shareType: 1,
    name: '客户分享',
    slug: 'customer/share',
    parameters: {
      overview: true,
      events: false,
      utm: true,
      goals: true,
      funnels: true,
      allowFilter: false,
      hasPassword: true,
      enabled: false,
      extension: 'retained',
    },
  };
  beforeEach(() => {
    context.route = { page: 'sharing' };
    mocks.all.mockImplementation(async (path: string) =>
      path === `/websites/${site.id}/shares` ? [share] : [],
    );
  });

  it('creates a share with the selected resource and submitted viewing permissions', async () => {
    mount(<WorkspacePages page="sharing" />);
    const trigger = await screen.findByRole('button', { name: '创建分享链接' });
    await waitFor(() => expect(trigger).toBeEnabled());
    await userEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '创建分享链接' });
    expect(dialog).toHaveAccessibleDescription('设置分享资源、统计页面范围与访问保护。');
    await userEvent.type(within(dialog).getByLabelText(/分享名称/), '销售统计');
    await userEvent.selectOptions(within(dialog).getByLabelText('关联资源'), site.id);
    await userEvent.click(within(dialog).getByLabelText('总览'));
    await userEvent.click(within(dialog).getByLabelText('UTM'));
    await userEvent.click(within(dialog).getByLabelText('允许访客调整筛选'));
    await userEvent.click(within(dialog).getByRole('button', { name: '创建分享链接' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.post).toHaveBeenCalledWith('/share', {
      name: '销售统计',
      entityId: site.id,
      shareType: 1,
      parameters: {
        enabled: true,
        allowFilter: false,
        theme: 'light',
        overview: false,
        events: true,
        utm: true,
        goals: false,
        funnels: false,
      },
    });
  });

  it('edits a share while preserving its slug, disabled state, password and extra parameters', async () => {
    mount(<WorkspacePages page="sharing" />);
    await userEvent.click(await screen.findByRole('button', { name: '编辑' }));
    const dialog = screen.getByRole('dialog', { name: '编辑分享链接' });
    expect(within(dialog).getByLabelText('关联资源')).toHaveValue(site.name);
    expect(within(dialog).getByLabelText('分享类型')).toBeDisabled();
    expect(within(dialog).getByLabelText(/修改分享密码/)).toHaveValue('');
    const name = within(dialog).getByLabelText(/分享名称/);
    await userEvent.clear(name);
    await userEvent.type(name, '客户周报');
    await userEvent.click(within(dialog).getByLabelText('事件'));
    await userEvent.click(within(dialog).getByRole('button', { name: '保存分享链接' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.post).toHaveBeenCalledWith('/share/id/share-1', {
      name: '客户周报',
      slug: share.slug,
      parameters: { ...share.parameters, events: true, theme: 'light' },
    });
  });

  it('keeps failed edits open and restores the trigger focus when cancelled', async () => {
    mocks.post.mockRejectedValue(new Error('保存失败，请重试'));
    mount(<WorkspacePages page="sharing" />);
    const trigger = await screen.findByRole('button', { name: '编辑' });
    await userEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '编辑分享链接' });
    await userEvent.click(within(dialog).getByRole('button', { name: '保存分享链接' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('保存失败，请重试');
    await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });

  it('traps keyboard focus in the dialog and closes on Escape without saving', async () => {
    mount(<WorkspacePages page="sharing" />);
    const trigger = await screen.findByRole('button', { name: '编辑' });
    await userEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '编辑分享链接' });
    const close = within(dialog).getByRole('button', { name: '关闭弹层' });
    expect(close).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(within(dialog).getByRole('button', { name: '取消' })).toHaveFocus();
    await userEvent.tab();
    await waitFor(() => expect(close).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('opens the actual public share in a new tab even for a viewer without edit access', async () => {
    context.user = { id: 'viewer', username: 'viewer', role: 'user' };
    mount(<WorkspacePages page="sharing" />);
    const link = await screen.findByRole('link', { name: /访问分享链接：客户分享/ });
    expect(link).toHaveAttribute('href', '/share/customer%2Fshare');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('button', { name: '编辑' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '启用' })).toBeDisabled();
  });
});

describe('public share restrictions and password lifecycle', () => {
  it('does not carry returned password material into an update, and explicitly removes protection with null', () => {
    const unchanged = shareParameters(
      { overview: 'on', allowFilter: 'on', theme: 'light' },
      { passwordHash: 'hash', password: 'old', hasPassword: true, extension: 'retain' },
    );
    expect(unchanged).not.toHaveProperty('passwordHash');
    expect(unchanged).not.toHaveProperty('password');
    expect(unchanged.extension).toBe('retain');
    expect(shareParameters({ removePassword: 'on' }, { hasPassword: true }).password).toBeNull();
    expect(
      allowedShareSections({ overview: false, events: true, utm: false, goals: false }),
    ).toEqual([['events', '事件']]);
  });
  it('requires the public password before statistics, sends the password only on submission, and uses the share token for allowed events', async () => {
    mocks.request.mockImplementation(async (method: string, path: string) => {
      if (path === '/share/password-share')
        return method === 'GET'
          ? { requiresPassword: true, name: '受保护分享' }
          : {
              token: 'public-token',
              websiteId: 'site-1',
              parameters: {
                overview: false,
                events: true,
                utm: false,
                goals: false,
                allowFilter: false,
              },
            };
      if (path === '/websites/site-1/events/series')
        return [{ x: 'register', t: '2026-10-01', y: 0 }];
      throw new Error(`Unexpected public request ${path}`);
    });
    mount(<ShareFeatureView slug="password-share" />, false);
    await screen.findByRole('heading', { name: '输入分享密码' });
    expect(mocks.request.mock.calls.every(call => call[1] === '/share/password-share')).toBe(true);
    await userEvent.type(screen.getByLabelText(/分享密码/), 'visitor-password');
    await userEvent.click(screen.getByRole('button', { name: '验证并查看' }));
    expect(await screen.findByRole('tab', { name: '事件' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '总览' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('页面路径')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith(
        'GET',
        '/websites/site-1/events/series',
        expect.any(Object),
        expect.any(AbortSignal),
        'public-token',
        '',
      ),
    );
    expect(mocks.request).toHaveBeenCalledWith(
      'POST',
      '/share/password-share',
      { password: 'visitor-password' },
      expect.any(AbortSignal),
      undefined,
      '',
    );
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it('a pending password response for a previous slug never renders its verified statistics', async () => {
    let finishPrevious: (value: any) => void;
    mocks.request.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path.startsWith('/share/'))
        return Promise.resolve({
          requiresPassword: true,
          name: path.endsWith('old-share') ? '旧分享' : '新分享',
        });
      if (method === 'POST' && path === '/share/old-share')
        return new Promise(resolve => {
          finishPrevious = resolve;
        });
      throw new Error(`Unexpected request ${path}`);
    });
    const { rerender, client } = mount(<ShareFeatureView slug="old-share" />, false);
    await userEvent.type(await screen.findByLabelText(/分享密码/), 'old-password');
    await userEvent.click(screen.getByRole('button', { name: '验证并查看' }));
    const submitted = mocks.request.mock.calls.find(call => call[0] === 'POST');
    expect(submitted).toBeDefined();
    const signal = submitted[3] as AbortSignal;
    rerender(
      <QueryClientProvider client={client}>
        <ShareFeatureView slug="new-share" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('新分享 · 只读分享')).toBeInTheDocument();
    expect(signal.aborted).toBe(true);
    await act(async () =>
      finishPrevious({
        token: 'obsolete-token',
        websiteId: 'old-site',
        parameters: { overview: true, allowFilter: false },
      }),
    );
    expect(screen.getByRole('heading', { name: '输入分享密码' })).toBeInTheDocument();
    expect(mocks.request.mock.calls.filter(call => call[1].startsWith('/websites/'))).toHaveLength(
      0,
    );
    expect(screen.getByRole('button', { name: '验证并查看' })).toBeEnabled();
  });
  it('the legacy public analytics component preserves truthful appointment conversions', async () => {
    mocks.request.mockImplementation(async (_method: string, path: string, params: any) => {
      if (path === '/share/overview-share')
        return {
          token: 'overview-token',
          websiteId: 'site-1',
          parameters: {
            overview: true,
            goals: true,
            events: false,
            utm: false,
            allowFilter: false,
          },
        };
      if (path === '/websites/site-1/goals')
        return { data: [{ id: 'appointment', name: '预约演示' }], count: 1 };
      if (path === '/websites/site-1/goals/appointment/stats')
        return { conversions: 11, num: 7, total: 20 };
      if (path.endsWith('/stats'))
        return params.drill_channel ? { visitors: 12 } : { visitors: 91, pageviews: 123 };
      if (path.endsWith('/pageviews'))
        return { pageviews: [{ x: '2026-10-01', y: 123 }], sessions: [{ x: '2026-10-01', y: 91 }] };
      throw new Error(`Unexpected public request ${path}`);
    });
    const { container } = mount(<ResourceAnalytics id="site-1" kind="website" variant="public" title="访问趋势"
      request={(path, params, signal) => mocks.request('GET', path, params, signal, 'overview-token', '')} />);
    await screen.findByText('11');
    expect(
      Array.from(container.querySelectorAll('.metric-label'), node => node.textContent),
    ).toEqual(['访客', '访问次数', 'AI 引荐', '预约演示']);
    expect(
      Array.from(container.querySelectorAll('.metric-value'), node => node.textContent),
    ).toEqual(['91', '123', '12', '11']);
    expect(screen.getByRole('img', { name: '访问趋势' })).toBeInTheDocument();
    expect(
      mocks.request.mock.calls
        .filter(call => call[1].startsWith('/websites/'))
        .every(call => call[4] === 'overview-token' && call[5] === ''),
    ).toBe(true);
  });
  it('website shares render every requested module and update all dates together with the share token', async () => {
    mocks.request.mockImplementation(async (_method: string, path: string) => {
      if (path === '/share/website-report') return {
        token: 'report-token', websiteId: 'site-1',
        parameters: { overview: true, goals: false, events: false, utm: false, allowFilter: true },
      };
      if (path === '/liekan/websites/site-1/shared-report') return {
        website: { id: 'site-1', name: '测试网站', domain: 'example.com' },
        states: { human: 'available', logs: 'not_connected' },
        cards: [{ label: '访客数 UV', value: 91, state: 'available', detail: '所选统计范围' }],
        charts: {},
        tables: { envGrid: [{ category: 'browser', name: 'chrome', share: 100 }], cityBody: [{ city: '上海', sessions: 20, share: 30, duration: 120, bounceRate: 10, conversionRate: null }] },
        insights: ['接入服务器日志后可计算 AI 抓取统计。'],
        meta: { demo: true }, capabilities: { goals: false },
      };
      throw new Error(`Unexpected public request ${path}`);
    });
    mount(<ShareFeatureView slug="website-report" />, false);
    await screen.findByRole('heading', { name: '测试网站' });
    for (const title of ['访客趋势（UV / PV / 跳出率）', '访问时段热力', '设备构成', '浏览器 / OS TOP5', 'AI 蜘蛛 vs 人类访问趋势', 'AI 蜘蛛构成', '人类来源渠道', 'GEO 关键发现', '国内省份分布 TOP10', '海外国家/地区 TOP8', '城市明细 TOP12'])
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /分享图表/ })).toHaveLength(8);
    expect(screen.getByText(/以下为隔离的示例数据/)).toBeInTheDocument();
    expect(screen.getByText('上海')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '转化率' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('页面路径')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '7 天' }));
    await waitFor(() => {
      const calls = mocks.request.mock.calls.filter(call => call[1].includes('/shared-report'));
      expect(calls).toHaveLength(2);
      expect(calls[1][2]).toMatchObject({ timezone: 'Asia/Shanghai', chartPeriod: '7d' });
      expect(calls[1][2].endAt - calls[1][2].startAt).toBe(7 * 86400000 - 1);
      expect(calls.every(call => call[4] === 'report-token' && call[5] === '')).toBe(true);
    });
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-09-06' } });
    await waitFor(() => expect(mocks.request.mock.calls.at(-1)?.[2].startAt).toBe(Date.parse('2026-09-05T16:00:00Z')));
  });
  it('public goals and funnels fetch every page with the share token and chart conversion count', async () => {
    const configurations = (kind: string) =>
      Array.from({ length: 101 }, (_, i) => ({
        id: `${kind}-${i}`,
        name: `${kind === 'goal' ? '目标' : '漏斗'} ${i}`,
      }));
    mocks.request.mockImplementation(async (_method: string, path: string, params: any) => {
      if (path === '/share/many-goals')
        return {
          token: 'many-goals-token',
          websiteId: 'site-1',
          parameters: {
            overview: false,
            goals: true,
            funnels: true,
            events: false,
            utm: false,
            allowFilter: false,
          },
        };
      if (path === '/websites/site-1/goals' || path === '/websites/site-1/funnels') {
        const rows = configurations(path.endsWith('/goals') ? 'goal' : 'funnel');
        return { data: rows.slice((params.page - 1) * 100, params.page * 100), count: rows.length };
      }
      if (path.includes('/goals/') && path.endsWith('/stats'))
        return { num: 2, total: 4, conversions: 19, series: [{ x: '2026-10-01', y: 19 }] };
      if (path.includes('/funnels/') && path.endsWith('/stats'))
        return [{ visitors: 10 }, { visitors: 3 }];
      throw new Error(`Unexpected public request ${path}`);
    });
    mount(<ShareFeatureView slug="many-goals" />, false);
    expect(await screen.findByText('目标 100')).toBeInTheDocument();
    expect(screen.getByText('漏斗 100')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '目标转化' })).toHaveTextContent(
      '"name":"转化次数","values":[19]',
    );
    for (const kind of ['goals', 'funnels'])
      expect(mocks.request).toHaveBeenCalledWith(
        'GET',
        `/websites/site-1/${kind}`,
        { page: 2, pageSize: 100 },
        expect.any(AbortSignal),
        'many-goals-token',
        '',
      );
    expect(
      mocks.request.mock.calls
        .filter(call => call[1].startsWith('/websites/'))
        .every(call => call[4] === 'many-goals-token' && call[5] === ''),
    ).toBe(true);
  });
  it('an expired old password token returns the visitor to the password gate', async () => {
    let calls = 0;
    mocks.request.mockImplementation(async (method: string, path: string) => {
      if (path === '/share/changing-password')
        return method === 'POST'
          ? {
              token: 'old-token',
              websiteId: 'site-1',
              parameters: {
                overview: true,
                events: false,
                utm: false,
                goals: false,
                allowFilter: false,
              },
            }
          : { requiresPassword: true };
      calls++;
      throw Object.assign(new Error('Share authentication expired'), { status: 401 });
    });
    mount(<ShareFeatureView slug="changing-password" />, false);
    await userEvent.type(await screen.findByLabelText(/分享密码/), 'previous-password');
    await userEvent.click(screen.getByRole('button', { name: '验证并查看' }));
    await waitFor(() => expect(calls).toBeGreaterThan(0));
    expect(await screen.findByRole('heading', { name: '输入分享密码' })).toBeInTheDocument();
  });
  it('a disabled share displays the closed state without requesting statistics', async () => {
    mocks.request.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));
    mount(<ShareFeatureView slug="closed-share" />, false);
    expect(await screen.findByRole('heading', { name: '分享已关闭' })).toBeInTheDocument();
    expect(mocks.request.mock.calls.every(call => call[1] === '/share/closed-share')).toBe(true);
  });
  it('a public board excludes components whose statistic sections are not licensed', async () => {
    const board = {
      ...nativeBoard,
      parameters: {
        ...nativeBoard.parameters,
        rows: [
          {
            id: 'public-row',
            columns: [
              nativeBoard.parameters.rows[0].columns[0],
              { id: 'private-events', component: { type: 'EventsChart', title: '受限的事件图表' } },
            ],
          },
        ],
      },
    };
    mocks.request.mockImplementation(async (_method: string, path: string) => {
      if (path === '/share/board-share')
        return {
          token: 'board-share-token',
          boardId: 'board-1',
          websiteIds: ['site-1'],
          parameters: {
            overview: true,
            events: false,
            goals: false,
            utm: false,
            allowFilter: false,
          },
        };
      if (path === '/boards/board-1') return board;
      if (path.endsWith('/stats')) return { visitors: 0, pageviews: 0, visits: 0 };
      if (path.endsWith('/pageviews')) return { pageviews: [], sessions: [] };
      throw new Error(`Unlicensed request: ${path}`);
    });
    mount(<ShareFeatureView slug="board-share" />, false);
    expect(await screen.findByRole('heading', { name: '观察看板' })).toBeInTheDocument();
    expect(screen.queryByText('受限的事件图表')).not.toBeInTheDocument();
    expect(mocks.request.mock.calls.some(call => call[1].endsWith('/events/series'))).toBe(false);
    expect(
      mocks.request.mock.calls
        .filter(call => call[1].startsWith('/websites/'))
        .every(call => call[4] === 'board-share-token' && call[5] === ''),
    ).toBe(true);
  });
  it('a public text-only board renders without requesting website statistics', async () => {
    mocks.request.mockImplementation(async (_method: string, path: string) => {
      if (path.startsWith('/share/'))
        return {
          token: 'text-board-token',
          boardId: 'text-board',
          parameters: {
            overview: true,
            events: false,
            goals: false,
            utm: false,
            allowFilter: false,
          },
        };
      if (path === '/boards/text-board')
        return {
          id: 'text-board',
          name: '说明看板',
          type: 'mixed',
          parameters: {
            rows: [
              {
                id: 'row',
                columns: [
                  {
                    id: 'text',
                    component: { type: 'TextBlock', props: { content: '已保存的说明文字' } },
                  },
                ],
              },
            ],
          },
        };
      throw new Error(`Unexpected request: ${path}`);
    });
    mount(<ShareFeatureView slug="text-board" />, false);
    expect(await screen.findByText('已保存的说明文字')).toBeInTheDocument();
    expect(mocks.request.mock.calls.some(call => call[1].startsWith('/websites/'))).toBe(false);
  });
  it('a second share of the same website issues a fresh request with its own token', async () => {
    mocks.request.mockImplementation(async (_method: string, path: string) =>
      path.startsWith('/share/')
        ? {
            token: path.endsWith('one') ? 'token-one' : 'token-two',
            websiteId: 'site-1',
            parameters: {
              overview: true,
              events: false,
              goals: false,
              utm: false,
              allowFilter: false,
            },
          }
        : { website: { name: '同一网站', domain: 'example.com' }, cards: [], charts: {}, tables: { envGrid: [], cityBody: [] }, insights: [], meta: { demo: false }, states: { human: 'empty' }, capabilities: { goals: false } },
    );
    const { rerender, client } = mount(<ShareFeatureView slug="one" />, false);
    await waitFor(() =>
      expect(
        mocks.request.mock.calls.some(
          call => call[1] === '/liekan/websites/site-1/shared-report' && call[4] === 'token-one',
        ),
      ).toBe(true),
    );
    rerender(
      <QueryClientProvider client={client}>
        <ShareFeatureView slug="two" />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(
        mocks.request.mock.calls.some(
          call => call[1] === '/liekan/websites/site-1/shared-report' && call[4] === 'token-two',
        ),
      ).toBe(true),
    );
  });
});
