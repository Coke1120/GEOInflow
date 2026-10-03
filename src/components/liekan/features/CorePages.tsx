'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  type CoreFunnelStep,
  conversionRate,
  featureNavigationPath,
  funnelPayload,
  goalPayload,
  recorderPayload,
  safeCallbackUrl,
  trackerSnippet,
} from '@/lib/liekan/contracts/core';
import { countOf, type FeatureEntity, numberLabel, rowsOf } from '@/lib/liekan/contracts/features';
import {
  acceptFeatureLogin,
  clearFeatureLogin,
  featureApi,
  getFeaturePreferences,
  saveFeaturePreferences,
  verifyFeatureSso,
  verifyFeatureTwoFactor,
} from '@/lib/liekan/upstream/features-client';
import { Chart } from './Chart';
import { useAction, useData, useFeature } from './context';
import {
  Badge,
  Body,
  Button,
  Check,
  Code,
  Definition,
  Drawer,
  Field,
  Form,
  Icon,
  LinkButton,
  Metrics,
  Notice,
  Panel,
  QueryState,
  Select,
  Switch,
  Table,
  Tabs,
  Textarea,
} from './ui';

const basePath = process.env.basePath || '';
const appPath = (path: string) => featureNavigationPath(path, basePath);
const formatDate = (value: any) => (value ? new Date(value).toLocaleString('zh-CN') : '尚未接收');
const sitePath = (id: string) => `/websites/${id}`;
const transientCodes = new Map<string, string[]>();

function PasswordField({
  label,
  name,
  minLength,
}: {
  label: string;
  name: string;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="field">
      <span>
        {label} <span className="required">*</span>
      </span>
      <span className="password-wrap">
        <input
          required
          name={name}
          type={visible ? 'text' : 'password'}
          minLength={minLength}
          autoComplete={
            name === 'password' || name === 'currentPassword' ? 'current-password' : 'new-password'
          }
        />
        <button
          type="button"
          aria-label={visible ? '隐藏密码' : '显示密码'}
          onClick={() => setVisible(!visible)}
        >
          <Icon name="eye" />
        </button>
      </span>
    </label>
  );
}

function useSiteRecord() {
  const c = useFeature();
  return useData(
    ['site-record', c.siteId],
    signal => c.api.get<FeatureEntity>(sitePath(c.siteId), undefined, signal),
    !!c.siteId,
  );
}
function useInstall(id: string, createdAt?: string) {
  const c = useFeature();
  return useData(
    ['install', id, createdAt],
    async signal => {
      const range = { startAt: createdAt ? new Date(createdAt).getTime() : 0, endAt: Date.now() };
      const [stats, dates] = await Promise.all([
        c.api.get(`${sitePath(id)}/stats`, range, signal),
        c.api.get(`${sitePath(id)}/daterange`, undefined, signal),
      ]);
      return {
        pageviews: countOf(stats.pageviews),
        lastAt: dates.endDate,
        firstAt: dates.startDate,
      };
    },
    !!id,
  );
}
function teamRole(c: ReturnType<typeof useFeature>, teamId: string) {
  const team = c.teams.find(team => team.id === teamId);
  return (
    team?.members?.find((member: any) => member.userId === c.user.id)?.role || team?.role || ''
  );
}
function canManageSite(c: ReturnType<typeof useFeature>, site: FeatureEntity) {
  if (!site || c.user.role === 'view-only') return false;
  if (c.user.isAdmin) return true;
  if (site.userId) return site.userId === c.user.id;
  return ['team-owner', 'team-manager', 'team-member'].includes(teamRole(c, site.teamId));
}
function teamCandidates(c: ReturnType<typeof useFeature>, permission: 'create' | 'transfer') {
  if (c.user.role === 'view-only') return [];
  const roles =
    permission === 'create'
      ? ['team-owner', 'team-manager', 'team-member']
      : ['team-owner', 'team-manager'];
  return c.teams.filter(team => c.user.isAdmin || roles.includes(teamRole(c, team.id)));
}
function canTransferSite(c: ReturnType<typeof useFeature>, site: FeatureEntity) {
  if (!site || c.user.role === 'view-only') return false;
  if (c.user.isAdmin) return !!site.teamId || teamCandidates(c, 'transfer').length > 0;
  if (site.teamId) return teamRole(c, site.teamId) === 'team-owner';
  return site.userId === c.user.id && teamCandidates(c, 'transfer').length > 0;
}
function MissingWebsite() {
  return (
    <Notice tone="amber">
      请选择一个网站后继续。
      <div className="form-actions">
        <LinkButton page="websites">网站管理</LinkButton>
        <LinkButton page="onboarding" primary>
          添加网站
        </LinkButton>
      </div>
    </Notice>
  );
}
function ReadonlyNotice() {
  return <Notice tone="amber">当前角色可以查看此配置。保存操作需要网站管理权限。</Notice>;
}

