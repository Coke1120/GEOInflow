'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import Link from 'next/link';
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { featureDateRange } from '@/lib/liekan/contracts/analysis';
import {
  type FeatureEntity,
  type FeatureRoute,
  type FeatureUser,
  rowsOf,
} from '@/lib/liekan/contracts/features';
import { useFeatureDateRange, useNavigation } from '@/lib/liekan/upstream/client';
import {
  featureApi,
  featureSiteQuery,
  getAllFeatureRows,
  getFeaturePreferences,
  getFeatureSites,
  refreshFeatureIdentity,
  invalidateFeatureUserQueries,
} from '@/lib/liekan/upstream/features-client';
import { websiteHandle, websiteMatchesHandle } from '@/lib/liekan/website-handle';
import '@/styles/liekan/Features.module.css';
import shellStyles from '@/styles/liekan/Shell.module.css';
import {
  hasDateControl,
  navigationFor,
  needsWebsite,
  resourceListPages,
  websiteAnalysisFamily,
} from '@/lib/liekan/contracts/navigation';
import { AnalysisTabs } from '../AnalysisTabs';
import { DataLoading } from '../DataLoading';
import { Navigation, useSidebarWidth } from '../Navigation';
import { ProductFooter } from '../ProductFooter';
import { WebsiteToolbar } from '../WebsiteToolbar';
import { activeQuickDateRange, QuickRangeButtons } from '../date-quick-range';
import { AnalyticsPages, analysisPages } from './AnalyticsPages';
import { CorePages } from './CorePages';
import { AiPages, aiPages } from './AiPages';
import { HelpCenter } from './HelpCenter';
import { FeatureProvider } from './context';
import { ExtendedPages, extendedPages } from './ExtendedPages';
import { LinksPixelsPages, linksPixelsPages } from './LinksPixelsPages';
import { featureHref, featureNavigationHref, featurePages, normalizeFeatureScope } from './routes';
import { SavedSegments } from './SavedSegments';
import { Button, LiekanDialog, Field, Form, Icon, Notice, QueryState } from './ui';
import { WorkspacePages, workspacePages } from './WorkspacePages';

