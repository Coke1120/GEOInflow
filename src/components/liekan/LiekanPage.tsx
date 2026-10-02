'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi, useDateRange, useNavigation, useWebsite } from '@/lib/liekan/upstream/client';
import styles from '@/styles/liekan/Shell.module.css';
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
import { useLiekanShell } from './LiekanShell';
import { ManagementDrawer } from './ManagementDrawer';
import { AiBots } from './pages/AiBots';
import { AiOverview } from './pages/AiOverview';
import { AiPages } from './pages/AiPages';
import { AiPreference } from './pages/AiPreference';
import { Content } from './pages/Content';
import { Conversions } from './pages/Conversions';
import { HumanGeo } from './pages/HumanGeo';
import { HumanOverview } from './pages/HumanOverview';
import { HumanSources } from './pages/HumanSources';
import { Logs } from './pages/Logs';
import { Overview } from './pages/Overview';
import { ReportContext } from './ReportContext';
import type { LiekanReport, Resource } from './types';
import { defaultDateRange, isLiveLogView, previousWeekRange, readViewState } from './viewState';

const views = {
  overview: Overview,
  'ai/overview': AiOverview,
  'ai/bots': AiBots,
  'ai/pages': AiPages,
  'ai/preference': AiPreference,
  'human/overview': HumanOverview,
  'human/geo': HumanGeo,
  'human/sources': HumanSources,
  content: Content,
  conversions: Conversions,
  logs: Logs,
};
export function LiekanPage({ resource }: { resource: Resource }) {
  const api = useApi();
  const { websiteId, teamId, query: params, router, updateParams, renderUrl } = useNavigation();
  const website = useWebsite();
  const { dateRange } = useDateRange({ timezone: 'Asia/Shanghai' });
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
  const defaultRange = defaultDateRange(now);
  const startAt = liveLogs
    ? liveNow - 30 * 86400000
    : params.date
      ? dateRange.startDate.getTime()
      : defaultRange.startAt;
  const endAt = liveLogs ? liveNow : params.date ? dateRange.endDate.getTime() : defaultRange.endAt;
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
  const query = api.useQuery<LiekanReport>({
    queryKey: [
      'liekan',
      websiteId,
      teamId,
      resource,
      startAt,
      endAt,
      'Asia/Shanghai',
      chartPeriod,
      resource === 'logs' ? filter : '',
      resource === 'logs' ? search : '',
      resource === 'logs' ? logPage : 1,
      resource === 'logs' ? cursor : '',
      resource === 'logs' ? seek : '',
    ],
    queryFn: () =>
      api.get(`/liekan/websites/${websiteId}/report`, {
        resource,
        startAt,
        endAt,
        timezone: 'Asia/Shanghai',
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
      }),
    enabled: !!websiteId,
    placeholderData: (previous, previousQuery) =>
      previous?.website.id === websiteId &&
      previousQuery?.queryKey[3] === resource &&
      (liveLogs || (previous.range.startAt === startAt && previous.range.endAt === endAt))
        ? previous
        : undefined,
    refetchInterval: resource === 'logs' && !liveLogs ? 10000 : false,
  });
  const previous = api.useQuery<LiekanReport>({
    queryKey: [
      'liekan',
      websiteId,
      teamId,
      resource,
      shiftedRange.startAt,
      shiftedRange.endAt,
      'Asia/Shanghai',
    ],
    queryFn: () =>
      api.get(`/liekan/websites/${websiteId}/report`, {
        resource,
        ...shiftedRange,
        timezone: 'Asia/Shanghai',
      }),
    enabled: compare && !!websiteId,
  });
  const report = query.data;
  const rangeLabel = useMemo(() => {
    const date = (value: number) =>
      new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        timeZone: 'Asia/Shanghai',
      }).format(value);
    return `${date(startAt)} – ${date(endAt)}`;
  }, [startAt, endAt]);
  useEffect(() => {
    if (!shell) return;
    if (report?.website) shell.setWebsite(report.website);
    else if (website)
      shell.setWebsite({ id: website.id, name: website.name, domain: website.domain });
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
      query.refetch().then(result => {
        setMessage(result.isError ? '读取数据失败，请重试' : '已根据当前数据重新生成内容建议');
      });
      return;
    }
    if (label === '对比上周') {
      updateView({ compareWeek: '1' });
      return;
    }
    if (label === '站点设置') {
      router.push(renderUrl(`/settings/websites/${websiteId}`, { liekanShell: '1' }));
      return;
    }
    if (label === 'UTM 管理') {
      router.push(renderUrl(`/websites/${websiteId}/utm`, { liekanShell: '1' }));
      return;
    }
    if (label === '目标配置') {
      router.push(renderUrl(`/websites/${websiteId}/goals`, { liekanShell: '1' }));
      return;
    }
    setAction(label);
  };
  const period = chartPeriod === '24h' ? '24h' : chartPeriod === '7d' ? '7 天' : '30 天';
  const View = views[resource];
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
            <h1 className="text-[16px] font-bold tracking-tight">{page.title}</h1>
            <p className={styles.subtitle}>
              <button
                type="button"
                className={styles.dateButton}
                onClick={() => setAction('统计范围')}
                title="选择统计日期"
              >
                {report?.website.domain || website?.domain || '当前站点'} · {rangeLabel} ·
                Asia/Shanghai
              </button>
              {report?.meta.demo && <span className={styles.demoBadge}>演示数据</span>}
            </p>
          </div>
          <div className={styles.headerActions}>
            {page.actions.map(label => (
              <button key={label} type="button" className="chip" onClick={() => onAction(label)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {(query.isError || message || search) && (
        <div className={styles.notice} role="status">
          {query.isError ? '无法读取此范围的数据' : message || `查询：${search}`}
          {query.isError && (
            <button type="button" onClick={() => query.refetch()}>
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
      <View
        report={report}
        rangeLabel={rangeLabel}
        live={liveLogs}
        trendLabel={
          chartPeriod === '24h' ? '近 24 小时' : chartPeriod === '7d' ? '近 7 天' : '近 30 天'
        }
      />
      {(action || compare) && (
        <ManagementDrawer
          action={compare ? '对比上周' : action}
          websiteId={websiteId}
          canManage={report?.meta.canManage || false}
          onClose={close}
          onSaved={() => (liveLogs ? setLiveNow(Date.now()) : query.refetch())}
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
                  previous: previous.data,
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