function TrackingCode({ websiteId, file = 'script.js' }: { websiteId: string; file?: string }) {
  const c = useFeature();
  const [tab, setTab] = useState('html');
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const snippet = origin ? trackerSnippet(origin, basePath, websiteId, tab, file) : '';
  return (
    <>
      <Tabs
        items={[
          ['html', 'HTML'],
          ['next', 'Next.js'],
          ['gtm', '标签管理器'],
        ]}
        active={tab}
        onChange={setTab}
      />
      <Code>{snippet || '正在生成安装代码…'}</Code>
      <div className="row">
        <Button
          disabled={!snippet}
          onClick={async () => {
            await navigator.clipboard.writeText(snippet);
            c.notify('安装代码已复制');
          }}
        >
          <Icon name="copy" />
          复制安装代码
        </Button>
        <span className="muted">使用当前网站标识与本实例地址。</span>
      </div>
    </>
  );
}
function InstallSteps({ query, websiteId }: { query: any; websiteId: string }) {
  const received = query.data?.pageviews > 0;
  return (
    <ul className="timeline">
      <li>
        <div className="row between">
          <strong>脚本加载</strong>
          <Badge key="badge" tone="gray">
            需浏览器核对
          </Badge>
        </div>
        <p>在目标网站的网络面板检查 script.js 加载和采集请求。</p>
      </li>
      <li>
        <div className="row between">
          <strong>网站标识</strong>
          <Badge key="badge" tone="blue">
            已生成
          </Badge>
        </div>
        <p>
          <code>{websiteId}</code>，请核对页面中的 data-website-id。
        </p>
      </li>
      <li>
        <div className="row between">
          <strong>首条访问</strong>
          <Badge key="badge" tone={received ? 'green' : 'gray'}>
            {query.isPending ? '正在检查' : received ? '已接收' : '等待'}
          </Badge>
        </div>
        <p>
          {received
            ? `最近接收：${formatDate(query.data.lastAt)}`
            : '安装代码后打开目标网站，再检查首条页面访问。'}
        </p>
      </li>
    </ul>
  );
}
function Websites() {
  const c = useFeature();
  const query = useData(['website-management-stats', c.sites.map(site => site.id)], async signal =>
    Promise.all(
      c.sites.map(async site => {
        try {
          const [stats, dates] = await Promise.all([
            c.api.get(`${sitePath(site.id)}/stats`, { ...c.range, ...c.filters }, signal),
            c.api.get(`${sitePath(site.id)}/daterange`, undefined, signal),
          ]);
          if (stats?.pageviews == null || !Number.isFinite(countOf(stats.pageviews)))
            throw new Error('统计响应缺少有效的访问次数。');
          return {
            id: site.id,
            views: countOf(stats.pageviews),
            received: !!dates.startDate,
            lastAt: dates.endDate,
          };
        } catch (error: any) {
          if (error.name === 'AbortError') throw error;
          return { id: site.id, error };
        }
      }),
    ),
  );
  const stats = query.data || [];
  const readable = stats.filter(row => !row.error);
  const ready = !query.isPending && !query.error && Array.isArray(query.data);
  const partial = ready && readable.length < c.sites.length;
  const hasSummary = ready && (readable.length > 0 || c.sites.length === 0);
  const installed = readable.filter(row => row.received).length;
  const unverified = readable.filter(row => !row.received).length;
  const totalViews = readable.reduce((sum, row) => sum + row.views, 0);
  const subtotal = `已读取 ${readable.length} / ${c.sites.length} 个网站的小计`;
  const errorLabel = (error: any) =>
    error.status === 401 ? '登录已过期' : error.status === 403 ? '无统计权限' : '读取失败';
  return (
    <>
      <Metrics
        items={[
          ['管理网站', String(c.sites.length), '个人与团队空间'],
          [
            '已接入',
            hasSummary ? String(installed) : '—',
            partial ? subtotal : '已收到首条访问',
            'green',
          ],
          [
            '待验证',
            hasSummary ? String(unverified) : '—',
            partial ? subtotal : '安装后验证接入',
            'blue',
          ],
          [
            '访问次数',
            hasSummary ? numberLabel(totalViews) : '—',
            partial ? `${subtotal} · 当前所选期间` : '当前所选期间',
          ],
        ]}
      />
      <Panel
        title="网站列表"
        subtitle="在当前角色有权访问的网站之间切换。"
        actions={
          c.user.role !== 'view-only' && (
            <LinkButton page="onboarding" primary>
              <Icon name="plus" />
              添加网站
            </LinkButton>
          )
        }
      >
        <QueryState query={query}>
          <Table
            columns={['网站', '所属空间', '接入状态', '访问次数', '最近接收', '操作']}
            numeric={[3]}
            search
            rows={c.sites.map(site => {
              const stat = stats.find(row => row.id === site.id);
              return [
                <>
                  <span className="table-title">{site.name}</span>
                  <span className="table-meta">{site.domain}</span>
                </>,
                c.teams.find(team => team.id === site.teamId)?.name ||
                  (site.teamId ? '团队空间' : '个人空间'),
                <Badge
                  key="badge"
                  tone={
                    stat?.error
                      ? [401, 403].includes(stat.error.status)
                        ? 'gray'
                        : 'red'
                      : stat?.received
                        ? 'green'
                        : 'amber'
                  }
                >
                  {stat?.error
                    ? errorLabel(stat.error)
                    : stat?.received
                      ? '已接入'
                      : stat
                        ? '待验证'
                        : '等待查询'}
                </Badge>,
                stat && !stat.error ? numberLabel(stat.views) : '—',
                stat?.error ? '无法读取' : stat ? formatDate(stat.lastAt) : '等待查询',
                <div className="actions" key="actions">
                  <LinkButton page="website-settings" params={{ websiteId: site.id }}>
                    设置
                  </LinkButton>
                  <LinkButton page="overview" params={{ websiteId: site.id }}>
                    查看统计
                  </LinkButton>
                </div>,
              ];
            })}
            empty="还没有网站。添加网站后安装专用跟踪代码。"
          />
        </QueryState>
      </Panel>
      {partial && (
        <Notice tone="amber">
          统计汇总尚未读全。卡片仅统计已读取的 {readable.length} / {c.sites.length}{' '}
          个网站，未读取网站的数值显示“—”。
          <div className="form-actions">
            <Button disabled={query.isFetching} onClick={() => query.refetch()}>
              重新读取统计
            </Button>
          </div>
        </Notice>
      )}
      <Notice>
        接入状态根据采集结果展示。新增网站在收到访问前显示“待验证”，访问次数保持为 0。
      </Notice>
    </>
  );
}
function Onboarding() {
  const c = useFeature(),
    action = useAction();
  const [created, setCreated] = useState<FeatureEntity>(null);
  const [step, setStep] = useState(1);
  const install = useInstall(created?.id, created?.createdAt);
  const teams = teamCandidates(c, 'create');
  return (
    <div className="wide-narrow">
      <Panel title="接入一个新网站" subtitle="三步完成创建、安装与验证。">
        <ol className="steps">
          {['网站信息', '安装脚本', '验证接入'].map((title, i) => (
            <li key={title} className={i + 1 === step ? 'on' : i + 1 < step ? 'done' : ''}>
              <span className="step-number">{i + 1 < step ? '✓' : i + 1}</span>
              {title}
            </li>
          ))}
        </ol>
        <Body>
          {step === 1 ? (
            <Form
              busy={action.busy}
              error={action.error}
              disabled={c.user.role === 'view-only'}
              submitLabel="创建并继续"
              cancel={<LinkButton page="websites">取消</LinkButton>}
              onSubmit={async values => {
                if (c.user.role === 'view-only') throw new Error('当前角色没有创建网站权限。');
                const site = await action.run(
                  () =>
                    c.api.post<FeatureEntity>('/websites', {
                      name: values.name,
                      domain: values.domain,
                      ...(values.space && { teamId: values.space }),
                    }),
                  '网站已创建',
                );
                setCreated(site);
                setStep(2);
              }}
            >
              {c.user.role === 'view-only' && (
                <Notice tone="amber">当前角色没有创建网站权限。</Notice>
              )}
              <div className="form-grid">
                <Field
                  label="网站名称"
                  name="name"
                  required
                  maxLength={100}
                  help="显示在侧栏和管理列表中。"
                />
                <Field
                  label="域名"
                  name="domain"
                  required
                  maxLength={500}
                  help="输入域名，如 example.com，无需 https://。"
                />
              </div>
              <Select
                label="所属空间"
                name="space"
                options={[
                  ['', '个人空间'],
                  ...teams.map(team => [team.id, team.name] as [string, string]),
                ]}
              />
              <Notice tone="blue">
                下一步会生成当前网站专用代码。网站名称和域名可在设置中修改。
              </Notice>
            </Form>
          ) : step === 2 ? (
            <>
              <Notice tone="blue">
                网站已创建，接入状态为待验证。将下方脚本放入每个需要统计页面的 head 区域。
              </Notice>
              <TrackingCode websiteId={created.id} />
              <div className="form-actions">
                <LinkButton page="website-settings" params={{ websiteId: created.id }}>
                  编辑网站信息
                </LinkButton>
                <Button primary onClick={() => setStep(3)}>
                  已安装，开始验证
                </Button>
              </div>
            </>
          ) : (
            <>
              <Definition
                items={[
                  ['网站名称', created.name],
                  ['域名', created.domain],
                  [
                    '接入状态',
                    <Badge key="badge" tone={install.data?.pageviews > 0 ? 'green' : 'amber'}>
                      {install.data?.pageviews > 0 ? '验证完成' : '待验证'}
                    </Badge>,
                  ],
                ]}
              />
              <hr className="divider" />
              <QueryState query={install}>
                <InstallSteps query={install} websiteId={created.id} />
              </QueryState>
              <div className="form-actions">
                <Button onClick={() => setStep(2)}>返回安装代码</Button>
                <Button primary disabled={install.isFetching} onClick={() => install.refetch()}>
                  检查真实访问
                </Button>
                {install.data?.pageviews > 0 && (
                  <LinkButton page="websites" primary>
                    进入网站管理
                  </LinkButton>
                )}
              </div>
            </>
          )}
        </Body>
      </Panel>
      <Panel title="接入说明" subtitle="从访问统计开始，逐步开启行为采集。">
        <Body>
          <ol style={{ paddingLeft: 20 }} className="stack">
            <li>HTML 和常见框架使用同一网站标识。</li>
            <li>首次接入后打开网站，等待首条访问。</li>
            <li>回放与热力图需另外开启行为采集。</li>
          </ol>
          <hr className="divider" />
          <LinkButton page="tracking" params={created ? { websiteId: created.id } : undefined}>
            查看安装说明
          </LinkButton>
          <LinkButton
            page="recorder-settings"
            params={created ? { websiteId: created.id } : undefined}
          >
            采集与隐私设置
          </LinkButton>
        </Body>
      </Panel>
    </div>
  );
}
function Tracking({ check = false }: { check?: boolean }) {
  const c = useFeature(),
    site = useSiteRecord();
  const install = useInstall(c.siteId, site.data?.createdAt);
  if (!c.siteId) return <MissingWebsite />;
  if (check)
    return (
      <Panel title="安装诊断" subtitle="根据本实例收到的真实访问检查接入状态。">
        <Body>
          <QueryState query={site}>
            <div className="row between">
              <Definition
                items={[
                  ['网站', site.data?.name],
                  ['域名', site.data?.domain],
                ]}
              />
              <Button primary disabled={install.isFetching} onClick={() => install.refetch()}>
                重新检查
              </Button>
            </div>
          </QueryState>
          <hr className="divider" />
          <QueryState query={install}>
            <InstallSteps query={install} websiteId={c.siteId} />
            <hr className="divider" />
            <Notice tone={install.data?.pageviews > 0 ? 'blue' : 'amber'}>
              {install.data?.pageviews > 0
                ? '已收到页面访问。脚本加载情况仍需在目标网站的浏览器中核对。'
                : '尚未收到访问。安装代码后打开目标网站，再检查首条页面访问。'}
            </Notice>
          </QueryState>
          <div className="form-actions">
            <LinkButton page="tracking">查看跟踪代码</LinkButton>
            <LinkButton page="websites">返回网站管理</LinkButton>
          </div>
        </Body>
      </Panel>
    );
  return (
    <div className="wide-narrow">
      <Panel title="安装跟踪代码" subtitle="网站标识和现有采集协议保持兼容。">
        <Body>
          <TrackingCode websiteId={c.siteId} />
          <hr className="divider" />
          <h3>自定义事件示例</h3>
          <p className="muted">用于目标、漏斗和事件属性分析。</p>
          <Code>{"umami.track('demo_submit', { plan: 'growth', placement: 'header' });"}</Code>
          <div className="form-actions">
            <LinkButton page="install-check" primary>
              验证接入
            </LinkButton>
          </div>
        </Body>
      </Panel>
      <Panel title="常见接入问题" subtitle="检查顺序与验证结果一致。">
        <Body>
          <div className="stack">
            <div>
              <h3>单页应用</h3>
              <p className="muted">默认跟踪路由变化，保留 Umami SDK 接口。</p>
            </div>
            <div>
              <h3>内容安全策略</h3>
              <p className="muted">允许统计服务的脚本与采集请求域名。</p>
            </div>
            <div>
              <h3>本地验证</h3>
              <p className="muted">检查脚本加载、网站标识和采集响应。</p>
            </div>
          </div>
          <hr className="divider" />
          <LinkButton page="recorder-settings">行为采集设置</LinkButton>
        </Body>
      </Panel>
    </div>
  );
}
function WebsiteSettings() {
  const c = useFeature(),
    query = useSiteRecord(),
    action = useAction();
  const install = useInstall(c.siteId, query.data?.createdAt);
  const [drawer, setDrawer] = useState('');
  const site = query.data,
    manage = canManageSite(c, site),
    teams = teamCandidates(c, 'transfer'),
    transfer = canTransferSite(c, site);
  if (!c.siteId) return <MissingWebsite />;
  return (
    <QueryState query={query}>
      {site && (
        <>
          <div className="two">
            <Panel title="基本信息" subtitle="编辑名称和域名不改变网站标识。">
              <Body>
                {!manage && <ReadonlyNotice />}
                <Form
                  key={`${site.id}:${site.name}:${site.domain}`}
                  busy={action.busy}
                  error={action.error}
                  disabled={!manage}
                  submitLabel="保存基本信息"
                  onSubmit={async values => {
                    if (!manage) throw new Error('需要网站管理权限。');
                    await action.run(() =>
                      c.api.post(sitePath(site.id), { name: values.name, domain: values.domain }),
                    );
                  }}
                >
                  <Field
                    label="网站 ID"
                    name="id"
                    defaultValue={site.id}
                    readOnly
                    help="当前网站的永久标识。"
                  />
                  <Field
                    label="网站名称"
                    name="name"
                    defaultValue={site.name}
                    required
                    readOnly={!manage}
                    maxLength={100}
                  />
                  <Field
                    label="域名"
                    name="domain"
                    defaultValue={site.domain}
                    required
                    readOnly={!manage}
                    maxLength={500}
                  />
                </Form>
              </Body>
            </Panel>
            <Panel title="安装与协作" subtitle="同一网站在各分析页面使用一致的数据范围。">
              <Body>
                <div className="stack">
                  <Definition
                    items={[
                      [
                        '所属空间',
                        c.teams.find(team => team.id === site.teamId)?.name ||
                          (site.teamId ? '团队空间' : '个人空间'),
                      ],
                      [
                        '接入状态',
                        <Badge key="badge" tone={install.data?.pageviews > 0 ? 'green' : 'amber'}>
                          {install.data?.pageviews > 0 ? '已接入' : '待验证'}
                        </Badge>,
                      ],
                      ['公开分享', site.shareId ? '已启用' : '未启用'],
                    ]}
                  />
                  <div className="row">
                    <LinkButton page="tracking">跟踪代码</LinkButton>
                    <LinkButton page="sharing">分享设置</LinkButton>
                    <LinkButton page="recorder-settings">行为采集</LinkButton>
                  </div>
                </div>
              </Body>
            </Panel>
            <Panel title="转移网站" subtitle="保留历史数据，变更资源所属空间。">
              <Body>
                <p className="muted">只有拥有相应团队管理权限的成员可以转移网站。</p>
                <div className="form-actions">
                  <Button disabled={!transfer} onClick={() => setDrawer('transfer')}>
                    转移网站
                  </Button>
                </div>
              </Body>
            </Panel>
            <Panel title="数据管理" subtitle="重置和删除操作需要额外确认。">
              <Body>
                <div className="switch-row">
                  <div>
                    <strong>重置数据</strong>
                    <p className="muted">清空访问与事件数据，保留网站设置。</p>
                  </div>
                  <Button disabled={!manage} onClick={() => setDrawer('reset')}>
                    重置
                  </Button>
                </div>
                <div className="switch-row">
                  <div>
                    <strong>删除网站</strong>
                    <p className="muted">删除网站及其数据，确认页显示影响范围。</p>
                  </div>
                  <Button danger disabled={!manage} onClick={() => setDrawer('delete')}>
                    删除
                  </Button>
                </div>
              </Body>
            </Panel>
          </div>
          {drawer && (
            <Drawer
              title={
                drawer === 'transfer'
                  ? '转移网站所属空间'
                  : drawer === 'reset'
                    ? '重置网站数据'
                    : '删除网站'
              }
              onClose={() => setDrawer('')}
            >
              <Form
                busy={action.busy}
                error={action.error}
                disabled={drawer === 'transfer' ? !transfer : !manage}
                submitLabel={drawer === 'transfer' ? '确认转移' : '确认操作'}
                onSubmit={async values => {
                  if (!manage) throw new Error('需要网站管理权限。');
                  if (drawer === 'transfer') {
                    if (
                      !transfer ||
                      (!site.teamId && !teams.some(team => team.id === values.teamId))
                    )
                      throw new Error('需要相应的网站转移权限。');
                    await action.run(
                      () =>
                        c.api.post(
                          `${sitePath(site.id)}/transfer`,
                          site.teamId ? { userId: c.user.id } : { teamId: values.teamId },
                        ),
                      '网站已转移',
                    );
                  } else {
                    const expected = drawer === 'reset' ? 'RESET' : site.name;
                    if (values.confirmation !== expected) throw new Error('确认内容不匹配。');
                    await action.run(
                      () =>
                        drawer === 'reset'
                          ? c.api.post(`${sitePath(site.id)}/reset`)
                          : c.api.del(sitePath(site.id)),
                      drawer === 'reset' ? '网站数据已重置' : '网站已删除',
                    );
                  }
                  setDrawer('');
                  await c.refresh();
                  if (drawer === 'delete') c.navigate('websites');
                }}
              >
                {drawer === 'transfer' ? (
                  <>
                    <Field
                      label="当前空间"
                      value={
                        site.teamId
                          ? c.teams.find(team => team.id === site.teamId)?.name || '团队空间'
                          : '个人空间'
                      }
                      readOnly
                    />
                    {site.teamId ? (
                      <Notice tone="amber">
                        网站将转移到当前账户的个人空间。网站标识和历史数据保持一致。
                      </Notice>
                    ) : (
                      <>
                        <Select
                          label="目标空间"
                          name="teamId"
                          options={teams.map(team => [team.id, team.name])}
                          required
                        />
                        <Notice tone="amber">仅可转移到当前账户拥有管理权限的团队。</Notice>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <Notice tone="red">
                      {drawer === 'reset'
                        ? `将清空「${site.name}」的访问、事件与会话数据，保留网站和安装标识。`
                        : `将删除「${site.name}」及其访问数据。此操作无法恢复。`}
                    </Notice>
                    <Field
                      label={`输入 ${drawer === 'reset' ? 'RESET' : site.name} 确认`}
                      name="confirmation"
                      required
                      autoComplete="off"
                    />
                  </>
                )}
              </Form>
            </Drawer>
          )}
        </>
      )}
    </QueryState>
  );
}
function RecorderSettings() {
  const c = useFeature(),
    query = useSiteRecord(),
    action = useAction();
  const config = query.data?.replayConfig || {},
    manage = canManageSite(c, query.data);
  if (!c.siteId) return <MissingWebsite />;
  return (
    <div className="wide-narrow">
      <Panel title="回放与热力图" subtitle="先选择采集能力，再设置采样与隐私规则。">
        <Body>
          <QueryState query={query}>
            {query.data && (
              <Form
                key={`${c.siteId}:${JSON.stringify(config)}`}
                busy={action.busy}
                error={action.error}
                disabled={!manage}
                submitLabel="保存采集配置"
                onSubmit={async values => {
                  if (!manage) throw new Error('需要网站管理权限。');
                  await action.run(() => c.api.post(sitePath(c.siteId), recorderPayload(values)));
                }}
              >
                {!manage && <ReadonlyNotice />}
                <Switch
                  label="启用会话回放"
                  help="录制访问过程，默认遮蔽输入内容。"
                  name="replay"
                  defaultChecked={config.replayEnabled === true}
                  disabled={!manage}
                />
                <Switch
                  label="启用热力图"
                  help="记录点击与滚动，按页面聚合。"
                  name="heatmap"
                  defaultChecked={config.heatmapEnabled === true}
                  disabled={!manage}
                />
                <div className="form-grid">
                  <Field
                    label="回放采样率 (%)"
                    name="replayRate"
                    type="number"
                    defaultValue={(config.sampleRate ?? 0.15) * 100}
                    min={5}
                    max={100}
                    step={1}
                    required
                    readOnly={!manage}
                    help="范围 5% 至 100%。"
                  />
                  <Field
                    label="热力图采样率 (%)"
                    name="heatRate"
                    type="number"
                    defaultValue={(config.heatmapSampleRate ?? 0.15) * 100}
                    min={5}
                    max={100}
                    step={1}
                    required
                    readOnly={!manage}
                    help="范围 5% 至 100%。"
                  />
                  <Select
                    label="隐私遮蔽级别"
                    name="mask"
                    options={[
                      ['strict', '严格：遮蔽文字与输入'],
                      ['moderate', '标准：遮蔽输入内容'],
                    ]}
                    defaultValue={config.maskLevel || 'moderate'}
                    disabled={!manage}
                  />
                  <Select
                    label="最长录制时长"
                    name="duration"
                    options={[
                      ['5', '5 分钟'],
                      ['10', '10 分钟'],
                      ['15', '15 分钟'],
                      ['20', '20 分钟'],
                    ]}
                    defaultValue={String((config.maxDuration || 300000) / 60000)}
                    disabled={!manage}
                  />
                </div>
                <Field
                  label="排除元素选择器"
                  name="blockSelector"
                  defaultValue={config.blockSelector || ''}
                  help="匹配元素不进入回放。"
                  readOnly={!manage}
                />
                <TrackingCode websiteId={c.siteId} file="recorder.js" />
              </Form>
            )}
          </QueryState>
        </Body>
      </Panel>
      <Panel title="采集范围" subtitle="按保存后的采样与隐私配置采集。">
        <Body>
          <Notice tone="amber">
            新网站默认关闭行为采集。开启后安装
            recorder.js，输入内容按配置遮蔽。数据在收到真实访问后展示。
          </Notice>
          <hr className="divider" />
          <div className="stack">
            <LinkButton page="heatmaps">查看热力图</LinkButton>
            <LinkButton page="replays">查看会话回放</LinkButton>
            <LinkButton page="tracking">跟踪代码</LinkButton>
          </div>
        </Body>
      </Panel>
    </div>
  );
}

export function FeatureAuthPage({ page }: { page: 'login' | 'login-2fa' | 'sso' }) {
  const router = useRouter(),
    search = useSearchParams();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [method, setMethod] = useState('otp');
  const [lockedUntil, setLockedUntil] = useState(0),
    [now, setNow] = useState(Date.now());
  const started = useRef(false);
  useEffect(() => {
    if (page === 'login-2fa' && !sessionStorage.getItem('umami.partial-token'))
      router.replace('/login');
  }, [page, router]);
  useEffect(() => {
    if (!lockedUntil) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [lockedUntil]);
  useEffect(() => {
    if (page !== 'sso' || started.current) return;
    const token = search.get('token'),
      url = safeCallbackUrl(search.get('url'));
    if (!token) {
      setError('未收到身份提供方返回的登录凭据。请重新发起登录。');
      return;
    }
    if (!url) {
      setError('回调地址无效。请重新发起登录。');
      return;
    }
    started.current = true;
    setBusy(true);
    verifyFeatureSso(token)
      .then(() => router.replace(appPath(url)))
      .catch((error: any) => {
        clearFeatureLogin();
        setError(error.message || '单点登录验证失败。');
      })
      .finally(() => setBusy(false));
  }, [page, search, router]);
  async function submit(values: Record<string, string>) {
    setBusy(true);
    setError('');
    try {
      const response =
        page === 'login'
          ? await featureApi.post('/auth/login', {
              username: values.username,
              password: values.password,
            })
          : await verifyFeatureTwoFactor(
              method === 'backup' ? { backupCode: values.token } : { token: values.token },
            );
      router.replace(appPath(acceptFeatureLogin(response)));
    } catch (error: any) {
      const locked = error.details?.lockedUntil || error.lockedUntil;
      if (locked) setLockedUntil(new Date(locked).getTime());
      setError(error.message || '登录失败，请重试。');
      throw error;
    } finally {
      setBusy(false);
    }
  }
  const locked = lockedUntil > now;
  const title = page === 'login' ? '欢迎回来' : page === 'login-2fa' ? '验证登录' : '单点登录';
  const description =
    page === 'login'
      ? '登录猎看统计，查看 AI 与搜索流量。'
      : page === 'login-2fa'
        ? '完成验证后进入工作台。'
        : '正在等待身份提供方回调。';
  return (
    <div data-liekan-features>
      <div className="auth-page">
        <aside className="auth-info">
          <Link className="auth-brand" href="/">
            <img src={`${basePath}/liekan/features/logo.svg`} alt="" />
            <span className="brand-name" style={{ color: 'var(--ink)' }}>
              猎看统计<span className="brand-caption">LIEKAN GEO STATS</span>
            </span>
          </Link>
          <div className="auth-intro">
            <h1>
              从 AI 与搜索访问，
              <br />
              看见内容的增长路径
            </h1>
            <p>把访问来源、内容表现和目标转化放在同一处，理解每一步增长。</p>
            <div className="auth-feature">
              AI 引荐 · 传统搜索 · 内容转化
              <br />
              猎看统计
            </div>
          </div>
          <small>Liekan · MIT 开源</small>
        </aside>
        <main className="auth-main" id="main-content">
          <div className="auth-form">
            <Badge key="badge" tone="blue">
              猎看统计
            </Badge>
            <h1>{title}</h1>
            <p className="sub">{description}</p>
            {page === 'sso' ? (
              <>
                <div style={{ margin: '24px 0' }}>
                  <Notice tone={error ? 'red' : 'blue'}>
                    {error || (busy ? '正在验证登录凭据。' : '等待登录验证。')}
                  </Notice>
                </div>
                <div className="stack">
                  <Link className="btn" href="/login">
                    返回用户名登录
                  </Link>
                </div>
              </>
            ) : (
              <>
                {page === 'login-2fa' && (
                  <Tabs
                    items={[
                      ['otp', '验证器验证码'],
                      ['backup', '恢复码'],
                    ]}
                    active={method}
                    onChange={value => {
                      setMethod(value);
                      setError('');
                    }}
                  />
                )}
                {locked && (
                  <Notice tone="amber">
                    尝试次数过多，请在 {formatDate(lockedUntil)} 后重试。
                  </Notice>
                )}
                <Form
                  key={method}
                  onSubmit={submit}
                  busy={busy || locked}
                  error={error}
                  submitLabel={page === 'login' ? '登录' : '确认登录'}
                  cancel={
                    page === 'login-2fa' ? (
                      <Link className="btn" href="/login">
                        返回登录
                      </Link>
                    ) : undefined
                  }
                >
                  {page === 'login' ? (
                    <>
                      <Field label="用户名" name="username" autoComplete="username" required />
                      <PasswordField label="密码" name="password" />
                    </>
                  ) : (
                    <Field
                      label={method === 'backup' ? '恢复码' : '6 位验证码'}
                      name="token"
                      required
                      autoComplete={method === 'backup' ? 'off' : 'one-time-code'}
                      inputMode={method === 'backup' ? 'text' : 'numeric'}
                      maxLength={method === 'backup' ? undefined : 6}
                      minLength={method === 'backup' ? 1 : 6}
                      pattern={method === 'backup' ? undefined : '[0-9]{6}'}
                      className={method === 'backup' ? '' : 'otp'}
                      help={
                        method === 'backup'
                          ? '每个恢复码仅能使用一次。'
                          : '输入验证器当前显示的验证码。'
                      }
                    />
                  )}
                </Form>
              </>
            )}
            <div className="auth-bottom">
              <span>猎看统计</span>
              <span>使用当前实例账户</span>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function Account() {
  const c = useFeature(),
    action = useAction();
  const [drawer, setDrawer] = useState('');
  return (
    <>
      <div className="two">
        <Panel title="账户信息" subtitle="当前身份与角色。">
          <Body>
            <Definition
              items={[
                ['用户名', c.user.username],
                [
                  '角色',
                  <Badge key="badge" tone="blue">
                    {c.user.isAdmin
                      ? '系统管理员'
                      : c.user.role === 'view-only'
                        ? '只读用户'
                        : '用户'}
                  </Badge>,
                ],
                ['所属团队', c.teams.map(team => team.name).join('、') || '尚未加入团队'],
                ['账户来源', '当前实例账户'],
              ]}
            />
            <div className="form-actions">
              <Button disabled={!c.user.isAdmin} onClick={() => setDrawer('username')}>
                修改用户名
              </Button>
            </div>
            {!c.user.isAdmin && <p className="field-help">用户名由系统管理员维护。</p>}
          </Body>
        </Panel>
        <Panel title="登录密码" subtitle="已修改的密码会保留。">
          <Body>
            <p className="muted">修改时需要当前密码，新密码至少 8 位。</p>
            <div className="form-actions">
              <Button primary onClick={() => setDrawer('password')}>
                修改密码
              </Button>
            </div>
          </Body>
        </Panel>
        <Panel title="安全与偏好" subtitle="管理双重验证和集成密钥。">
          <Body>
            <div className="row">
              <LinkButton page="security">账户安全</LinkButton>
              <LinkButton page="api-keys">API Key</LinkButton>
              <LinkButton page="preferences">偏好设置</LinkButton>
            </div>
          </Body>
        </Panel>
      </div>
      {drawer && (
        <Drawer
          title={drawer === 'username' ? '修改用户名' : '修改密码'}
          onClose={() => setDrawer('')}
        >
          <Form
            busy={action.busy}
            error={action.error}
            submitLabel={drawer === 'password' ? '保存密码' : '保存'}
            onSubmit={async values => {
              if (drawer === 'username') {
                if (!c.user.isAdmin) throw new Error('用户名由系统管理员维护。');
                await action.run(() =>
                  c.api.post(`/users/${c.user.id}`, { username: values.username }),
                );
                await c.refresh();
              } else {
                if (values.newPassword !== values.confirmPassword)
                  throw new Error('两次输入的新密码不一致。');
                await action.run(
                  () =>
                    c.api.post('/me/password', {
                      currentPassword: values.currentPassword,
                      newPassword: values.newPassword,
                    }),
                  '密码已更新，请重新登录',
                );
                clearFeatureLogin();
                window.location.assign(`${basePath}/login`);
              }
              setDrawer('');
            }}
          >
            {drawer === 'username' ? (
              <Field
                label="用户名"
                name="username"
                defaultValue={c.user.username}
                required
                maxLength={255}
              />
            ) : (
              <>
                <PasswordField label="当前密码" name="currentPassword" />
                <PasswordField label="新密码" name="newPassword" minLength={8} />
                <PasswordField label="确认新密码" name="confirmPassword" minLength={8} />
              </>
            )}
          </Form>
        </Drawer>
      )}
    </>
  );
}
function Security() {
  const c = useFeature(),
    action = useAction();
  const status = useData('2fa-status', signal => c.api.get('/2fa/status', undefined, signal));
  const [disable, setDisable] = useState(false);
  const data = status.data;
  return (
    <QueryState query={status}>
      {data && (
        <>
          <div className="wide-narrow">
            <Panel title="双重验证" subtitle="在密码之外增加验证器验证码。">
              <Body>
                <div className="row between">
                  <strong>当前状态</strong>
                  <Badge key="badge" tone={data.isEnabled ? 'green' : 'gray'}>
                    {data.isEnabled ? '已启用' : '未启用'}
                  </Badge>
                </div>
                <hr className="divider" />
                {data.isRequired ? (
                  <Notice tone="amber">
                    当前系统、账户或团队要求启用双重验证，账户无法自行关闭。
                  </Notice>
                ) : (
                  <Notice>启用后，登录流程会要求验证码。恢复码用于无法访问验证器的情况。</Notice>
                )}
                <div className="form-actions">
                  {data.isEnabled ? (
                    <Button
                      disabled={data.isRequired || !data.isConfigured}
                      onClick={() => setDisable(true)}
                    >
                      关闭双重验证
                    </Button>
                  ) : data.isConfigured ? (
                    <LinkButton page="two-factor" primary>
                      启用双重验证
                    </LinkButton>
                  ) : (
                    <Button disabled>启用双重验证</Button>
                  )}
                </div>
              </Body>
            </Panel>
            <Panel title="策略状态" subtitle="读取当前实例与账户的安全策略。">
              <Body>
                {!data.isConfigured ? (
                  <Notice tone="red">
                    服务尚未配置双重验证加密密钥。请由系统管理员完成配置后启用。
                  </Notice>
                ) : (
                  <Definition
                    items={[
                      [
                        '加密配置',
                        <Badge key="badge" tone="green">
                          已配置
                        </Badge>,
                      ],
                      [
                        '启用要求',
                        data.isRequired
                          ? data.requiredReason === 'team'
                            ? '团队强制启用'
                            : data.requiredReason === 'user'
                              ? '账户强制启用'
                              : '系统强制启用'
                          : '自主选择',
                      ],
                    ]}
                  />
                )}
              </Body>
            </Panel>
          </div>
          {disable && (
            <Drawer title="关闭双重验证" onClose={() => setDisable(false)}>
              <Form
                busy={action.busy}
                error={action.error}
                submitLabel="确认关闭"
                onSubmit={async values => {
                  if (data.isRequired) throw new Error('当前策略要求启用双重验证。');
                  await action.run(
                    () =>
                      c.api.post('/2fa/disable', {
                        password: values.currentPassword,
                        token: values.token,
                      }),
                    '双重验证已关闭',
                  );
                  setDisable(false);
                }}
              >
                <Notice tone="amber">
                  关闭后登录只使用密码。系统、账户或团队强制要求时无法关闭。
                </Notice>
                <PasswordField label="当前密码" name="currentPassword" />
                <Field
                  label="6 位验证码"
                  name="token"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  minLength={6}
                  maxLength={6}
                  autoComplete="one-time-code"
                  required
                />
              </Form>
            </Drawer>
          )}
        </>
      )}
    </QueryState>
  );
}
function TwoFactor() {
  const c = useFeature(),
    action = useAction();
  const [setup, setSetup] = useState<any>(null);
  const setupGeneration = useRef(0);
  const phase = useRef<'idle' | 'initiating' | 'confirming' | 'canceling'>('idle');
  useEffect(
    () => () => {
      setupGeneration.current += 1;
    },
    [],
  );
  async function cancelSetup() {
    if (action.busy || phase.current !== 'idle') return;
    const generation = ++setupGeneration.current;
    phase.current = 'canceling';
    try {
      await action.run(() => c.api.post('/2fa/setup/cancel'), '已取消绑定');
      if (generation !== setupGeneration.current) return;
      setSetup(null);
      c.navigate('security');
    } finally {
      phase.current = 'idle';
    }
  }
  const status = useData('2fa-status', signal => c.api.get('/2fa/status', undefined, signal));
  return (
    <Panel title="设置验证器" subtitle="绑定、确认、保存恢复码。">
      <Body>
        <div className="steps">
          <span className="blue">① 绑定验证器</span>
          <span style={{ margin: '0 20px' }}>② 验证代码</span>
          <span>③ 保存恢复码</span>
        </div>
        <QueryState query={status}>
          {status.data?.isEnabled ? (
            <Notice tone="blue">
              双重验证已启用。<LinkButton page="security">返回账户安全</LinkButton>
            </Notice>
          ) : !status.data?.isConfigured ? (
            <Notice tone="red">服务尚未配置双重验证加密密钥。请由系统管理员完成配置后启用。</Notice>
          ) : !setup ? (
            <div className="form-actions">
              <Button
                primary
                disabled={action.busy}
                onClick={async () => {
                  if (phase.current !== 'idle') return;
                  const generation = ++setupGeneration.current;
                  phase.current = 'initiating';
                  try {
                    const result = await action.run(
                      () => c.api.post('/2fa/setup/initiate'),
                      '绑定信息已生成',
                    );
                    if (generation === setupGeneration.current) setSetup(result);
                  } finally {
                    phase.current = 'idle';
                  }
                }}
              >
                生成绑定信息
              </Button>
              <Button disabled={action.busy} onClick={cancelSetup}>
                取消
              </Button>
            </div>
          ) : (
            <>
              <div className="row" style={{ margin: '24px 0' }}>
                <img
                  src={setup.qrCodeDataUrl}
                  alt="用于绑定验证器的二维码"
                  width={180}
                  height={180}
                />
                <div>
                  <h3>使用验证器扫描</h3>
                  <p className="muted">也可以在验证器中手动输入下方密钥。</p>
                  <p style={{ margin: '10px 0' }}>
                    <code>{setup.manualKey}</code>
                  </p>
                  <Button
                    onClick={async () => {
                      await navigator.clipboard.writeText(setup.manualKey);
                      c.notify('绑定密钥已复制');
                    }}
                  >
                    复制密钥
                  </Button>
                </div>
              </div>
              <Form
                busy={action.busy}
                error={action.error}
                submitLabel="验证并继续"
                cancel={
                  <Button disabled={action.busy} onClick={cancelSetup}>
                    取消
                  </Button>
                }
                onSubmit={async values => {
                  if (phase.current !== 'idle') return;
                  phase.current = 'confirming';
                  try {
                    const result = await action.run(
                      () => c.api.post('/2fa/setup/confirm', { token: values.token }),
                      '双重验证已启用',
                    );
                    transientCodes.set(c.user.id, result.backupCodes);
                    setSetup(null);
                    c.navigate('backup-codes');
                  } finally {
                    phase.current = 'idle';
                  }
                }}
              >
                <Field
                  label="6 位验证码"
                  name="token"
                  required
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  minLength={6}
                  maxLength={6}
                  autoComplete="one-time-code"
                  className="otp"
                  help="输入验证器当前显示的验证码。"
                />
              </Form>
            </>
          )}
        </QueryState>
      </Body>
    </Panel>
  );
}
function BackupCodes() {
  const c = useFeature();
  const [codes] = useState(() => {
    return transientCodes.get(c.user.id) || [];
  });
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    transientCodes.delete(c.user.id);
  }, [c.user.id]);
  return (
    <Panel title="双重验证已启用" subtitle="保存恢复码后完成设置。">
      <Body>
        {codes.length ? (
          <>
            <Notice tone="amber">
              恢复码只在本次设置完成时展示。每个恢复码仅能使用一次，请妥善保管。
            </Notice>
            <div className="backup-grid" style={{ margin: '20px 0' }}>
              {codes.map(code => (
                <code className="backup-code" key={code}>
                  {code}
                </code>
              ))}
            </div>
            <Button
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([codes.join('\n')], { type: 'text/plain;charset=utf-8' }),
                );
                const a = document.createElement('a');
                a.href = url;
                a.download = 'liekan-backup-codes.txt';
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              下载恢复码
            </Button>
            <div style={{ marginTop: 16 }}>
              <Check
                label="我已妥善保存恢复码"
                checked={saved}
                onChange={event => setSaved(event.target.checked)}
              />
            </div>
            <div className="form-actions">
              <Button primary disabled={!saved} onClick={() => c.navigate('security')}>
                完成设置
              </Button>
            </div>
          </>
        ) : (
          <>
            <Notice tone="amber">
              本次页面没有可展示的恢复码。恢复码仅在启用验证后的当前会话中展示。
            </Notice>
            <div className="form-actions">
              <LinkButton page="security">返回账户安全</LinkButton>
            </div>
          </>
        )}
      </Body>
    </Panel>
  );
}
function ApiKeys() {
  const c = useFeature(),
    action = useAction();
  const query = useData('api-keys', signal => c.api.get('/me/api-keys', undefined, signal));
  const [drawer, setDrawer] = useState<any>(null),
    [createdKey, setCreatedKey] = useState('');
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );
  const open = (next: any) => {
    generation.current += 1;
    setCreatedKey('');
    setDrawer({ ...next, generation: generation.current });
  };
  if ((query.error as any)?.status === 404)
    return (
      <Panel title="集成密钥" subtitle="密钥继承账户权限，完整值仅在创建时显示一次。">
        <Body>
          <Notice tone="amber">当前实例未启用 API Key。请由管理员开启后使用。</Notice>
        </Body>
      </Panel>
    );
  const close = () => {
    generation.current += 1;
    setDrawer(null);
    setCreatedKey('');
  };
  return (
    <>
      <Panel
        title="集成密钥"
        subtitle="密钥继承账户权限，完整值仅在创建时显示一次。"
        actions={
          <Button
            primary
            disabled={query.isPending || !!query.error}
            onClick={() => open({ type: 'create' })}
          >
            <Icon name="plus" />
            创建密钥
          </Button>
        }
      >
        <QueryState query={query}>
          <Table
            columns={['名称', '密钥', '创建时间', '最近使用', '操作']}
            search
            rows={rowsOf<any>(query.data).map(key => [
              key.name,
              <code key="prefix">{key.keyPrefix}••••</code>,
              formatDate(key.createdAt),
              key.lastUsedAt ? formatDate(key.lastUsedAt) : '尚未使用',
              <Button key="revoke" onClick={() => open({ type: 'revoke', key })}>
                撤销
              </Button>,
            ])}
            empty="尚未创建集成密钥。"
          />
        </QueryState>
      </Panel>
      <Notice tone="blue">
        创建密钥后可复制一次，关闭抽屉后列表仅显示掩码。请将完整密钥保存到安全位置。
      </Notice>
      {drawer && (
        <Drawer title={drawer.type === 'create' ? '创建 API Key' : '撤销 API Key'} onClose={close}>
          {createdKey ? (
            <>
              <Notice tone="amber">完整密钥仅在此处展示一次。关闭后无法再次读取。</Notice>
              <Code>{createdKey}</Code>
              <Button
                onClick={async () => {
                  await navigator.clipboard.writeText(createdKey);
                  c.notify('密钥已复制');
                }}
              >
                复制密钥
              </Button>
              <div className="form-actions">
                <Button primary onClick={close}>
                  已保存，关闭
                </Button>
              </div>
            </>
          ) : (
            <Form
              busy={action.busy}
              error={action.error}
              submitLabel={drawer.type === 'create' ? '创建密钥' : '确认撤销'}
              onSubmit={async values => {
                if (drawer.type === 'create') {
                  const key = await action.run(
                    () => c.api.post('/me/api-keys', { name: values.name }),
                    '密钥已创建',
                  );
                  if (generation.current === drawer.generation) setCreatedKey(key.key);
                } else {
                  if (values.confirmation !== 'REVOKE') throw new Error('请输入 REVOKE 确认。');
                  await action.run(() => c.api.del(`/me/api-keys/${drawer.key.id}`), '密钥已撤销');
                  close();
                }
              }}
            >
              {drawer.type === 'create' ? (
                <Field
                  label="密钥名称"
                  name="name"
                  required
                  maxLength={255}
                  help="如：研究报告集成。"
                />
              ) : (
                <>
                  <Notice tone="red">撤销「{drawer.key.name}」后对应集成将失去访问权限。</Notice>
                  <Field label="输入 REVOKE 确认" name="confirmation" required autoComplete="off" />
                </>
              )}
            </Form>
          )}
        </Drawer>
      )}
    </>
  );
}
function Preferences() {
  const c = useFeature();
  const [prefs, setPrefs] = useState<any>(null);
  useEffect(() => setPrefs(getFeaturePreferences()), []);
  return (
    <Panel title="显示与分析偏好" subtitle="设置默认时间范围、时区与界面语言。">
      <Body>
        {prefs ? (
          <Form
            key={JSON.stringify(prefs)}
            submitLabel="保存偏好"
            onSubmit={async values => {
              saveFeaturePreferences({
                range: values.range,
                timezone: values.timezone,
                language: values.language,
                theme: values.theme,
              });
              setPrefs(getFeaturePreferences());
              c.notify('偏好已保存');
            }}
          >
            <div className="form-grid">
              <Select
                label="默认日期范围"
                name="range"
                options={[
                  ['0day', '今天'],
                  ['24hour', '过去 24 小时'],
                  ['7day', '过去 7 天'],
                  ['30day', '过去 30 天'],
                  ['0month', '本月'],
                  ...(!['0day', '24hour', '7day', '30day', '0month'].includes(prefs.range)
                    ? [[prefs.range, '当前已保存范围'] as [string, string]]
                    : []),
                ]}
                defaultValue={prefs.range}
              />
              <Select
                label="时区"
                name="timezone"
                options={Array.from(
                  new Set(
                    [prefs.timezone, 'Asia/Shanghai', 'Asia/Tokyo', 'Europe/Berlin', 'UTC'].filter(
                      Boolean,
                    ),
                  ),
                )}
                defaultValue={prefs.timezone}
              />
              <label className="field">
                <span>语言</span>
                <span className="select-wrap">
                  <select name="language" defaultValue={prefs.language}>
                    <option value="zh-CN">简体中文</option>
                    <option value="en-US" disabled>
                      English（当前不可用）
                    </option>
                    <option value="ja-JP" disabled>
                      日本語（当前不可用）
                    </option>
                  </select>
                  <Icon />
                </span>
                <small className="field-help">当前界面支持简体中文。</small>
              </label>
              <label className="field">
                <span>主题</span>
                <span className="select-wrap">
                  <select name="theme" defaultValue={prefs.theme}>
                    <option value="light">浅色</option>
                    <option value="dark" disabled>
                      深色（当前不可用）
                    </option>
                    <option value="system" disabled>
                      跟随系统（当前不可用）
                    </option>
                  </select>
                  <Icon />
                </span>
                <small className="field-help">当前界面支持浅色主题。</small>
              </label>
            </div>
            <Notice>当前猎看界面使用已确认的浅色规范。分析时区和默认日期范围沿用账户偏好。</Notice>
            <hr className="divider" />
            <Definition
              items={[
                ['当前运行系统', `Liekan ${process.env.currentVersion || '0.1.2'}`],
                ['界面版本', '猎看统计 UI v1'],
                ['许可', 'MIT，保留 Umami 版权'],
              ]}
            />
          </Form>
        ) : (
          <Notice>正在读取偏好设置。</Notice>
        )}
      </Body>
    </Panel>
  );
}

function Goals() {
  const c = useFeature();
  const [page, setPage] = useState(1),
    [remove, setRemove] = useState<FeatureEntity>(null);
  const action = useAction();
  const query = useData(
    ['goals', page],
    signal => c.api.get(`${sitePath(c.siteId)}/goals`, { page, pageSize: 20 }, signal),
    !!c.siteId,
  );
  useEffect(() => {
    const count = Number(query.data?.count);
    if (query.data?.count == null || !Number.isFinite(count) || count < 0) return;
    const lastPage = Math.max(1, Math.ceil(count / 20));
    setPage(current => Math.min(current, lastPage));
  }, [query.data?.count]);
  const goals = rowsOf<FeatureEntity>(query.data);
  const stats = useData(
    ['goal-results', goals.map(goal => goal.id)],
    async signal =>
      Promise.all(
        goals.map(async goal => {
          try {
            return {
              id: goal.id,
              ...(await c.api.get(
                `/liekan/websites/${c.siteId}/goals/${goal.id}/analytics`,
                { ...c.range, ...c.filters },
                signal,
              )),
            };
          } catch (error: any) {
            if (error.name === 'AbortError') throw error;
            return { id: goal.id, error };
          }
        }),
      ),
    goals.length > 0,
  );
  const manage = canManageSite(c, c.site);
  if (!c.siteId) return <MissingWebsite />;
  const result = stats.data || [],
    first = goals[0],
    firstResult = result.find(row => row.id === first?.id);
  return (
    <>
      <Metrics
        items={[
          [
            '目标数量',
            query.isPending ? '—' : String(query.data?.count ?? goals.length),
            '当前网站',
          ],
          [
            first?.name || '目标转化次数',
            firstResult && !firstResult.error ? numberLabel(firstResult.conversions) : '—',
            '转化次数',
            'blue',
          ],
          [
            '目标转化率',
            firstResult && !firstResult.error
              ? conversionRate(firstResult.num, firstResult.total)
              : '—',
            firstResult && !firstResult.error
              ? `${numberLabel(firstResult.num)} 位转化访客 / ${numberLabel(firstResult.total)} 位访客`
              : '按独立转化访客计算',
          ],
          ['目标类型', '页面 / 事件', '保留原有目标条件'],
        ]}
      />
      <Panel
        title="网站目标"
        subtitle="按页面访问或事件触发定义目标。"
        actions={
          manage && (
            <LinkButton page="goal-editor" primary>
              <Icon name="plus" />
              创建目标
            </LinkButton>
          )
        }
      >
        <QueryState query={query}>
          <Table
            columns={['目标', '触发条件', '转化次数', '转化率', '操作']}
            numeric={[2, 3]}
            search
            page={page}
            pages={Math.ceil((query.data?.count || 0) / 20)}
            onPage={setPage}
            rows={goals.map(goal => {
              const value = result.find(row => row.id === goal.id);
              return [
                <>
                  <span className="table-title">{goal.name}</span>
                  {goal.description && <span className="table-meta">{goal.description}</span>}
                </>,
                `${goal.parameters?.type === 'path' ? '页面' : '事件'} · ${goal.parameters?.value || '未配置'}`,
                value?.error ? '读取失败' : value ? numberLabel(value.conversions) : '正在加载',
                value?.error ? '—' : value ? conversionRate(value.num, value.total) : '—',
                <div className="actions" key="actions">
                  <LinkButton page="goal-editor" params={{ id: goal.id }}>
                    {manage ? '编辑' : '查看'}
                  </LinkButton>
                  {manage && <Button onClick={() => setRemove(goal)}>删除</Button>}
                </div>,
              ];
            })}
            empty="尚未创建目标。创建页面或事件目标后查看转化。"
          />
        </QueryState>
      </Panel>
      {goals.length > 0 ? (
        <QueryState query={stats}>
          <Chart
            title={`${first.name}的转化趋势`}
            subtitle="当前所选期间"
            labels={(firstResult?.series || []).map(point => point.x)}
            series={[
              { name: '转化次数', values: (firstResult?.series || []).map(point => point.y) },
            ]}
          >
            {firstResult?.error && (
              <Notice tone="red">该目标的转化统计读取失败：{firstResult.error.message}</Notice>
            )}
          </Chart>
        </QueryState>
      ) : (
        <Chart title="目标转化趋势" subtitle="当前所选期间" />
      )}
      <Notice>
        目标转化次数和独立转化访客分别展示。转化率按独立转化访客计算，没有访客时显示“—”。
      </Notice>
      {remove && (
        <Drawer title="删除目标" onClose={() => setRemove(null)}>
          <Form
            busy={action.busy}
            error={action.error}
            submitLabel="确认删除"
            onSubmit={async values => {
              if (values.confirmation !== remove.name) throw new Error('确认内容不匹配。');
              await action.run(
                () => c.api.del(`${sitePath(c.siteId)}/goals/${remove.id}`),
                '目标已删除',
              );
              setRemove(null);
            }}
          >
            <Notice tone="red">
              删除「{remove.name}」的目标定义，已采集的访问与事件数据继续保留。
            </Notice>
            <Field label={`输入 ${remove.name} 确认`} name="confirmation" required />
          </Form>
        </Drawer>
      )}
    </>
  );
}
function GoalEditor() {
  const c = useFeature();
  const id = c.route.id;
  const query = useData(
    ['goal-definition', id],
    signal => c.api.get(`${sitePath(c.siteId)}/goals/${id}`, undefined, signal),
    !!c.siteId && !!id,
  );
  if (!c.siteId) return <MissingWebsite />;
  return (
    <>
      {id ? (
        <QueryState query={query}>
          {query.data && <GoalForm key={`${c.siteId}:${query.data.id}`} goal={query.data} />}
        </QueryState>
      ) : (
        <GoalForm key={`${c.siteId}:new`} />
      )}
    </>
  );
}
function GoalForm({ goal }: { goal?: FeatureEntity }) {
  const c = useFeature(),
    action = useAction(),
    manage = canManageSite(c, c.site);
  return (
    <div className="wide-narrow">
      <Panel title="目标条件" subtitle="与上游页面或事件目标保持一致。">
        <Body>
          {!manage && <ReadonlyNotice />}
          <Form
            busy={action.busy}
            error={action.error}
            disabled={!manage}
            submitLabel="保存目标"
            cancel={<LinkButton page="goals">取消</LinkButton>}
            onSubmit={async values => {
              if (!manage) throw new Error('需要网站管理权限。');
              await action.run(
                () =>
                  c.api.post(
                    `${sitePath(c.siteId)}/goals${goal ? `/${goal.id}` : ''}`,
                    goalPayload(values),
                  ),
                '目标已保存',
              );
              c.navigate('goals');
            }}
          >
            <Field
              label="目标名称"
              name="name"
              defaultValue={goal?.name || ''}
              required
              readOnly={!manage}
              maxLength={200}
            />
            <Select
              label="触发类型"
              name="goalType"
              options={[
                ['path', '访问页面'],
                ['event', '触发事件'],
              ]}
              defaultValue={goal?.parameters?.type || 'path'}
              disabled={!manage}
            />
            <Field
              label="页面路径或事件名称"
              name="value"
              defaultValue={goal?.parameters?.value || ''}
              required
              readOnly={!manage}
              help="页面填 /pricing，事件填自定义事件名称。"
            />
            <Textarea
              label="说明（可选）"
              name="description"
              defaultValue={goal?.description || ''}
              maxLength={500}
              readOnly={!manage}
              help="用于团队理解目标定义。"
            />
          </Form>
        </Body>
      </Panel>
      <Panel title="口径说明" subtitle="一个目标对应一个行为条件。">
        <Body>
          <div className="stack">
            <div>
              <h3>访问页面</h3>
              <p className="muted">使用采集到的路径定义目标。</p>
            </div>
            <div>
              <h3>触发事件</h3>
              <p className="muted">使用自定义事件名称定义目标。</p>
            </div>
          </div>
          <hr className="divider" />
          <LinkButton page="events">查看事件属性</LinkButton>
        </Body>
      </Panel>
    </div>
  );
}
function Funnels() {
  const c = useFeature(),
    action = useAction();
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState(c.route.id || ''),
    [remove, setRemove] = useState<FeatureEntity>(null);
  const query = useData(
    ['funnels', page],
    signal => c.api.get(`${sitePath(c.siteId)}/funnels`, { page, pageSize: 20 }, signal),
    !!c.siteId,
  );
  useEffect(() => {
    const count = Number(query.data?.count);
    if (query.data?.count == null || !Number.isFinite(count) || count < 0) return;
    const lastPage = Math.max(1, Math.ceil(count / 20));
    setPage(current => Math.min(current, lastPage));
  }, [query.data?.count]);
  const funnels = rowsOf<FeatureEntity>(query.data);
  const funnel = funnels.find(funnel => funnel.id === selected) || funnels[0];
  const stats = useData(
    ['funnel-results', funnel?.id],
    signal =>
      c.api.get(
        `${sitePath(c.siteId)}/funnels/${funnel?.id}/stats`,
        { ...c.range, ...c.filters },
        signal,
      ),
    !!funnel,
  );
  const results = rowsOf<any>(stats.data),
    first = results[0]?.visitors,
    last = results.at(-1)?.visitors;
  const manage = canManageSite(c, c.site);
  if (!c.siteId) return <MissingWebsite />;
  return (
    <>
      <Metrics
        items={[
          [
            '进入漏斗',
            stats.isPending || stats.error ? '—' : numberLabel(first ?? 0),
            '当前范围访客',
          ],
          [
            '完成路径',
            stats.isPending || stats.error ? '—' : numberLabel(last ?? 0),
            '完成访客',
            'blue',
          ],
          ['整体转化率', conversionRate(last, first), '相对首次进入'],
          [
            '步骤数量',
            funnel ? String(funnel.parameters?.steps?.length || 0) : '0',
            '按已保存配置展示',
          ],
        ]}
      />
      <QueryState query={query}>
        {funnel ? (
          <>
            <Panel
              title={funnel.name}
              subtitle={`${funnel.parameters?.steps?.length || 0} 步 · 同一访客 · ${funnel.parameters?.window} 分钟窗口`}
              actions={
                <div className="actions" key="actions">
                  {manage && (
                    <LinkButton page="funnel-editor" params={{ id: funnel.id }} primary>
                      配置漏斗
                    </LinkButton>
                  )}
                </div>
              }
            >
              <Body>
                {funnels.length > 1 && (
                  <Select
                    label="已保存漏斗"
                    value={funnel.id}
                    onChange={event => setSelected(event.target.value)}
                    options={funnels.map(funnel => [funnel.id, funnel.name])}
                  />
                )}
                <QueryState query={stats}>
                  {results.map((step, i) => (
                    <div className="funnel-row" key={i}>
                      <strong>
                        {i + 1} · {step.value}
                      </strong>
                      <div className="funnel-bar">
                        <i
                          style={{
                            width: `${first > 0 ? Math.min(100, (Number(step.visitors) / Number(first)) * 100) : 0}%`,
                          }}
                        />
                      </div>
                      <span className="num numeric">{numberLabel(step.visitors)}</span>
                    </div>
                  ))}
                  <hr className="divider" />
                  <Table
                    columns={['步骤', '到达访客', '相对上步转化', '累计转化']}
                    numeric={[1, 2, 3]}
                    rows={results.map((step, i) => [
                      step.value,
                      numberLabel(step.visitors),
                      i === 0
                        ? Number(step.visitors) > 0
                          ? '100.00%'
                          : '—'
                        : conversionRate(step.visitors, results[i - 1]?.visitors),
                      conversionRate(step.visitors, first),
                    ])}
                  />
                </QueryState>
              </Body>
            </Panel>
            <Panel
              title="网站漏斗"
              subtitle="管理当前网站已保存的路径。"
              actions={
                manage && (
                  <LinkButton page="funnel-editor" primary>
                    <Icon name="plus" />
                    创建漏斗
                  </LinkButton>
                )
              }
            >
              <Table
                columns={['漏斗', '步骤数量', '转化窗口', '操作']}
                page={page}
                pages={Math.ceil((query.data?.count || 0) / 20)}
                onPage={setPage}
                rows={funnels.map(funnel => [
                  funnel.name,
                  String(funnel.parameters?.steps?.length || 0),
                  `${funnel.parameters?.window} 分钟`,
                  <div className="actions" key="actions">
                    <Button onClick={() => setSelected(funnel.id)}>查看结果</Button>
                    <LinkButton page="funnel-editor" params={{ id: funnel.id }}>
                      {manage ? '编辑' : '查看'}
                    </LinkButton>
                    {manage && <Button onClick={() => setRemove(funnel)}>删除</Button>}
                  </div>,
                ])}
              />
            </Panel>
          </>
        ) : (
          <Panel
            title="网站漏斗"
            subtitle="至少两步，最多八步。"
            actions={
              manage && (
                <LinkButton page="funnel-editor" primary>
                  <Icon name="plus" />
                  创建漏斗
                </LinkButton>
              )
            }
          >
            <Body>
              <Notice>尚未创建漏斗。配置并保存路径后查看真实转化结果。</Notice>
            </Body>
          </Panel>
        )}
      </QueryState>
      <Notice>
        步骤、名称、事件属性条件与窗口按保存配置计算。转化数量来自当前网站所选范围，没有访客时转化率显示“—”。
      </Notice>
      {remove && (
        <Drawer title="删除漏斗" onClose={() => setRemove(null)}>
          <Form
            busy={action.busy}
            error={action.error}
            submitLabel="确认删除"
            onSubmit={async values => {
              if (values.confirmation !== remove.name) throw new Error('确认内容不匹配。');
              await action.run(
                () => c.api.del(`${sitePath(c.siteId)}/funnels/${remove.id}`),
                '漏斗已删除',
              );
              setRemove(null);
            }}
          >
            <Notice tone="red">
              删除「{remove.name}」的漏斗定义，已采集的访问与事件数据继续保留。
            </Notice>
            <Field label={`输入 ${remove.name} 确认`} name="confirmation" required />
          </Form>
        </Drawer>
      )}
    </>
  );
}
function FunnelEditor() {
  const c = useFeature(),
    id = c.route.id;
  const query = useData(
    ['funnel-definition', id],
    signal => c.api.get(`${sitePath(c.siteId)}/funnels/${id}`, undefined, signal),
    !!c.siteId && !!id,
  );
  if (!c.siteId) return <MissingWebsite />;
  return (
    <>
      {id ? (
        <QueryState query={query}>
          {query.data && <FunnelForm key={`${c.siteId}:${query.data.id}`} funnel={query.data} />}
        </QueryState>
      ) : (
        <FunnelForm key={`${c.siteId}:new`} />
      )}
    </>
  );
}
function FunnelForm({ funnel }: { funnel?: FeatureEntity }) {
  const c = useFeature(),
    action = useAction(),
    manage = canManageSite(c, c.site);
  const blankStep = (): CoreFunnelStep => ({ type: 'path', value: '', filters: [] });
  const [steps, setSteps] = useState<CoreFunnelStep[]>(
    () =>
      funnel?.parameters?.steps?.map((step: CoreFunnelStep) => ({
        ...step,
        filters: step.filters || [],
      })) || [blankStep(), blankStep()],
  );
  const update = (index: number, change: Partial<CoreFunnelStep>) =>
    setSteps(current => current.map((step, i) => (i === index ? { ...step, ...change } : step)));
  const move = (index: number, delta: number) =>
    setSteps(current => {
      const next = [...current];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });
  const changeFilter = (i: number, j: number, change: any) =>
    update(i, {
      filters: steps[i].filters.map((filter, index) =>
        index === j ? { ...filter, ...change } : filter,
      ),
    });
  return (
    <div className="wide-narrow">
      <Panel title="漏斗配置" subtitle="至少两步，最多八步。事件步骤可设置属性条件。">
        <Body>
          {!manage && <ReadonlyNotice />}
          <Form
            busy={action.busy}
            error={action.error}
            disabled={!manage}
            submitLabel="保存漏斗"
            cancel={<LinkButton page="funnels">取消</LinkButton>}
            onSubmit={async values => {
              if (!manage) throw new Error('需要网站管理权限。');
              await action.run(
                () =>
                  c.api.post(
                    `${sitePath(c.siteId)}/funnels${funnel ? `/${funnel.id}` : ''}`,
                    funnelPayload(values, steps),
                  ),
                '漏斗已保存',
              );
              c.navigate('funnels');
            }}
          >
            <Field
              label="漏斗名称"
              name="name"
              defaultValue={funnel?.name || ''}
              required
              maxLength={200}
              readOnly={!manage}
            />
            <Field
              label="转化窗口（分钟）"
              name="window"
              type="number"
              defaultValue={funnel?.parameters?.window ?? ''}
              required
              min={1}
              step={1}
              readOnly={!manage}
              help="大于 0，同一访客需要在窗口内按顺序完成。"
            />
            <Textarea
              label="说明（可选）"
              name="description"
              defaultValue={funnel?.description || ''}
              maxLength={500}
              readOnly={!manage}
            />
            <div id="funnel-steps">
              {steps.map((step, i) => (
                <div className="step-editor" key={i}>
                  <div className="step-editor-head">
                    <strong>步骤 {i + 1}</strong>
                    <div className="actions" key="actions">
                      <Button
                        aria-label={`上移步骤 ${i + 1}`}
                        disabled={!manage || i === 0}
                        onClick={() => move(i, -1)}
                      >
                        ↑
                      </Button>
                      <Button
                        aria-label={`下移步骤 ${i + 1}`}
                        disabled={!manage || i === steps.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        ↓
                      </Button>
                      <Button
                        aria-label={`移除步骤 ${i + 1}`}
                        disabled={!manage || steps.length <= 2}
                        onClick={() =>
                          setSteps(current => current.filter((_, index) => index !== i))
                        }
                      >
                        <Icon name="close" />
                      </Button>
                    </div>
                  </div>
                  <div className="two">
                    <Select
                      label="行为类型"
                      name={`step-type-${i}`}
                      value={step.type}
                      disabled={!manage}
                      options={[
                        ['path', '访问页面'],
                        ['event', '触发事件'],
                      ]}
                      onChange={event =>
                        update(i, { type: event.target.value as 'path' | 'event', filters: [] })
                      }
                    />
                    <Field
                      label="路径或事件名称"
                      name={`step-value-${i}`}
                      value={step.value}
                      required
                      readOnly={!manage}
                      onChange={event => update(i, { value: event.target.value })}
                    />
                  </div>
                  {step.type === 'event' && (
                    <div style={{ marginTop: 12 }}>
                      {step.filters.map((filter, j) => (
                        <div className="condition" key={j}>
                          <Field
                            label="事件属性"
                            name={`property-${i}-${j}`}
                            value={filter.property}
                            required
                            readOnly={!manage}
                            onChange={event => changeFilter(i, j, { property: event.target.value })}
                          />
                          <Select
                            label="运算符"
                            name={`operator-${i}-${j}`}
                            value={filter.operator}
                            disabled={!manage}
                            options={[
                              ['eq', '等于'],
                              ['neq', '不等于'],
                              ['c', '包含'],
                              ['dnc', '不包含'],
                            ]}
                            onChange={event => changeFilter(i, j, { operator: event.target.value })}
                          />
                          <Field
                            label="属性值"
                            name={`filtervalue-${i}-${j}`}
                            value={filter.value}
                            required
                            readOnly={!manage}
                            onChange={event => changeFilter(i, j, { value: event.target.value })}
                          />
                          <Button
                            aria-label="移除属性条件"
                            disabled={!manage}
                            onClick={() =>
                              update(i, { filters: step.filters.filter((_, index) => index !== j) })
                            }
                          >
                            <Icon name="close" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        disabled={!manage}
                        onClick={() =>
                          update(i, {
                            filters: [...step.filters, { property: '', operator: 'eq', value: '' }],
                          })
                        }
                      >
                        添加事件属性
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <Button
              disabled={!manage || steps.length >= 8}
              onClick={() => setSteps(current => [...current, blankStep()])}
            >
              <Icon name="plus" />
              添加步骤
            </Button>
            <p className="field-help">已配置 {steps.length} / 8 步。</p>
          </Form>
        </Body>
      </Panel>
      <Panel title="配置预览" subtitle="步骤顺序决定转化路径。">
        <Body>
          <ol className="timeline">
            {steps.map((step, i) => (
              <li key={i}>
                <strong>
                  {i + 1} · {step.value || '未填写'}
                </strong>
                <p>
                  {step.type === 'path' ? '页面访问' : '事件触发'}
                  {step.filters.length ? ' · 带属性条件' : ''}
                </p>
              </li>
            ))}
          </ol>
        </Body>
      </Panel>
    </div>
  );
}

export function CorePages({ page }: { page: string }): ReactNode {
  switch (page) {
    case 'websites':
      return <Websites />;
    case 'onboarding':
      return <Onboarding />;
    case 'tracking':
      return <Tracking />;
    case 'install-check':
      return <Tracking check />;
    case 'website-settings':
      return <WebsiteSettings />;
    case 'recorder-settings':
      return <RecorderSettings />;
    case 'login':
    case 'login-2fa':
    case 'sso':
      return <FeatureAuthPage page={page} />;
    case 'account':
      return <Account />;
    case 'security':
      return <Security />;
    case 'two-factor':
      return <TwoFactor />;
    case 'backup-codes':
      return <BackupCodes />;
    case 'api-keys':
      return <ApiKeys />;
    case 'preferences':
      return <Preferences />;
    case 'goals':
      return <Goals />;
    case 'goal-editor':
      return <GoalEditor />;
    case 'funnels':
      return <Funnels />;
    case 'funnel-editor':
      return <FunnelEditor />;
    default:
      return null;
  }
}
