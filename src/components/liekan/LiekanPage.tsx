'use client';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { pageReportQuery } from '@/lib/liekan/upstream/page-report-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { featureDateRange } from '@/lib/liekan/contracts/analysis';
import {
  geoPageFromPath,
  pageNavigation,
  websiteAnalysisFamily,
} from '@/lib/liekan/contracts/navigation';
import {
  useApi,
  useFeatureDateRange,
  useNavigation,
  useWebsite,
  useFeatureAppState,
} from '@/lib/liekan/upstream/client';
import { getFeaturePreferences } from '@/lib/liekan/upstream/features-client';
import styles from '@/styles/liekan/Shell.module.css';
import { geoViews } from './GeoLoading';
import { DataLoadingContext, hidesPreviousData } from './LoadingState';
import { QueryFeedback } from './QueryFeedback';
import { loadEcharts } from './chartRuntime';
import { AnalysisTabs } from './AnalysisTabs';
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
import { defaultDateRange, isLiveLogView, previousWeekRange, readViewState } from './viewState';

export function LiekanPage({ resource }: { resource: Resource }) {
  const api = useApi();
  const userId = useFeatureAppState(state => state.user?.id);
  const forceRefresh = useRef(false);
  const queryClient = useQueryClient();
  useEffect(() => {
    void loadEcharts().catch(() => {});
  }, []);
  const { websiteId, teamId, pathname, query: params, router, updateParams } = useNavigation();
  const website = useWebsite();
  const timezone = getFeaturePreferences().timezone || 'Asia/Shanghai';
  const { dateRange, invalidDate } = useFeatureDateRange(timezone);
  const actualRange = featureDateRange(dateRange, timezone);
  const route = { page: geoPageFromPath(pathname), websiteId };
  const href = (page: string, values: Record<string, any> = {}) =>
    featureNavigationHref(route, params, page, values);
  const shell = useLiekanShell();
  const [now] = useState(() => Date.now());
  const [liveNow, setLiveNow] = useState(now);
  const { filter, search, logPage, cursor, seek, chartPeriod, sort, compare } = readViewState(
    params,
    resource,
  );
  const [action, setAction] = useState('');
  const [message, setMessage] = useState('');
  const liveLogs = isLiveLogView(params, resource);
  const defaultRange = defaultDateRange(now, timezone);
  const startAt = liveLogs
    ? liveNow - 30 * 86400000
    : params.date
      ? actualRange.startAt
      : defaultRange.startAt;
  const endAt = liveLogs ? liveNow : params.date ? actualRange.endAt : defaultRange.endAt;
  const page = pages.find(page => page.resource === resource);
  const shiftedRange = previousWeekRange(startAt, endAt);
  const updateView = (next: Record<string, string | number>) =>
    router.push(updateParams(next), { scroll: false });
  useEffect(() => {
    if (!params.date)
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
  const currentReport = pageReportQuery(
    userId,
    websiteId,
    {
      resource,
      startAt,
      endAt,
      timezone,
      chartPeriod,
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
    },
    teamId,
    () => {
      const value = forceRefresh.current;
      forceRefresh.current = false;
      return value;
    },
    liveLogs,
  );
  const query = api.useQuery<LiekanReport>({
    ...currentReport,
    enabled: !!websiteId,
    refetchInterval: resource === 'logs' ? 10000 : false,
  });
  const reportKey = JSON.stringify(currentReport.queryKey);
  const activeReportKey = useRef(reportKey);
  activeReportKey.current = reportKey;
  const manualRefresh = useRef<{
    key: string;
    promise: Promise<boolean | undefined>;
  }>(null);
  const previous = api.useQuery<LiekanReport>({
    ...pageReportQuery(userId, websiteId, { resource, ...shiftedRange, timezone }, teamId),
    enabled: compare && !!websiteId,
  });
  const report = hidesPreviousData(query.error) ? undefined : query.data;
  const refresh = () => {
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
    const reads = [{ queryKey: ['liekan', websiteId] }, { queryKey: ['liekan-feature', userId] }];
    await Promise.all(reads.map(filters => queryClient.cancelQueries(filters)));
    forceRefresh.current = true;
    if (liveLogs) setLiveNow(Date.now());
    await Promise.all(reads.map(filters => queryClient.invalidateQueries(filters)));
    const error = queryClient.getQueryState(currentReport.queryKey)?.error;
    if (error) throw error;
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
    updateView({ filter: label, page: undefined, cursor: undefined, seek: undefined });
    setMessage(
      label === '仅人类'
        ? '此筛选显示未识别或其他请求；服务器日志无法确认访问者为人类。'
        : label === '按重复率' && !report?.tables.apBody?.some(row => row.repeatRate != null)
          ? '重复抓取率待接入，当前保留已有页面顺序。'
          : '',
    );
  };
  const onAction = (label: string) => {
    if (label.startsWith('导出')) {
      if (!report || query.isFetching) {
        setMessage('数据仍在读取，请稍后重试');
        return;
      }
      const table = primaryTables[resource];
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
  const period = chartPeriod === '24h' ? '24h' : chartPeriod === '7d' ? '7 天' : '30 天';
  const View = geoViews[resource];
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
            filter: filter.startsWith('按') ? undefined : filter,
            sort: label,
            direction: sort.label === label && sort.direction === -1 ? 'asc' : 'desc',
          });
        },
        onAction,
      }}
    >
      <div className={styles.header}>
        <div className={styles.headerInner}>
          <div>
            <h1 className="text-[16px] font-bold tracking-tight">
              {websiteAnalysisFamily(route)?.label ||
                pageNavigation[route.page]?.title ||
                page.title}
            </h1>
          </div>
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
                {label === '站点设置' ? '网站设置' : label === 'UTM 管理' ? 'UTM 活动' : label}
              </button>
            ))}
          </div>
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
      {((query.isError && !report) || message || search) && (
        <div className={styles.notice} role="status">
          {query.isError ? '无法读取此范围的数据' : message || `查询：${search}`}
          {query.isError && (
            <button type="button" onClick={() => refresh()}>
              重试
            </button>
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
      <div className={styles.readRegion}>
        {report && <QueryFeedback query={query} />}
        {report || query.isPending ? (
          <DataLoadingContext.Provider value={!!query.isPending}>
            {query.isPending && (
              <span className={styles.srOnly} role="status">
                正在读取统计数据
              </span>
            )}
            <View
              report={report}
              rangeLabel={rangeLabel}
              live={liveLogs}
              trendLabel={
                chartPeriod === '24h' ? '近 24 小时' : chartPeriod === '7d' ? '近 7 天' : '近 30 天'
              }
            />
          </DataLoadingContext.Provider>
        ) : null}
      </div>
      {(action || compare) && (
        <ManagementDrawer
          action={compare ? '对比上周' : action}
          websiteId={websiteId}
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
          onPage={page => {
            const next = page > logPage;
            const cursor = next ? report?.meta.nextCursor : report?.meta.previousCursor;
            updateView({
              page,
              cursor: cursor || undefined,
              seek: cursor ? (next ? 'after' : 'before') : undefined,
            });
          }}
          onLogsFilter={onFilter}
          logsFilter={filter}
          report={report}
          isFetching={query.isFetching}
          onRange={setRange}
          comparison={
            compare
              ? {
                  current: report,
                  previous: hidesPreviousData(previous.error) ? undefined : previous.data,
                  startAt,
                  endAt,
                  previousStartAt: shiftedRange.startAt,
                  previousEndAt: shiftedRange.endAt,
                  labels: cardLabels[resource] || [],
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
