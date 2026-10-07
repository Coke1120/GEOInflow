'use client';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { featureDateRange } from '@/lib/liekan/contracts/analysis';
import { managementLabels } from '@/lib/liekan/contracts/management';
import {
  geoPageFromPath,
  pageNavigation,
  websiteAnalysisFamily,
} from '@/lib/liekan/contracts/navigation';
import { websiteMatchesHandle } from '@/lib/liekan/website-handle';
import {
  useApi,
  useFeatureAppState,
  useFeatureDateRange,
  useNavigation,
  useWebsite,
} from '@/lib/liekan/upstream/client';
import { useFreshnessLifecycle } from '@/lib/liekan/upstream/client-freshness';
import { useDateRangeClock } from '@/lib/liekan/upstream/date-range-clock';
import { featureApi, getFeaturePreferences } from '@/lib/liekan/upstream/features-client';
import { pageReportQuery } from '@/lib/liekan/upstream/page-report-client';
import styles from '@/styles/liekan/Shell.module.css';
import { AnalysisLoading, reportViews } from './AnalysisLoading';
import { AnalysisTabs } from './AnalysisTabs';
import { useDataLoading } from './DataLoading';
import {
  cardLabels,
  csvMatrix,
  downloadFile,
  formatMetricValue,
  pages,
  primaryTables,
  stateLabels,
  tableCsv,
} from './data';
import { featureNavigationHref } from './features/routes';
import { useLiekanShell } from './LiekanShell';
import { ManagementDrawer } from './ManagementDrawer';
import { ReportContext } from './ReportContext';
import type { LiekanReport, Resource } from './types';
import {
  clearTablePages,
  defaultDateRange,
  isLiveLogView,
  previousWeekRange,
  readViewState,
} from './viewState';