export const coreFeaturePages = new Set([
  'help',
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
  'access-denied',
  'session-expired',
  'not-found',
]);
export function canRenderFeatureRoute(route: FeatureRoute | null) {
  return (
    !!route &&
    [
      coreFeaturePages,
      analysisPages,
      extendedPages,
      workspacePages,
      linksPixelsPages,
      aiPages,
    ].some(pages => pages.has(route.page))
  );
}
export function FeatureApp({
  user,
  route: requestedRoute,
  forceSetup = false,
}: {
  user: FeatureUser;
  route: FeatureRoute;
  forceSetup?: boolean;
}) {
  const [entity, setEntity] = useState<FeatureEntity>(null);
  const ownedEntity = entity?.id === requestedRoute.id ? entity : undefined;
  const scopedRoute = normalizeFeatureScope({
    ...requestedRoute,
    ...(ownedEntity &&
    navigationFor(requestedRoute).scope === 'global' &&
    !['team-detail'].includes(requestedRoute.page)
      ? { teamId: ownedEntity.teamId || undefined }
      : {}),
  });
  const route: FeatureRoute =
    navigationFor(scopedRoute).scope === 'admin' && !user.isAdmin
      ? { page: 'access-denied' }
      : scopedRoute;
  const nav = useNavigation();
  const client = useQueryClient();
  const [toast, setToast] = useState('');
  const [width, setWidth] = useSidebarWidth();
  const [dateOpen, setDateOpen] = useState(false);
  const meta = navigationFor(route);
  const websiteRequired = needsWebsite(route);
  const datePage = hasDateControl(route);
  const teamMetadataRequired =
    meta.scope === 'global' &&
    (resourceListPages.has(route.page) ||
      [
        'onboarding',
        'board-editor',
        'board-view',
        'board-design',
        'link-editor',
        'pixel-editor',
        'link-detail',
        'pixel-detail',
        'team-detail',
      ].includes(route.page));
  const sourceTeam =
    !websiteRequired &&
    route.teamId &&
    (!route.id || ownedEntity) &&
    ['boards', 'board-editor', 'board-view', 'board-design'].includes(route.page)
      ? route.teamId
      : undefined;
  const siteScope =
    ['boards', 'board-view', 'board-editor', 'board-design'].includes(route.page) ||
    websiteRequired ||
    nav.query.scope === 'all'
      ? 'all'
      : 'personal';
  const needsSites =
    websiteRequired ||
    [
      'websites',
      'boards',
      'board-view',
      'board-editor',
      'board-design',
      'sharing',
      'team-detail',
    ].includes(route.page);
  const preferences = getFeaturePreferences();
  const timezone = preferences.timezone || 'Asia/Shanghai';
  const { dateRange, invalidDate } = useFeatureDateRange(timezone);
  const range = useMemo(
    () => featureDateRange(dateRange, timezone),
    [+dateRange.startDate, +dateRange.endDate, dateRange.value, dateRange.unit, timezone],
  );
  const setup = forceSetup || ['two-factor', 'backup-codes'].includes(route.page);
  const sitesQuery = useQuery({
    queryKey: [
      'liekan-feature',
      user.id,
      'sites',
      websiteRequired ? undefined : route.teamId,
      siteScope,
      sourceTeam,
    ],
    queryFn: async ({ signal }) => {
      const source = getFeatureSites(
        signal,
        websiteRequired ||
          ['boards', 'board-view', 'board-editor', 'board-design'].includes(route.page)
          ? undefined
          : route.teamId,
        siteScope,
      );
      if (!sourceTeam) return source;
      const collections = await Promise.all([source, getFeatureSites(signal, sourceTeam, 'all')]);
      return [...new Map(collections.flat().map(site => [site.id, site])).values()];
    },
    enabled: !setup && needsSites,
    retry: false,
    staleTime: 300000,
    gcTime: 600000,
  });
  const sites = rowsOf<FeatureEntity>(sitesQuery.data);
  const teamsQuery = useQuery({
    queryKey: ['liekan-feature', user.id, 'teams'],
    queryFn: ({ signal }) => getAllFeatureRows<FeatureEntity>('/me/teams', {}, signal),
    enabled: !setup && route.page !== 'help',
    retry: false,
    staleTime: 300000,
    gcTime: 600000,
  });
  const listedTeams: FeatureEntity[] = teamsQuery.data || [];
  const resolveTeam =
    !setup &&
    teamMetadataRequired &&
    route.teamId &&
    (!route.id ||
      resourceListPages.has(route.page) ||
      ownedEntity ||
      route.page === 'team-detail') &&
    teamsQuery.isSuccess &&
    !listedTeams.some(team => team.id === route.teamId);
  const scopeTeamQuery = useQuery<FeatureEntity>({
    queryKey: ['liekan-feature', user.id, 'scope-team', route.teamId],
    queryFn: ({ signal }) => featureApi.get(`/teams/${route.teamId}`, {}, signal),
    enabled: !!resolveTeam,
    retry: false,
  });
  const teams =
    resolveTeam && scopeTeamQuery.data ? [...listedTeams, scopeTeamQuery.data] : listedTeams;
  const teamState =
    teamMetadataRequired && (teamsQuery.isPending || teamsQuery.error)
      ? teamsQuery
      : resolveTeam
        ? scopeTeamQuery
        : undefined;
  const siteId = websiteRequired ? route.websiteId || '' : '';
  const siteQuery = useQuery({
    ...featureSiteQuery(user.id, siteId),
    enabled: !!siteId && !setup,
    retry: false,
  });
  const site = siteQuery.data || sites.find(s => websiteMatchesHandle(s, siteId));
  const current = forceSetup ? { ...route, page: 'two-factor' } : route;
  const websiteLayout = meta.scope === 'website';
  const [segmentsOpen, setSegmentsOpen] = useState(false);
  const [websiteContextTarget, setWebsiteContextTarget] = useState<HTMLDivElement>(null);
  const page = featurePages.find(p => p.id === current.page);
  const href = useCallback(
    (page: string, params: Record<string, any> = {}) =>
      featureNavigationHref(route, nav.query, page, params),
    [route.page, route.websiteId, route.id, route.teamId, route.context, JSON.stringify(nav.query)],
  );
  const navigate = useCallback(
    (page: string, params: Record<string, any> = {}) => nav.router.push(href(page, params)),
    [href, nav.router],
  );
  const pendingQuery = useRef<Record<string, any>>(null);
  const updateQuery = useCallback(
    (params: Record<string, any>) => {
      if (pendingQuery.current) {
        Object.assign(pendingQuery.current, params);
        return;
      }
      pendingQuery.current = { ...params };
      queueMicrotask(() => {
        const next = pendingQuery.current;
        pendingQuery.current = null;
        nav.router.replace(nav.updateParams(next), { scroll: false });
      });
    },
    [nav.router, nav.updateParams],
  );
  const notify = useCallback((message: string) => setToast(message), []);
  const refresh = useCallback(async () => {
    await refreshFeatureIdentity();
    await invalidateFeatureUserQueries(client, user.id);
  }, [client, user.id]);
  const filters = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(websiteRequired ? nav.query : {}).filter(([key]) =>
          /^(drill_|path|referrer|channel|title|query|os|device|browser|country|region|city|event|tag|hostname|distinctId|language|utm|segment|cohort|match|excludeBounce|attribution|retentionDate|retentionDay|spf\d|epf\d)/.test(
            key,
          ),
        ),
      ),
    [websiteRequired, JSON.stringify(nav.query)],
  );
  useEffect(() => {
    setDateOpen(false);
    setSegmentsOpen(false);
  }, [nav.pathname, route.websiteId, route.id]);
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
    sitesLoading: needsSites && sitesQuery.isPending,
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
    entity: ownedEntity,
    setEntity,
    updateQuery,
  };
  if (current.page === 'share-preview')
    return (
      <FeatureProvider value={value}>
        <div data-liekan-features lang="zh-CN" style={{ minHeight: '100dvh' }}>
          <WorkspacePages page="share-preview" />
        </div>
      </FeatureProvider>
    );
  const family = websiteAnalysisFamily(current);
  const currentTitle =
    family && !meta.parent && current.page !== 'segments'
      ? family.label
      : current.id && /-editor$/.test(current.page)
        ? (page?.title || '').replace(/^创建/, '编辑')
        : page?.title || '猎看统计';
  const pageKey = `${siteId || current.teamId || user.id}:${current.page}:${current.id || ''}`;
  const invalidRange = datePage && range.endAt - range.startAt > 1096 * 86400000;
  const readOnlyGlobalPage = !setup && ['websites'].includes(current.page);
  const metadata = teamState?.isPending || teamState?.error ? teamState : sitesQuery;
  const showAnalysisTools =
    websiteRequired &&
    !['tracking', 'install-check', 'website-settings', 'recorder-settings', 'sharing'].includes(
      current.page,
    ) &&
    !!siteId;
  const rangeContext = datePage && (
    <div className="range-context">
      统计期间：{formatInTimeZone(range.startAt, timezone, 'yyyy-MM-dd')} 至{' '}
      {formatInTimeZone(range.endAt, timezone, 'yyyy-MM-dd')} · 统计时区：{timezone}
    </div>
  );
  const analysisTabs = (
    <AnalysisTabs
      route={current}
      href={href}
      onSegments={siteId && !meta.parent ? () => setSegmentsOpen(true) : undefined}
    />
  );
  const content =
    readOnlyGlobalPage && !invalidRange ? (
      <QueryState readOnly={!metadata.error} query={metadata}>
        <FeaturePage key={pageKey} page={current.page} />
      </QueryState>
    ) : !setup && (teamState?.isPending || teamState?.error) ? (
      <QueryState query={teamState}>{null}</QueryState>
    ) : !setup && websiteRequired && !siteId ? (
      <Notice>
        请选择需要查看的网站。
        <QueryState query={sitesQuery}>
          <div className="form-actions">
            {sites.map(item => (
              <Link
                key={item.id}
                className="btn"
                href={featureHref(current.page, { websiteId: websiteHandle(item) })}
              >
                {item.name}
              </Link>
            ))}
            {!sites.length && (
              <Link className="btn" href={featureHref('websites')}>
                返回网站列表
              </Link>
            )}
          </div>
        </QueryState>
      </Notice>
    ) : !setup && websiteRequired && siteQuery.error ? (
      <QueryState query={siteQuery}>{null}</QueryState>
    ) : !setup && needsSites && !websiteRequired && (sitesQuery.isPending || sitesQuery.error) ? (
      <QueryState query={sitesQuery}>{null}</QueryState>
    ) : invalidRange ? (
      <Notice>日期范围上限 3 年，请调整日期后查看。</Notice>
    ) : (
      <FeaturePage key={pageKey} page={current.page} />
    );
  const dateControl = datePage && (
    <Button onClick={() => setDateOpen(true)}>
      {formatInTimeZone(range.startAt, timezone, 'yyyy-MM-dd')} 至{' '}
      {formatInTimeZone(range.endAt, timezone, 'MM-dd')}
      <Icon name="down" />
    </Button>
  );
  // 快捷时间按钮只进网站项目工具栏；非 websiteLayout 的页头（dateControl 的另一处渲染）不加。
  const websiteDateActions =
    websiteLayout &&
    datePage && (
      <>
        <QuickRangeButtons
          variant="btn"
          activeToken={activeQuickDateRange(nav.query)}
          onSelect={token =>
            nav.router.push(
              nav.updateParams({
                date: token,
                unit: undefined,
                offset: undefined,
                dateMode: undefined,
                live: undefined,
              }),
            )
          }
        />
        {dateControl}
      </>
    );
  if (setup)
    return (
      <FeatureProvider value={value}>
        <div data-liekan-features lang="zh-CN" className="identity-flow">
          <main className="content" id="main-content">
            <h1>{currentTitle}</h1>
            <AnalysisTabs
              route={current}
              href={href}
              onSegments={siteId && !meta.parent ? () => setSegmentsOpen(true) : undefined}
            />
            {content}
          </main>
          <ProductFooter />
          {toast && (
            <div className="toast" role="status">
              {toast}
            </div>
          )}
        </div>
      </FeatureProvider>
    );
  return (
    <FeatureProvider value={value}>
      <div
        data-liekan-features
        data-website-layout={websiteLayout || undefined}
        lang="zh-CN"
        style={
          {
            minHeight: '100dvh',
            '--lk-side-w': `${width}px`,
            '--side': `${width}px`,
          } as CSSProperties
        }
      >
        <a className="skip" href="#main-content">
          跳到主要内容
        </a>
        <Navigation
          user={user}
          route={current}
          site={site}
          width={width}
          onWidth={setWidth}
          href={href}
          websiteContextTarget={websiteContextTarget}
        />
        <div className="shell-content">
          {websiteLayout && (
            <WebsiteToolbar contextRef={setWebsiteContextTarget} actions={websiteDateActions} />
          )}
          <header className="header">
            <div className="header-inner">
              <div>
                <h1>{currentTitle}</h1>
              </div>
              <div className="header-actions">
                {!websiteLayout && dateControl}
                {resourceListPages.has(current.page) && meta.scope === 'global' && (
                  <label className="context-select">
                    <span>所属空间</span>
                    <select
                      aria-label="所属空间"
                      value={
                        route.teamId ||
                        (current.page === 'websites' && nav.query.scope === 'all' ? 'all' : '')
                      }
                      onChange={event =>
                        nav.router.push(
                          featureHref(current.page, {
                            ...Object.fromEntries(
                              Object.entries(nav.query).filter(([key]) =>
                                [
                                  'date',
                                  'unit',
                                  'offset',
                                  'compare',
                                  'search',
                                  'sort',
                                  'direction',
                                ].includes(key),
                              ),
                            ),
                            ...(event.target.value === 'all'
                              ? { scope: 'all' }
                              : event.target.value
                                ? { teamId: event.target.value }
                                : {}),
                          }),
                        )
                      }
                    >
                      <option value="">个人空间</option>
                      {route.teamId && !teams.some(team => team.id === route.teamId) && (
                        <option value={route.teamId} disabled>
                          {teamsQuery.error || scopeTeamQuery.error
                            ? '所选团队（无法访问）'
                            : '正在确认团队空间'}
                        </option>
                      )}
                      {current.page === 'websites' && <option value="all">全部可访问网站</option>}
                      {teams.map(team => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                    <Icon name="down" />
                  </label>
                )}
              </div>
            </div>
          </header>
          {showAnalysisTools && (
            <>
              <div className={shellStyles.tabsFrame} data-analysis-tabs-frame>
                {analysisTabs}
              </div>
              <div className={`analysis-context ${shellStyles.analysisTools}`}>
                {rangeContext}
                <div className="analysis-tools">
                  <Link href={href('filters')}>高级筛选</Link>
                  <Link href={href('annotations')}>图表注释</Link>
                  <Link href={href('exports')}>导出数据</Link>
                </div>
              </div>
            </>
          )}
          <main className="content" id="main-content">
            {datePage && invalidDate && (
              <Notice tone="amber">
                日期参数无效，当前使用默认日期范围。
                <Button
                  onClick={() =>
                    updateQuery({
                      date: '30day',
                      unit: undefined,
                      offset: undefined,
                      dateMode: undefined,
                      live: undefined,
                    })
                  }
                >
                  重置日期
                </Button>
              </Notice>
            )}
            {!showAnalysisTools && rangeContext}
            {websiteRequired && nav.query.clearedFilters === '1' && (
              <Notice>已清除当前页面不支持的筛选，统计采用页面显示的条件。</Notice>
            )}
            {!showAnalysisTools && analysisTabs}
            {content}
          </main>
          <ProductFooter />
        </div>
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
        {segmentsOpen && <SavedSegments onClose={() => setSegmentsOpen(false)} />}
        {dateOpen && (
          <LiekanDialog
            title="选择日期范围"
            subtitle={timezone}
            protectUnsaved={false}
            onClose={() => setDateOpen(false)}
          >
            <Form
              trackUnsaved={false}
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
                    dateMode: undefined,
                    live: undefined,
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
          </LiekanDialog>
        )}
      </div>
    </FeatureProvider>
  );
}

function FeaturePage({ page }: { page: string }) {
  if (['access-denied', 'session-expired', 'not-found'].includes(page))
    return (
      <Notice>
        {page === 'access-denied'
          ? '当前账户没有访问此资源的权限。'
          : page === 'session-expired'
            ? '请重新登录后继续。'
            : '页面不存在或已被移除。'}
        <div className="form-actions">
          <Link className="btn" href={page === 'session-expired' ? '/login' : '/websites'}>
            {page === 'session-expired' ? '重新登录' : '返回工作台'}
          </Link>
        </div>
      </Notice>
    );
  if (aiPages.has(page)) return <AiPages page={page} />;
  if (page === 'help') return <HelpCenter />;
  if (coreFeaturePages.has(page)) return <CorePages page={page} />;
  if (analysisPages.has(page)) return <AnalyticsPages page={page} />;
  if (extendedPages.has(page)) return <ExtendedPages page={page} />;
  if (workspacePages.has(page)) return <WorkspacePages page={page} />;
  if (linksPixelsPages.has(page)) return <LinksPixelsPages page={page} />;
  return null;
}
