'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { featureDateRange } from '@/lib/liekan/contracts/analysis';
import {
  type FeatureEntity,
  type FeatureRoute,
  type FeatureUser,
  rowsOf,
} from '@/lib/liekan/contracts/features';
import { useFeatureDateRange, useNavigation } from '@/lib/liekan/upstream/client';
import {
  clearFeatureLogin,
  featureApi,
  getAllFeatureRows,
  getFeaturePreferences,
  getFeatureSites,
  refreshFeatureIdentity,
} from '@/lib/liekan/upstream/features-client';
import '@/styles/liekan/Features.module.css';
import { AnalyticsPages, analysisPages } from './AnalyticsPages';
import { CorePages } from './CorePages';
import { FeatureProvider } from './context';
import { ExtendedPages, extendedPages } from './ExtendedPages';
import { LinksPixelsPages, linksPixelsPages } from './LinksPixelsPages';
import {
  featureHref,
  featurePages,
  featureWebsiteSwitchHref,
  normalizeFeatureScope,
} from './routes';
import { Button, Drawer, Field, Form, Icon, Notice, QueryState, Select } from './ui';
import { WorkspacePages, workspacePages } from './WorkspacePages';

export const coreFeaturePages = new Set([
  'websites',
  'onboarding',
  'tracking',
  'install-check',
  'website-settings',
  'recorder-settings',
  'account',
  'security',
  'two-factor',
  'backup-codes',
  'api-keys',
  'preferences',
  'goals',
  'goal-editor',
  'funnels',
  'funnel-editor',
]);
export function canRenderFeatureRoute(route: FeatureRoute | null) {
  return (
    !!route &&
    [coreFeaturePages, analysisPages, extendedPages, workspacePages, linksPixelsPages].some(pages =>
      pages.has(route.page),
    )
  );
}
const groups: [string, string, string, string][] = [
  ['sites', '网站与接入', 'websites', 'globe'],
  ['identity', '身份与安全', 'account', 'shield'],
  ['conversion', '目标与漏斗', 'goals', 'funnel'],
  ['activity', '访客与事件', 'events', 'activity'],
  ['audience', '筛选与人群', 'segments', 'users'],
  ['analysis', '高级分析', 'utm', 'bars'],
  ['workspace', '协作与管理', 'boards', 'box'],
  ['extended', '扩展能力', 'performance', 'grid'],
];