export function LiekanPage({ resource }: { resource: Resource }) {
  const metadataLoading = useDataLoading();
  const api = useApi();
  const userId = useFeatureAppState(state => state.user?.id);
  const forceRefresh = useRef(false);
  const queryClient = useQueryClient();
  const { websiteId, teamId, pathname, query: params, router, updateParams } = useNavigation();
  const website = useWebsite();
  const timezone = getFeaturePreferences().timezone || 'Asia/Shanghai';
  const { dateRange, invalidDate } = useFeatureDateRange(timezone);
  const actualRange = featureDateRange(dateRange, timezone);
  const route = { page: geoPageFromPath(pathname), websiteId };
  const href = (page: string, values: Record<string, any> = {}) =>
    featureNavigationHref(route, params, page, values);
  const shell = useLiekanShell();
  const dynamicDefault = !params.date || params.dateMode === 'default';
  const now = useDateRangeClock(timezone, dynamicDefault);
  const [liveNow, setLiveNow] = useState(now);
  const { filter, search, logPage, cursor, seek, chartPeriod, sort, compare, tablePages } =
    readViewState(params, resource);
  const pageIdentity = JSON.stringify([
    userId,
    websiteId,
    teamId,
    pathname,
    resource,
    Object.entries(params).sort(([a], [b]) => a.localeCompare(b)),
  ]);
  const currentPage = useRef({ mounted: false, identity: pageIdentity });
  currentPage.current.identity = pageIdentity;
  useEffect(() => {
    currentPage.current.mounted = true;
    return () => {
      currentPage.current.mounted = false;
    };
  }, []);
  const [action, setAction] = useState('');
  const [message, setMessage] = useState('');
  const liveLogs = isLiveLogView(params, resource);
  const defaultRange = defaultDateRange(now, timezone);
  const startAt = liveLogs
    ? liveNow - 30 * 86400000
    : !dynamicDefault
      ? actualRange.startAt
      : defaultRange.startAt;
  const endAt = liveLogs ? liveNow : dynamicDefault ? defaultRange.endAt : actualRange.endAt;
  const page = pages.find(page => page.resource === resource);
  const shiftedRange = previousWeekRange(startAt, endAt);
  const updateView = (next: Record<string, string | number>) =>
    router.push(updateParams(next), { scroll: false });
  useEffect(() => {
    if (dynamicDefault && params.date !== `range:${defaultRange.startAt}:${defaultRange.endAt}`)
      router.replace(
        updateParams({
          date: `range:${defaultRange.startAt}:${defaultRange.endAt}`,
          dateMode: 'default',
          live: resource === 'logs' ? '1' : undefined,
        }),
        {
          scroll: false,
        },
      );
    else if (liveLogs && params.live !== '1')
      router.replace(updateParams({ live: '1' }), { scroll: false });
  }, [
    params.date,
    dynamicDefault,
    params.live,
    resource,
    liveLogs,
    router,
    updateParams,
    defaultRange.startAt,
    defaultRange.endAt,
  ]);
  useEffect(() => {
    if (!liveLogs) return;
    setLiveNow(Date.now());
    const timer = window.setInterval(() => setLiveNow(Date.now()), 10000);
    return () => window.clearInterval(timer);
  }, [liveLogs]);
  const reportInput = {
    resource,
    startAt,
    endAt,
    timezone,
    chartPeriod,
    ...(Object.keys(tablePages).length ? { tablePages } : {}),
    ...(resource === 'logs'
      ? {
          page: logPage,
          filter:
            filter === '仅 AI 蜘蛛'
              ? 'ai'
              : filter === '仅异常'
                ? 'abnormal'
                : filter === '仅人类'
                  ? 'other'
                  : '',
          search: search.slice(0, 200),
          ...(cursor ? { cursor, seek } : {}),
        }
      : {}),
  };
  const currentReport = pageReportQuery(userId, websiteId, reportInput, teamId, () => {
    const value = forceRefresh.current;
    forceRefresh.current = false;
    return value;
  });
  const rawQuery = api.useQuery<LiekanReport>({
    ...currentReport,
    enabled: !!websiteId,
    placeholderData: (previous, previousQuery) => {
      // logs 换批与 tp_* 翻页都会换 queryKey：queryKey[13] 是 tp_ 页码集合槽位，
      // 仅该槽位变化时保留上一份数据，翻页期间显示旧切片 + 更新提示而非整页骨架。
      const pageTurnOnly =
        !!previousQuery &&
        currentReport.queryKey.length === previousQuery.queryKey.length &&
        currentReport.queryKey.every(
          (value, index) => index === 13 || value === previousQuery.queryKey[index],
        );
      return (resource === 'logs' || pageTurnOnly) &&
        websiteMatchesHandle(previous?.website, websiteId) &&
        previousQuery?.queryKey[3] === resource &&
        previousQuery?.queryKey[14] === userId &&
        (liveLogs || (previous.range.startAt === startAt && previous.range.endAt === endAt))
        ? previous
        : undefined;
    },
    refetchInterval: resource === 'logs' && !liveLogs ? 10000 : false,
  });
  const query = useFreshnessLifecycle(rawQuery, {
    queryKey: currentReport.queryKey,
    enabled: !!websiteId && !metadataLoading,
    aggregate: resource !== 'logs',
    endAt,
    timezone,
  });
  const reportKey = JSON.stringify(currentReport.queryKey);
  const activeReportKey = useRef(reportKey);
  activeReportKey.current = reportKey;
  const manualRefresh = useRef<{
    key: string;
    promise: Promise<boolean | undefined>;
  }>(null);
  const rawPrevious = api.useQuery<LiekanReport>({
    ...pageReportQuery(userId, websiteId, { resource, ...shiftedRange, timezone }, teamId),
    enabled: compare && !!websiteId,
  });
  const previous = useFreshnessLifecycle(rawPrevious, {
    queryKey: pageReportQuery(userId, websiteId, { resource, ...shiftedRange, timezone }, teamId)
      .queryKey,
    enabled: compare && !!websiteId && !metadataLoading,
    aggregate: resource !== 'logs',
    endAt: shiftedRange.endAt,
    timezone,
  });
  const restricted = [401, 403, 404].includes((query.error as any)?.status);
  const previousRestricted = [401, 403, 404].includes((previous.error as any)?.status);
  const displayKey = ['liekan-feature', userId, 'website-display-settings', websiteId];
  const displayQuery = api.useQuery<{ aiCrawlerEnabled?: boolean }>({
    queryKey: displayKey,
    queryFn: ({ signal }) => featureApi.get(`/liekan/websites/${websiteId}/settings`, {}, signal),
    enabled: !!websiteId && !!userId && !metadataLoading,
    staleTime: 300000,
    retry: false,
  });
  const displayMismatch =
    !!query.data &&
    displayQuery.data?.aiCrawlerEnabled !== undefined &&
    (query.data.meta.aiCrawlerEnabled !== false) !== displayQuery.data.aiCrawlerEnabled;
  const synchronizedDisplay = useRef('');
  useEffect(() => {
    const key = `${websiteId}:${query.dataUpdatedAt}:${displayQuery.data?.aiCrawlerEnabled}`;
    if (
      !displayMismatch ||
      restricted ||
      metadataLoading ||
      displayQuery.isFetching ||
      displayQuery.error ||
      synchronizedDisplay.current === key
    )
      return;
    synchronizedDisplay.current = key;
    forceRefresh.current = true;
    void Promise.allSettled([displayQuery.refetch(), query.refetch()]);
  }, [
    websiteId,
    query.dataUpdatedAt,
    displayQuery.data?.aiCrawlerEnabled,
    displayMismatch,
    restricted,
    metadataLoading,
    displayQuery.isFetching,
    displayQuery.error,
  ]);
  const report = restricted || metadataLoading || displayMismatch ? undefined : query.data;
  const crawlerHidden =
    displayQuery.data?.aiCrawlerEnabled === false || query.data?.meta.aiCrawlerEnabled === false;
  const refresh = () => {
    if (displayMismatch || displayQuery.error) void displayQuery.refetch();
    if (manualRefresh.current?.key === reportKey) return manualRefresh.current.promise;
    const promise = (async () => {
      await queryClient.cancelQueries({ queryKey: currentReport.queryKey, exact: true });
      const updatesBefore = queryClient.getQueryState(currentReport.queryKey)?.dataUpdateCount || 0;
      forceRefresh.current = true;
      const result = await query.refetch({ cancelRefetch: false });
      if (result.isError) return false;
      // Cancelled reads can resolve with retained data; completion advances the update count.
      const updatesAfter = queryClient.getQueryState(currentReport.queryKey)?.dataUpdateCount || 0;
      return updatesAfter > updatesBefore ? true : undefined;
    })();
    const running = { key: reportKey, promise };
    manualRefresh.current = running;
    const release = () => {
      if (manualRefresh.current === running) manualRefresh.current = null;
    };
    void promise.then(release, release);
    return promise;
  };
  const afterSaved = async () => {
    const isCurrentPage = () =>
      currentPage.current.mounted && currentPage.current.identity === pageIdentity;
    const invalidate = async (refetchType: 'none' | 'active') => {
      const results = await Promise.allSettled([
        queryClient.invalidateQueries(
          { queryKey: ['liekan', websiteId], refetchType },
          { throwOnError: true },
        ),
        queryClient.invalidateQueries(
          { queryKey: ['liekan-feature', userId], refetchType },
          { throwOnError: true },
        ),
      ]);
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
    };
    await Promise.all([
      queryClient.cancelQueries({ queryKey: ['liekan', websiteId] }),
      queryClient.cancelQueries({ queryKey: ['liekan-feature', userId] }),
    ]);
    if (!isCurrentPage()) {
      await invalidate('active');
      return;
    }
    await invalidate('none');
    if (!isCurrentPage()) {
      await invalidate('active');
      return;
    }
    if (liveLogs) {
      const nextNow = Date.now();
      setLiveNow(nextNow);
      await queryClient.fetchQuery({
        ...pageReportQuery(
          userId,
          websiteId,
          { ...reportInput, startAt: nextNow - 30 * 86400000, endAt: nextNow },
          teamId,
          () => true,
        ),
        staleTime: 0,
      });
    } else {
      forceRefresh.current = true;
      await query.refetch({ throwOnError: true });
    }
  };
  const rangeLabel = useMemo(() => {
    const date = (value: number) =>
      new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        timeZone: timezone,
      }).format(value);
    return `${date(startAt)} – ${date(endAt)}`;
  }, [startAt, endAt, timezone]);
  useEffect(() => {
    if (!shell) return;
    if (report?.website)
      shell.setWebsite({
        ...report.website,
        teamId: website?.teamId,
        demo: report.meta.demo,
      } as any);
    else if (website)
      shell.setWebsite({
        id: website.id,
        name: website.name,
        domain: website.domain,
        teamId: website.teamId,
      } as any);
    if (report?.tables.botBody)
      shell.setBotCount(
        report.states.logs === 'not_connected' ? null : report.tables.botBody.length,
      );
  }, [report, website, shell?.setWebsite, shell?.setBotCount]);
  useEffect(() => {
    if (websiteMatchesHandle(report?.website, websiteId) && userId)
      queryClient.setQueryData(
        ['liekan-feature', userId, 'reported-crawler-display', websiteId],
        report.meta.aiCrawlerEnabled !== false,
      );
  }, [report, userId, websiteId, queryClient]);
  useEffect(() => {
    setMessage('');
    setAction('');
  }, [resource]);
  const close = useCallback(() => {
    setAction('');
    if (compare) router.push(updateParams({ compareWeek: undefined }), { scroll: false });
  }, [compare, router, updateParams]);
  const setRange = (start: number, end: number) =>
    router.push(
      updateParams({
        date: `range:${start}:${end}`,
        dateMode: undefined,
        live: undefined,
        page: undefined,
        cursor: undefined,
        seek: undefined,
      }),
    );
  const onFilter = (label: string) => {
    if (['30 天', '7 天', '24h'].includes(label)) {
      updateView({ chartPeriod: label === '24h' ? '24h' : label === '7 天' ? '7d' : '30d' });
      return;
    }
    // 筛选/排序改变行内容与顺序：清空服务端分页参数，等价回第 1 页并恢复本地全量模式。
    updateView({
      ...clearTablePages(tablePages),
      filter: label,
      page: undefined,
      cursor: undefined,
      seek: undefined,
    });
    setMessage(
      label === '仅人类'
        ? '此筛选显示未识别或其他请求；服务器日志无法确认访问者为人类。'
        : label === '按重复率' && !report?.tables.apBody?.some(row => row.repeatRate != null)
          ? '重复抓取率待接入，当前保留已有页面顺序。'
          : '',
    );
  };
  const gotoLogsPage = (page: number) => {
    const next = page > logPage;
    const cursor = next ? report?.meta.nextCursor : report?.meta.previousCursor;
    updateView({
      page,
      cursor: cursor || undefined,
      seek: cursor ? (next ? 'after' : 'before') : undefined,
    });
  };
  const onAction = (label: string) => {
    if (label.startsWith('导出')) {
      if (!report || query.isFetching) {
        setMessage('数据仍在读取，请稍后重试');
        return;
      }
      const table =
        resource === 'overview' && report.meta.aiCrawlerEnabled === false
          ? 'visitorTopBody'
          : resource === 'content' && report.meta.aiCrawlerEnabled === false
            ? 'visitorPgBody'
            : primaryTables[resource];
      // 服务端分页表中客户端只持有当前切片；切片未覆盖全量时导出走既有服务端导出
      // （10 万行/50 MiB 上限），整表就在当前切片内则保留本地 CSV。
      const serverPage = table ? report.meta.tablePages?.[table] : undefined;
      if (serverPage && !(serverPage.page === 1 && serverPage.total <= serverPage.pageSize)) {
        router.push(href('exports'));
        return;
      }
      const content = table
        ? tableCsv(table, report.tables[table] || [], filter, sort, search)
        : csvMatrix(
            ['指标', '数值', '状态'],
            report.cards
              .filter(card => cardLabels[resource]?.includes(card.label))
              .map(card => [
                card.label,
                formatMetricValue(card),
                stateLabels[card.state] || '已接入',
              ]),
          );
      downloadFile(
        content,
        `liekan-${resource.replaceAll('/', '-')}-${new Date(endAt).toISOString().slice(0, 10)}.csv`,
      );
      setMessage('已导出当前范围与筛选结果');
      return;
    }
    if (label === '生成内容建议') {
      refresh().then(succeeded => {
        if (succeeded === undefined || activeReportKey.current !== reportKey) return;
        setMessage(succeeded ? '已根据当前数据重新生成内容建议' : '读取数据失败，请重试');
      });
      return;
    }
    if (label === '对比上周') {
      updateView({ compareWeek: '1' });
      return;
    }
    if (label === '站点设置') {
      router.push(href('website-settings'));
      return;
    }
    if (label === 'UTM 管理') {
      router.push(href('utm'));
      return;
    }
    if (label === '目标配置') {
      router.push(href('goals'));
      return;
    }
    setAction(label);
  };
  const [displaySaving, setDisplaySaving] = useState(false);
  const [promptHidden, setPromptHidden] = useState(false);
  useEffect(() => setPromptHidden(false), [websiteId]);
  async function hideCrawlerDisplay() {
    if (!report?.meta.canManage || displaySaving) return;
    setDisplaySaving(true);
    const site = websiteId;
    try {
      const result = await api.put(`/liekan/websites/${site}/settings`, {
        aiCrawlerEnabled: false,
      });
      await queryClient.cancelQueries({
        queryKey: ['liekan-feature', userId, 'website-display-settings', site],
      });
      queryClient.setQueryData(
        ['liekan-feature', userId, 'website-display-settings', site],
        result,
      );
      await queryClient.invalidateQueries({ queryKey: ['liekan', site] });
      await queryClient.invalidateQueries({ queryKey: ['liekan-feature', userId] });
      setMessage('已切换为访客统计，可从网站设置重新开启');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败，请重试');
    } finally {
      setDisplaySaving(false);
    }
  }
  if (crawlerHidden && resource.startsWith('ai/') && !restricted && !metadataLoading)
    return (
      <div className={styles.notice}>
        <h2 className="font-bold text-ink">AI 蜘蛛数据展示已关闭</h2>
        <p className="mt-2">已有数据和采集配置会保留，可从网站设置重新开启。</p>
        {displayMismatch && (displayQuery.error || query.error) && (
          <div role="alert">
            <p className="mt-2">展示设置读取失败，请重新同步。</p>
            <button onClick={refresh}>重新读取设置与报表</button>
          </div>
        )}
        <div className="flex flex-wrap gap-4 mt-3 text-brand">
          <Link href={href('overview')}>查看访客统计</Link>
          <Link href={href('website-settings', { section: 'basic' })}>网站设置</Link>
        </div>
      </div>
    );
  const period = chartPeriod === '24h' ? '24h' : chartPeriod === '7d' ? '7 天' : '30 天';
  const View = reportViews[resource];
  const headerActions = (
    <div className={styles.headerActions}>
      <button
        type="button"
        className="chip"
        onClick={() => setAction('统计范围')}
        title={`统计时区：${timezone}`}
      >
        {rangeLabel}
      </button>
      {page.actions.map(label => (
        <button key={label} type="button" className="chip" onClick={() => onAction(label)}>
          {label === '站点设置'
            ? '网站设置'
            : label === 'UTM 管理'
              ? 'UTM 活动'
              : managementLabels[label] || label}
        </button>
      ))}
    </div>
  );
  return (
    <ReportContext.Provider
      value={{
        filter,
        query: search,
        sort,
        period,
        onFilter,
        onSort: label => {
          updateView({
            ...clearTablePages(tablePages),
            filter: filter.startsWith('按') ? undefined : filter,
            sort: label,
            direction: sort.label === label && sort.direction === -1 ? 'asc' : 'desc',
          });
        },
        onAction,
        onLogsPage: gotoLogsPage,
        // 翻页只改本表页码；各表白名单独立，其他表已请求的页码保持不变。
        onTablePage: (table, page) =>
          updateView({ [`tp_${table}`]: page > 1 ? page : undefined }),
      }}
    >
      {shell?.websiteActionsTarget && createPortal(headerActions, shell.websiteActionsTarget)}
      <div className={styles.header}>
        <div className={styles.headerInner}>
          <div>
            <h1 className="text-[16px] font-bold tracking-tight">
              {websiteAnalysisFamily(route)?.label ||
                pageNavigation[route.page]?.title ||
                page.title}
            </h1>
          </div>
          {!shell?.websiteActionsTarget && headerActions}
        </div>
      </div>
      <div className={styles.tabsFrame}>
        <AnalysisTabs route={route} href={href} />
      </div>
      <div className={styles.analysisTools}>
        {resource === 'logs' && (
          <span>
            每 10 秒刷新已导入日志 · 最近导入：
            {report?.meta.latestImportAt
              ? new Date(report.meta.latestImportAt).toLocaleString('zh-CN', { timeZone: timezone })
              : query.isPending
                ? '正在读取'
                : query.isError
                  ? '读取失败'
                  : '尚未导入'}
          </span>
        )}
        <Link href={href('filters')}>高级筛选</Link>
        <Link href={href('annotations')}>图表注释</Link>
        <Link href={href('exports')}>导出数据</Link>
        <Link href={href('sharing', { context: 'website' })}>分享当前网站</Link>
      </div>
      {invalidDate && (
        <div className={styles.tools} role="status">
          日期参数无效，当前使用默认日期范围。
          <button
            onClick={() =>
              router.replace(updateParams({ date: '30day', unit: undefined, offset: undefined }), {
                scroll: false,
              })
            }
          >
            重置日期
          </button>
        </div>
      )}
      {params.clearedFilters === '1' && (
        <div className={styles.notice}>已清除当前页面不支持的筛选，统计采用页面显示的条件。</div>
      )}
      {(query.isError || message || search) && (
        <div className={styles.notice} role="status">
          {query.isError
            ? report
              ? '更新失败，当前显示上次读取的数据'
              : query.isStaleAggregate && !restricted
                ? query.error?.message || '统计数据已过期，请重试读取。'
                : '无法读取此范围的数据'
            : message || `查询：${search}`}
          {query.isError && (
            <button type="button" onClick={() => refresh()}>
              重试
            </button>
          )}
          {query.isError && !report && !restricted && !liveLogs && (
            <>
              也可缩小时间范围后重试：
              {(
                [
                  ['24hour', '近 24 小时'],
                  ['7day', '近 7 天'],
                  ['30day', '近 30 天'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => updateView({ date: value, unit: undefined, offset: undefined })}
                >
                  {label}
                </button>
              ))}
            </>
          )}
          {search && (
            <button
              type="button"
              onClick={() =>
                updateView({
                  search: undefined,
                  page: undefined,
                  cursor: undefined,
                  seek: undefined,
                })
              }
            >
              清除查询
            </button>
          )}
        </div>
      )}
      {report && query.isFetching && (
        <div className={styles.notice} role="status">
          正在更新统计数据
        </div>
      )}
      {report && query.isStaleAggregate && !query.isFetching && !query.error && (
        <div className={styles.notice} role="status">
          统计待更新
        </div>
      )}
      {displayMismatch && !restricted && (displayQuery.error || query.error) && (
        <div className={styles.notice} role="alert">
          数据展示设置与报表暂未同步，请重试读取。
          <button onClick={refresh}>重新读取设置与报表</button>
        </div>
      )}
      {resource === 'overview' &&
        report &&
        !crawlerHidden &&
        !promptHidden &&
        (report.meta.logsConfigured === false ||
          (report.meta.logsConfigured === undefined && report.states.logs === 'not_connected')) && (
          <div className={styles.notice}>
            尚未接入 AI 蜘蛛日志。暂不接入时，可仅展示访客统计。
            <Link
              className="text-brand ml-3"
              href={href('website-settings', { section: 'install', step: 'logs' })}
            >
              接入日志
            </Link>
            {report.meta.canManage ? (
              <button disabled={displaySaving} onClick={hideCrawlerDisplay}>
                {displaySaving ? '正在保存…' : '仅展示访客统计'}
              </button>
            ) : (
              <Link
                className="text-brand ml-3"
                href={href('website-settings', { section: 'basic' })}
              >
                数据展示设置
              </Link>
            )}
            <button onClick={() => setPromptHidden(true)}>保留展示</button>
          </div>
        )}
      {report ? (
        <View
          report={report}
          aiCrawlerEnabled={!crawlerHidden}
          rangeLabel={rangeLabel}
          live={liveLogs}
          trendLabel={
            chartPeriod === '24h' ? '近 24 小时' : chartPeriod === '7d' ? '近 7 天' : '近 30 天'
          }
        />
      ) : metadataLoading || query.isPending || displayMismatch || (query.isError && !restricted) ? (
        <AnalysisLoading
          resource={resource}
          aiCrawlerEnabled={!crawlerHidden}
          rangeLabel={rangeLabel}
          trendLabel={
            chartPeriod === '24h' ? '近 24 小时' : chartPeriod === '7d' ? '近 7 天' : '近 30 天'
          }
        />
      ) : null}
      {(action || compare) && (
        <ManagementDrawer
          action={compare ? '对比上周' : action}
          websiteId={websiteId}
          websiteName={report?.website?.name || website?.name}
          websiteDomain={report?.website?.domain || website?.domain}
          canManage={report?.meta.canManage || false}
          onClose={close}
          onSaved={afterSaved}
          onSearch={value =>
            updateView({
              search: value.slice(0, 200),
              page: undefined,
              cursor: undefined,
              seek: undefined,
            })
          }
          initialSearch={search}
          onPage={gotoLogsPage}
          onLogsFilter={onFilter}
          logsFilter={filter}
          report={report}
          isFetching={query.isFetching}
          onRange={setRange}
          comparison={
            compare
              ? {
                  current: report,
                  previous: previousRestricted || metadataLoading ? undefined : previous.data,
                  startAt,
                  endAt,
                  previousStartAt: shiftedRange.startAt,
                  previousEndAt: shiftedRange.endAt,
                  labels:
                    resource === 'overview' && report?.meta.aiCrawlerEnabled === false
                      ? ['访客数 UV', '浏览量 PV', '跳出率', '平均访问时长']
                      : cardLabels[resource] || [],
                  error: previous.error,
                  fetching: previous.isFetching,
                  refetch: () => previous.refetch(),
                }
              : undefined
          }
        />
      )}
    </ReportContext.Provider>
  );
}
