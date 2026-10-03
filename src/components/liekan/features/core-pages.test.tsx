import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  conversionRate,
  featureNavigationPath,
  funnelPayload,
  goalPayload,
  recorderPayload,
  safeCallbackUrl,
  trackerSnippet,
} from '@/lib/liekan/contracts/core';
import { CorePages, FeatureAuthPage } from './CorePages';

const mocks = vi.hoisted(() => ({
  context: null as any,
  query: {} as Record<string, any>,
  post: vi.fn(),
  verify: vi.fn(),
  sso: vi.fn(),
  login: vi.fn(),
  replace: vi.fn(),
  params: new URLSearchParams(),
  queries: [] as any[],
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => mocks.params,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('./Chart', () => ({
  Chart: ({ title, labels, series }: any) => (
    <div role="img" aria-label={title}>
      {JSON.stringify({ labels, series })}
    </div>
  ),
}));
vi.mock('./context', () => ({
  useFeature: () => mocks.context,
  useData: (key: string | any[]) => {
    const name = Array.isArray(key) ? key[0] : key;
    mocks.queries.push(key);
    return {
      data: typeof mocks.query[name] === 'function' ? mocks.query[name](key) : mocks.query[name],
      isPending: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    };
  },
  useAction: () => {
    const [busy, setBusy] = useState(false);
    return {
      run: async (action: () => Promise<any>) => {
        setBusy(true);
        try {
          return await action();
        } finally {
          setBusy(false);
        }
      },
      busy,
      error: '',
    };
  },
}));
vi.mock('@/lib/liekan/upstream/features-client', () => ({
  featureApi: { post: mocks.post },
  acceptFeatureLogin: mocks.login,
  clearFeatureLogin: vi.fn(),
  verifyFeatureTwoFactor: mocks.verify,
  verifyFeatureSso: mocks.sso,
  getFeaturePreferences: () => ({
    range: '30day',
    timezone: 'Asia/Shanghai',
    language: 'zh-CN',
    theme: 'light',
  }),
  saveFeaturePreferences: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query = {};
  mocks.queries = [];
  mocks.params = new URLSearchParams();
  sessionStorage.clear();
  mocks.context = {
    user: { id: 'user-1', username: 'owner', role: 'admin', isAdmin: true },
    route: { page: 'funnel-editor' },
    siteId: 'site-1',
    site: { id: 'site-1', name: '网站', domain: 'example.com', userId: 'user-1' },
    sites: [],
    teams: [],
    range: { startAt: 1, endAt: 2 },
    filters: {},
    query: {},
    api: { post: mocks.post, get: vi.fn(), del: vi.fn() },
    href: (page: string) => `/liekan/${page}`,
    navigate: vi.fn(),
    notify: vi.fn(),
    refresh: vi.fn(),
  };
});

describe('core API mappings', () => {
  it('passes logical paths to Next navigation when a base path is configured', () => {
    expect(featureNavigationPath('/stats/dashboard', '/stats')).toBe('/dashboard');
    expect(featureNavigationPath('/dashboard', '/stats')).toBe('/dashboard');
    expect(featureNavigationPath('/stats', '/stats')).toBe('/');
    expect(featureNavigationPath('/stats-other/dashboard', '/stats')).toBe(
      '/stats-other/dashboard',
    );
    expect(featureNavigationPath('//attacker.example', '/stats')).toBe('/dashboard');
    expect(featureNavigationPath('/\n/attacker.example', '/stats')).toBe('/dashboard');
  });
  it('converts recorder percentages and minutes and keeps both collection switches off', () => {
    expect(
      recorderPayload({
        replayRate: '25',
        heatRate: '5',
        duration: '15',
        mask: 'strict',
        blockSelector: ' .private ',
      }),
    ).toEqual({
      replayConfig: {
        replayEnabled: false,
        heatmapEnabled: false,
        sampleRate: 0.25,
        heatmapSampleRate: 0.05,
        maskLevel: 'strict',
        maxDuration: 900000,
        blockSelector: '.private',
      },
    });
    expect(
      recorderPayload({
        replay: 'on',
        heatmap: 'on',
        replayRate: '100',
        heatRate: '100',
        duration: '5',
        mask: 'moderate',
      }).replayConfig.replayEnabled,
    ).toBe(true);
    expect(() => recorderPayload({ replayRate: '101', heatRate: '5', duration: '5' })).toThrow();
  });
  it('retains goal descriptions and validates the trigger type', () => {
    expect(
      goalPayload({
        name: ' 报名 ',
        goalType: 'event',
        value: ' submit ',
        description: ' 活动报名 ',
      }),
    ).toEqual({
      name: '报名',
      description: '活动报名',
      parameters: { type: 'event', value: 'submit' },
    });
    expect(() => goalPayload({ name: '报名', goalType: 'arbitrary', value: 'submit' })).toThrow();
  });
  it('retains ordered funnel steps, property operators, and the real stored window', () => {
    const steps: any[] = [
      {
        type: 'event',
        value: 'purchase',
        filters: [{ property: 'plan', operator: 'neq', value: 'free' }],
      },
      {
        type: 'path',
        value: '/thank-you',
        filters: [{ property: 'discard', operator: 'eq', value: 'x' }],
      },
    ];
    expect(funnelPayload({ name: '购买', window: '45', description: '保留说明' }, steps)).toEqual({
      name: '购买',
      description: '保留说明',
      parameters: {
        window: 45,
        steps: [
          {
            type: 'event',
            value: 'purchase',
            filters: [{ property: 'plan', operator: 'neq', value: 'free' }],
          },
          { type: 'path', value: '/thank-you' },
        ],
      },
    });
    expect(() => funnelPayload({ name: '购买', window: '0' }, steps)).toThrow();
    expect(() => funnelPayload({ name: '购买', window: '1' }, steps.slice(0, 1))).toThrow();
    expect(() => funnelPayload({ name: '购买', window: '1' }, Array(9).fill(steps[0]))).toThrow();
  });
  it('creates instance-specific code with the actual site UUID and base path', () => {
    const snippet = trackerSnippet(
      'https://stats.example.com',
      '/analytics/',
      '507825b2-37c1-4d3a-9684-7bcd9d6aabc8',
    );
    expect(snippet).toContain('https://stats.example.com/analytics/script.js');
    expect(snippet).toContain('507825b2-37c1-4d3a-9684-7bcd9d6aabc8');
    expect(snippet).not.toContain('demo-website-id');
    expect(trackerSnippet('https://stats.example.com', '', 'real-site')).toContain(
      'https://stats.example.com/script.js',
    );
  });
  it('distinguishes zero visitors and blocks unsafe callback redirects', () => {
    expect(conversionRate(0, 0)).toBe('—');
    expect(conversionRate(0, 100)).toBe('0.00%');
    expect(conversionRate(25, 100)).toBe('25.00%');
    expect(safeCallbackUrl('/dashboard?websiteId=abc')).toBe('/dashboard?websiteId=abc');
    for (const url of ['//attacker.example', 'javascript:alert(1)', '/\\attacker.example', '/a:b'])
      expect(safeCallbackUrl(url)).toBeNull();
    for (const code of [...Array.from({ length: 32 }, (_, i) => i), 127]) {
      expect(safeCallbackUrl(`/${String.fromCharCode(code)}/attacker.example`)).toBeNull();
    }
  });
});

describe('core form flows', () => {
  it('blocks 2FA cancellation during confirmation and retains the returned backup codes', async () => {
    let resolve: (value: any) => void;
    mocks.query['2fa-status'] = { isEnabled: false, isConfigured: true };
    mocks.post.mockImplementation(path =>
      path === '/2fa/setup/initiate'
        ? Promise.resolve({
            manualKey: 'temporary-manual-key',
            qrCodeDataUrl: 'data:image/png;base64,AA==',
          })
        : path === '/2fa/setup/confirm'
          ? new Promise(done => {
              resolve = done;
            })
          : Promise.resolve({}),
    );
    const user = userEvent.setup();
    const { rerender } = render(<CorePages page="two-factor" />);
    await user.click(screen.getByRole('button', { name: '生成绑定信息' }));
    await user.type(await screen.findByLabelText(/6 位验证码/), '123456');
    await user.click(screen.getByRole('button', { name: '验证并继续' }));
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(mocks.post).not.toHaveBeenCalledWith('/2fa/setup/cancel');
    resolve({ backupCodes: ['backup-current-session'] });
    await waitFor(() => expect(mocks.context.navigate).toHaveBeenCalledWith('backup-codes'));
    rerender(<CorePages page="backup-codes" />);
    expect(screen.getByText('backup-current-session')).toBeInTheDocument();
  });
  it('discards a delayed setup response after the binding page is unmounted', async () => {
    let resolve: (value: any) => void;
    mocks.query['2fa-status'] = { isEnabled: false, isConfigured: true };
    mocks.post.mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    );
    const user = userEvent.setup();
    const { rerender } = render(<CorePages page="two-factor" />);
    await user.click(screen.getByRole('button', { name: '生成绑定信息' }));
    rerender(<CorePages page="account" />);
    resolve({ manualKey: 'obsolete-manual-key', qrCodeDataUrl: 'data:image/png;base64,AA==' });
    await user.click(screen.getByRole('button', { name: '修改用户名' }));
    expect(screen.queryByText('obsolete-manual-key')).not.toBeInTheDocument();
    expect(mocks.context.navigate).not.toHaveBeenCalled();
  });
  it.each(['goals', 'funnels'])(
    'clamps %s to the preceding page when the last definition on its final page is deleted',
    async kind => {
      let deleted = false;
      const first = {
        id: 'first',
        name: '首页定义',
        parameters: {
          type: 'path',
          value: '/',
          window: 30,
          steps: [
            { type: 'path', value: '/' },
            { type: 'event', value: 'submit' },
          ],
        },
      };
      const last = { ...first, id: 'last', name: '最后一页定义' };
      mocks.query[kind] = (key: any[]) => ({
        data: key[1] === 2 ? (deleted ? [] : [last]) : [first],
        count: deleted ? 20 : 21,
        page: key[1],
        pageSize: 20,
      });
      mocks.context.api.del.mockImplementation(async () => {
        deleted = true;
        return {};
      });
      const user = userEvent.setup();
      render(<CorePages page={kind} />);
      await user.click(screen.getByRole('button', { name: '下一页' }));
      await user.click(screen.getByRole('button', { name: '删除' }));
      await user.type(screen.getByLabelText(/输入 最后一页定义 确认/), '最后一页定义');
      await user.click(screen.getByRole('button', { name: '确认删除' }));
      await waitFor(() => expect(mocks.queries.filter(key => key[0] === kind).at(-1)?.[1]).toBe(1));
      expect(screen.queryByText('最后一页定义')).not.toBeInTheDocument();
      expect(screen.getAllByText('首页定义').length).toBeGreaterThan(0);
    },
  );
  it.each(['goals', 'funnels'])(
    'clamps %s to page one when deleting the final remaining definition',
    async kind => {
      let deleted = false;
      const only = {
        id: 'only',
        name: '唯一的定义',
        parameters: {
          type: 'path',
          value: '/',
          window: 30,
          steps: [
            { type: 'path', value: '/' },
            { type: 'event', value: 'submit' },
          ],
        },
      };
      mocks.query[kind] = (key: any[]) => ({
        data: deleted ? [] : [only],
        count: deleted ? 0 : 1,
        page: key[1],
        pageSize: 20,
      });
      mocks.context.api.del.mockImplementation(async () => {
        deleted = true;
        return {};
      });
      const user = userEvent.setup();
      render(<CorePages page={kind} />);
      await user.click(screen.getByRole('button', { name: '删除' }));
      await user.type(screen.getByLabelText(/输入 唯一的定义 确认/), '唯一的定义');
      await user.click(screen.getByRole('button', { name: '确认删除' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(mocks.queries.filter(key => key[0] === kind).at(-1)?.[1]).toBe(1);
      expect(screen.queryByText('唯一的定义')).not.toBeInTheDocument();
    },
  );
  it('distinguishes permission failures, server failures, partial subtotals, and real zero website data', () => {
    mocks.context.sites = [
      { id: 'active', name: '活跃网站' },
      { id: 'zero', name: '零访问网站' },
      { id: 'denied', name: '权限网站' },
      { id: 'expired', name: '过期会话网站' },
      { id: 'failed', name: '故障网站' },
    ];
    mocks.query['website-management-stats'] = [
      { id: 'active', views: 120, received: true, lastAt: '2026-10-01T00:00:00Z' },
      { id: 'zero', views: 0, received: false },
      { id: 'denied', error: { status: 403, message: 'Forbidden' } },
      { id: 'expired', error: { status: 401, message: 'Expired' } },
      { id: 'failed', error: { status: 503, message: 'Unavailable' } },
    ];
    const { rerender } = render(<CorePages page="websites" />);
    expect(screen.getByText('无统计权限')).toBeInTheDocument();
    expect(screen.getByText('登录已过期')).toBeInTheDocument();
    expect(screen.getByText('读取失败')).toBeInTheDocument();
    const views = document.querySelectorAll('.metric')[3] as HTMLElement;
    expect(within(views).getByText('120')).toBeInTheDocument();
    expect(views).toHaveTextContent('已读取 2 / 5 个网站的小计');
    expect(within(screen.getByText('零访问网站').closest('tr')).getByText('0')).toBeInTheDocument();
    expect(within(screen.getByText('故障网站').closest('tr')).getByText('—')).toBeInTheDocument();
    mocks.context.sites = [{ id: 'failed', name: '故障网站' }];
    mocks.query['website-management-stats'] = [
      { id: 'failed', error: { status: 503, message: 'Unavailable' } },
    ];
    rerender(<CorePages page="websites" />);
    const failedViews = document.querySelectorAll('.metric')[3] as HTMLElement;
    expect(within(failedViews).getByText('—')).toBeInTheDocument();
    expect(within(failedViews).queryByText('0')).not.toBeInTheDocument();
  });
  it('keeps new website recorder collection off and saves actual units', async () => {
    mocks.query['site-record'] = { ...mocks.context.site, replayConfig: {} };
    mocks.post.mockResolvedValue({});
    const user = userEvent.setup();
    render(<CorePages page="recorder-settings" />);
    expect(screen.getByLabelText(/启用会话回放/)).not.toBeChecked();
    expect(screen.getByLabelText(/启用热力图/)).not.toBeChecked();
    fireEvent.change(screen.getByLabelText(/回放采样率/), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('最长录制时长'), { target: { value: '10' } });
    await user.click(screen.getByRole('button', { name: '保存采集配置' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/websites/site-1', {
        replayConfig: {
          replayEnabled: false,
          heatmapEnabled: false,
          sampleRate: 0.5,
          heatmapSampleRate: 0.15,
          maskLevel: 'moderate',
          maxDuration: 600000,
          blockSelector: '',
        },
      }),
    );
  });
  it('disables mutation controls for a view-only identity even if it owns a website', () => {
    mocks.context.user = { ...mocks.context.user, role: 'view-only', isAdmin: false };
    render(<CorePages page="goal-editor" />);
    expect(screen.getByRole('button', { name: '保存目标' })).toBeDisabled();
  });
  it('permits team-member website editing and creation while keeping transfer restricted', async () => {
    mocks.context.user = { ...mocks.context.user, role: 'user', isAdmin: false };
    mocks.context.site = { ...mocks.context.site, userId: null, teamId: 'team-1' };
    mocks.context.teams = [
      { id: 'team-1', name: '研究团队', members: [{ userId: 'user-1', role: 'team-member' }] },
    ];
    const { rerender } = render(<CorePages page="goal-editor" />);
    expect(screen.getByRole('button', { name: '保存目标' })).toBeEnabled();
    mocks.query['site-record'] = mocks.context.site;
    rerender(<CorePages page="website-settings" />);
    expect(screen.getByRole('button', { name: '保存基本信息' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '转移网站' })).toBeDisabled();
    rerender(<CorePages page="onboarding" />);
    expect(
      within(screen.getByLabelText('所属空间')).getByRole('option', { name: '研究团队' }),
    ).toBeInTheDocument();
  });
  it('only offers team-to-personal transfer to a team owner or admin', () => {
    mocks.context.user = { ...mocks.context.user, role: 'user', isAdmin: false };
    mocks.context.site = { ...mocks.context.site, userId: null, teamId: 'team-1' };
    mocks.context.teams = [
      { id: 'team-1', name: '研究团队', members: [{ userId: 'user-1', role: 'team-manager' }] },
    ];
    mocks.query['site-record'] = mocks.context.site;
    const { rerender } = render(<CorePages page="website-settings" />);
    expect(screen.getByRole('button', { name: '转移网站' })).toBeDisabled();
    mocks.context.teams[0].members[0].role = 'team-owner';
    rerender(<CorePages page="website-settings" />);
    expect(screen.getByRole('button', { name: '转移网站' })).toBeEnabled();
  });
  it('excludes team-member destinations from personal-to-team transfer', async () => {
    mocks.context.user = { ...mocks.context.user, role: 'user', isAdmin: false };
    mocks.context.teams = [
      { id: 'member-team', name: '成员团队', role: 'team-member' },
      { id: 'manager-team', name: '管理团队', role: 'team-manager' },
    ];
    mocks.query['site-record'] = mocks.context.site;
    const user = userEvent.setup();
    render(<CorePages page="website-settings" />);
    await user.click(screen.getByRole('button', { name: '转移网站' }));
    const select = screen.getByLabelText('目标空间');
    expect(within(select).getByRole('option', { name: '管理团队' })).toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: '成员团队' })).not.toBeInTheDocument();
  });
  it('shows conversion occurrences and a real series while calculating rate from distinct visitors', () => {
    mocks.query.goals = {
      data: [{ id: 'goal-1', name: '报名', parameters: { type: 'event', value: 'submit' } }],
      count: 1,
    };
    mocks.query['goal-results'] = [
      {
        id: 'goal-1',
        conversions: 386,
        num: 348,
        total: 10944,
        series: [
          { x: '2026-10-01', y: 120 },
          { x: '2026-10-02', y: 266 },
        ],
      },
    ];
    render(<CorePages page="goals" />);
    expect(screen.getAllByText('386')).toHaveLength(2);
    expect(screen.getAllByText('3.18%')).toHaveLength(2);
    expect(screen.getByRole('columnheader', { name: '转化次数' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '报名的转化趋势' })).toHaveTextContent('120,266');
  });
  it('honors enforced 2FA and does not offer simulator policy switches', () => {
    mocks.query['2fa-status'] = {
      isEnabled: true,
      isConfigured: true,
      isRequired: true,
      requiredReason: 'team',
    };
    render(<CorePages page="security" />);
    expect(screen.getByRole('button', { name: '关闭双重验证' })).toBeDisabled();
    expect(screen.getByText('团队强制启用')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
  it('clears the complete API key after its creation drawer closes', async () => {
    const persist = vi.spyOn(window.Storage.prototype, 'setItem');
    mocks.query['api-keys'] = [
      { id: 'key-1', name: '已有集成', keyPrefix: 'lk_prefix', createdAt: '2026-10-01T00:00:00Z' },
    ];
    mocks.post.mockResolvedValue({ key: 'lk_private_one_time_value' });
    const user = userEvent.setup();
    render(<CorePages page="api-keys" />);
    await user.click(screen.getByRole('button', { name: '创建密钥' }));
    await user.type(screen.getByLabelText(/密钥名称/), '新集成');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '创建密钥' }));
    expect(await screen.findByText('lk_private_one_time_value')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '已保存，关闭' }));
    expect(screen.queryByText('lk_private_one_time_value')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '创建密钥' }));
    expect(screen.queryByText('lk_private_one_time_value')).not.toBeInTheDocument();
    expect(persist).not.toHaveBeenCalled();
  });
  it('discards a delayed API key response after its creation drawer is closed', async () => {
    let resolve: (value: any) => void;
    mocks.query['api-keys'] = [];
    mocks.post.mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    );
    const user = userEvent.setup();
    render(<CorePages page="api-keys" />);
    await user.click(screen.getByRole('button', { name: '创建密钥' }));
    await user.type(screen.getByLabelText(/密钥名称/), '慢响应集成');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '创建密钥' }));
    await user.click(screen.getByRole('button', { name: '关闭弹层' }));
    resolve({ key: 'lk_delayed_private_value' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '创建密钥' }));
    expect(screen.getByLabelText(/密钥名称/)).toBeInTheDocument();
    expect(screen.queryByText('lk_delayed_private_value')).not.toBeInTheDocument();
  });
  it('persists an ordered funnel with event property conditions after moving a step', async () => {
    const user = userEvent.setup();
    mocks.context.route.id = 'funnel-1';
    mocks.query['funnel-definition'] = {
      id: 'funnel-1',
      name: '购买路径',
      description: '已有说明',
      parameters: {
        window: 30,
        steps: [
          { type: 'path', value: '/pricing' },
          {
            type: 'event',
            value: 'purchase',
            filters: [{ property: 'plan', operator: 'eq', value: 'pro' }],
          },
        ],
      },
    };
    mocks.post.mockResolvedValue({});
    render(<CorePages page="funnel-editor" />);
    await user.click(screen.getByRole('button', { name: '上移步骤 2' }));
    const first = document.querySelectorAll('.step-editor')[0] as HTMLElement;
    expect(within(first).getByDisplayValue('purchase')).toBeInTheDocument();
    expect(within(first).getByDisplayValue('plan')).toBeInTheDocument();
    fireEvent.change(within(first).getByLabelText('运算符'), { target: { value: 'dnc' } });
    await user.click(screen.getByRole('button', { name: '保存漏斗' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/websites/site-1/funnels/funnel-1', {
        name: '购买路径',
        description: '已有说明',
        parameters: {
          window: 30,
          steps: [
            {
              type: 'event',
              value: 'purchase',
              filters: [{ property: 'plan', operator: 'dnc', value: 'pro' }],
            },
            { type: 'path', value: '/pricing' },
          ],
        },
      }),
    );
  });
  it('requires a real persisted website before showing installation code', async () => {
    mocks.context.route.page = 'onboarding';
    mocks.post.mockResolvedValue({
      id: 'persisted-site-id',
      name: '研究站',
      domain: 'research.example.com',
      createdAt: '2026-10-01T00:00:00Z',
    });
    const user = userEvent.setup();
    render(<CorePages page="onboarding" />);
    expect(screen.queryByText(/data-website-id=/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/网站名称/), '研究站');
    await user.type(screen.getByLabelText(/域名/), 'research.example.com');
    await user.click(screen.getByRole('button', { name: '创建并继续' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/websites', {
        name: '研究站',
        domain: 'research.example.com',
      }),
    );
    expect(await screen.findByText(/data-website-id="persisted-site-id"/)).toBeInTheDocument();
  });
  it('runs login without the normal app provider and honors partial authentication', async () => {
    mocks.context = null;
    mocks.post.mockResolvedValue({ requiresTwoFactor: true, partialToken: 'partial' });
    mocks.login.mockReturnValue('/login/two-factor');
    const user = userEvent.setup();
    render(<FeatureAuthPage page="login" />);
    await user.type(screen.getByLabelText(/用户名/), 'admin');
    await user.type(screen.getByLabelText(/^密码/), 'secret');
    await user.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/login/two-factor'));
  });
  it('rejects unsafe SSO callbacks before verifying any token', async () => {
    mocks.context = null;
    mocks.params = new URLSearchParams({ token: 'callback-token', url: '//attacker.example' });
    render(<FeatureAuthPage page="sso" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('回调地址无效');
    expect(mocks.sso).not.toHaveBeenCalled();
  });
});