export function FeatureApp({
  user,
  route: requestedRoute,
  forceSetup = false,
}: {
  user: FeatureUser;
  route: FeatureRoute;
  forceSetup?: boolean;
}) {
  const route = normalizeFeatureScope(requestedRoute);
  const nav = useNavigation();
  const client = useQueryClient();
  const [toast, setToast] = useState('');
  const [mobile, setMobile] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);
  const preferences = getFeaturePreferences();
  const timezone = preferences.timezone || 'Asia/Shanghai';
  const { dateRange } = useFeatureDateRange(timezone);
  const range = useMemo(
    () => featureDateRange(dateRange, timezone),
    [+dateRange.startDate, +dateRange.endDate, dateRange.value, dateRange.unit, timezone],
  );
  const setup = forceSetup || ['two-factor', 'backup-codes'].includes(route.page);
  const sitesQuery = useQuery({
    queryKey: ['liekan-feature', user.id, 'sites', route.teamId],
    queryFn: ({ signal }) => getFeatureSites(signal, route.teamId),
    enabled: !setup,
    retry: false,
  });
  const sites = rowsOf<FeatureEntity>(sitesQuery.data);
  const teamsQuery = useQuery({
    queryKey: ['liekan-feature', user.id, 'teams'],
    queryFn: ({ signal }) => getAllFeatureRows<FeatureEntity>('/me/teams', {}, signal),
    enabled: !setup,
    retry: false,
  });
  const teams: FeatureEntity[] = teamsQuery.data || [];
  const siteId = route.websiteId || nav.query.websiteId || nav.query.site || sites[0]?.id || '';
  const siteQuery = useQuery({
    queryKey: ['liekan-feature', user.id, 'site', siteId],
    queryFn: ({ signal }) => featureApi.get(`/websites/${siteId}`, {}, signal),
    enabled: !!siteId && !setup,
    retry: false,
  });
  const site = siteQuery.data || sites.find(s => s.id === siteId);
  const current = forceSetup ? { ...route, page: 'two-factor' } : route;
  const page = featurePages.find(p => p.id === current.page);
  const href = useCallback(
    (page: string, params: Record<string, any> = {}) =>
      featureHref(page, {
        ...Object.fromEntries(
          Object.entries(nav.query).filter(
            ([key]) =>
              (![
                'links',
                'link-editor',
                'link-detail',
                'pixels',
                'pixel-editor',
                'pixel-detail',
                'boards',
                'board-editor',
                'board-design',
                'board-view',
                'dashboard',
                'dashboard-edit',
              ].includes(page) ||
                ['date', 'unit', 'offset', 'compare'].includes(key)) &&
              (!/^(retentionDate|retentionDay|attributionStep|attributionModel|attributionType|attributionSource)$/.test(
                key,
              ) ||
                ['sessions', 'session-detail'].includes(page)) &&
              ([
                'date',
                'unit',
                'offset',
                'compare',
                'segment',
                'cohort',
                'match',
                'excludeBounce',
                'retentionDate',
                'retentionDay',
                'attributionStep',
                'attributionModel',
                'attributionType',
                'attributionSource',
              ].includes(key) ||
                /^(drill_|path|referrer|channel|title|query|os|tag|hostname|distinctId|language|country|region|city|browser|device|event|utm|spf\d|epf\d)/.test(
                  key,
                )),
          ),
        ),
        websiteId: siteId,
        ...(route.teamId ? { teamId: route.teamId } : {}),
        ...params,
      }),
    [siteId, JSON.stringify(nav.query), route.teamId],
  );
  const navigate = useCallback(
    (page: string, params: Record<string, any> = {}) => nav.router.push(href(page, params)),
    [href, nav.router],
  );
  const notify = useCallback((message: string) => setToast(message), []);
  const refresh = useCallback(async () => {
    await refreshFeatureIdentity();
    await client.invalidateQueries({ queryKey: ['liekan-feature', user.id] });
  }, [client, user.id]);
  const filters = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(nav.query).filter(([key]) =>
          /^(drill_|path|referrer|channel|title|query|os|device|browser|country|region|city|event|tag|hostname|distinctId|language|utm|segment|cohort|match|excludeBounce|attribution|retentionDate|retentionDay|spf\d|epf\d)/.test(
            key,
          ),
        ),
      ),
    [JSON.stringify(nav.query)],
  );
  useEffect(() => {
    setMobile(false);
    setDateOpen(false);
    setSiteOpen(false);
  }, [nav.pathname]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  const value = {
    user,
    route: current,
    api: featureApi,
    sites,
    sitesLoading: sitesQuery.isPending,
    teams,
    siteId,
    site,
    range,
    filters,
    query: nav.query,
    href,
    navigate,
    notify,
    refresh,
  };
  if (current.page === 'share-preview')
    return (
      <FeatureProvider value={value}>
        <div data-liekan-features lang="zh-CN" style={{ minHeight: '100dvh' }}>
          <WorkspacePages page="share-preview" />
        </div>
      </FeatureProvider>
    );
  return (
    <FeatureProvider value={value}>
      <div data-liekan-features lang="zh-CN" style={{ minHeight: '100dvh' }}>
        <a className="skip" href="#main-content">
          跳到主要内容
        </a>
        <button className="mobile-toggle" onClick={() => setMobile(!mobile)} aria-expanded={mobile}>
          <Icon name="menu" />
          页面导航
        </button>
        {mobile && (
          <button className="nav-backdrop" aria-label="关闭导航" onClick={() => setMobile(false)} />
        )}
        <aside className={`sidebar${mobile ? ' open' : ''}`}>
          <Link prefetch={false} className="brand" href="/dashboard">
            <img src={`${process.env.basePath || ''}/liekan/features/logo.svg`} alt="" />
            <span className="brand-name">
              猎看统计<span className="brand-caption">LIEKAN GEO STATS</span>
            </span>
          </Link>
          <nav className="nav" aria-label="页面导航">
            <Link prefetch={false} className="nav-item nav-quick" href="/dashboard">
              <Icon name="grid" />
              工作台
            </Link>
            <div className="nav-label">管理与分析</div>
            {groups.map(([id, title, first, symbol]) => (
              <Link
                prefetch={false}
                key={id}
                className={`nav-item${page?.group === id ? ' on' : ''}`}
                href={href(first)}
              >
                <Icon name={symbol} />
                {title}
              </Link>
            ))}
            {siteId && (
              <>
                <div className="nav-label">流量洞察</div>
                {[
                  ['总览', ''],
                  ['AI 流量', '/ai'],
                  ['人类访问', '/human'],
                  ['内容分析', '/content'],
                  ['转化分析', '/conversions'],
                  ['实时请求', '/logs'],
                ].map(([title, suffix]) => (
                  <Link
                    prefetch={false}
                    className="nav-item"
                    key={title}
                    href={`/websites/${siteId}/geo${suffix}`}
                  >
                    <Icon name="bars" />
                    {title}
                  </Link>
                ))}
              </>
            )}
          </nav>
          <footer className="side-footer">
            <button className="site-switch" onClick={() => setSiteOpen(true)}>
              <span className="avatar">LK</span>
              <span>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 500 }}>
                  {site?.name || '选择网站'}
                </span>
                <small>{site?.domain || '当前管理空间'}</small>
              </span>
              <Icon name="down" />
            </button>
          </footer>
        </aside>
        <div className="shell-content">
          <header className="header">
            <div className="header-inner">
              <div>
                <h1>{page?.title || '猎看统计'}</h1>
                <div className="subtitle">
                  {groups.find(g => g[0] === page?.group)?.[1]} · {page?.summary}
                </div>
              </div>
              <div className="header-actions">
                {['activity', 'audience', 'analysis', 'extended', 'conversion'].includes(
                  page?.group,
                ) && (
                  <Button onClick={() => setDateOpen(true)}>
                    {formatInTimeZone(range.startAt, timezone, 'yyyy-MM-dd')} 至{' '}
                    {formatInTimeZone(range.endAt, timezone, 'MM-dd')}
                    <Icon name="down" />
                  </Button>
                )}
                <Button onClick={() => navigate('account')}>{user.username}</Button>
                <Button
                  onClick={async () => {
                    await featureApi.post('/auth/logout').catch(() => {});
                    clearFeatureLogin();
                    client.clear();
                    nav.router.replace('/login');
                  }}
                >
                  退出
                </Button>
              </div>
            </div>
          </header>
          <main className="content" id="main-content">
            {page && (
              <nav
                className="tabs section-tabs"
                aria-label={`${groups.find(g => g[0] === page.group)?.[1] || '当前分组'}页面`}
              >
                {featurePages
                  .filter(item => item.group === page.group)
                  .map(item => (
                    <Link
                      prefetch={false}
                      key={item.id}
                      className={`tab${item.id === current.page ? ' on' : ''}`}
                      aria-current={item.id === current.page ? 'page' : undefined}
                      href={href(item.id)}
                    >
                      {item.title}
                    </Link>
                  ))}
              </nav>
            )}
            {!setup && sitesQuery.error ? (
              <QueryState query={sitesQuery}>{null}</QueryState>
            ) : range.endAt - range.startAt > 1096 * 86400000 ? (
              <Notice>日期范围上限 3 年，请调整日期后查看。</Notice>
            ) : (
              <FeaturePage
                key={`${['tracking', 'install-check', 'website-settings', 'recorder-settings', 'goals', 'goal-editor', 'funnels', 'funnel-editor'].includes(current.page) || analysisPages.has(current.page) || extendedPages.has(current.page) || linksPixelsPages.has(current.page) ? siteId : user.id}:${current.page}:${current.id || ''}`}
                page={current.page}
              />
            )}
          </main>
        </div>
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
        {dateOpen && (
          <Drawer title="日期范围" onClose={() => setDateOpen(false)}>
            <Form
              submitLabel="应用日期范围"
              onSubmit={async d => {
                const startAt = +fromZonedTime(`${d.start}T00:00:00.000`, timezone);
                const endAt = +fromZonedTime(`${d.end}T23:59:59.999`, timezone);
                if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt < startAt)
                  throw new Error('日期范围无效');
                if (endAt - startAt > 1096 * 86400000) throw new Error('日期范围上限 3 年');
                nav.router.push(
                  nav.updateParams({
                    date: `range:${startAt}:${endAt}:day`,
                    unit: 'day',
                    offset: undefined,
                  }),
                );
                setDateOpen(false);
              }}
            >
              <div className="form-grid">
                <Field
                  label="开始日期"
                  name="start"
                  type="date"
                  defaultValue={formatInTimeZone(range.startAt, timezone, 'yyyy-MM-dd')}
                  required
                />
                <Field
                  label="结束日期"
                  name="end"
                  type="date"
                  defaultValue={formatInTimeZone(range.endAt, timezone, 'yyyy-MM-dd')}
                  required
                />
              </div>
            </Form>
          </Drawer>
        )}
        {siteOpen && (
          <Drawer title="切换网站" onClose={() => setSiteOpen(false)}>
            <Form
              submitLabel="切换网站"
              onSubmit={async d => {
                const selected = sites.find(s => s.id === d.site);
                if (!selected) throw new Error('请选择可访问的网站');
                nav.router.push(featureWebsiteSwitchHref(current, selected.id, nav.query));
                setSiteOpen(false);
              }}
            >
              <Select
                label="网站"
                name="site"
                options={sites.map(s => [s.id, s.name])}
                defaultValue={siteId}
              />
            </Form>
          </Drawer>
        )}
      </div>
    </FeatureProvider>
  );
}

function FeaturePage({ page }: { page: string }) {
  if (coreFeaturePages.has(page)) return <CorePages page={page} />;
  if (analysisPages.has(page)) return <AnalyticsPages page={page} />;
  if (extendedPages.has(page)) return <ExtendedPages page={page} />;
  if (workspacePages.has(page)) return <WorkspacePages page={page} />;
  if (linksPixelsPages.has(page)) return <LinksPixelsPages page={page} />;
  return null;
}
