'use client';
import type { KeywordConditions } from '../contracts/keywords';
import type { LiekanPageReport, ReportResource } from '../contracts/page-report';
import {
  freshnessStaleTime,
  hasClientFreshness,
  remainingFreshness,
  shareWithFreshness,
  withClientFreshness,
} from './client-freshness';
import { featureApi } from './features-client';

export function pageReportQuery(
  userId: string,
  websiteId: string,
  input: Partial<KeywordConditions> & {
    resource: ReportResource;
    startAt: number;
    endAt: number;
    timezone: string;
    chartPeriod?: string;
    filter?: string;
    search?: string;
    page?: number;
    cursor?: string;
    keywordSnapshot?: string;
    seek?: string;
    tablePages?: Record<string, number>;
    geoSort?: 'city' | 'sessions' | 'share' | 'duration' | 'bounceRate' | 'conversionRate';
  },
  teamId?: string,
  fresh?: () => boolean,
  priority: 'foreground' | 'prefetch' = 'foreground',
) {
  const p = { chartPeriod: '30d', filter: '', search: '', page: 1, cursor: '', seek: '', ...input };
  // tablePages 以扁平 tp_<table> 参数上送（reportQuery 归口解析）；
  // queryKey 记录排序后的页码集合，保证等价分页状态命中同一缓存。
  const tpParams = Object.fromEntries(
    Object.entries(p.tablePages ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([table, tablePage]) => [`tp_${table}`, tablePage]),
  );
  const queryKey = [
    'liekan',
    websiteId,
    teamId,
    p.resource,
    p.startAt,
    p.endAt,
    p.timezone,
    p.chartPeriod,
    p.filter,
    p.search,
    p.page,
    p.cursor,
    p.seek,
    JSON.stringify(tpParams),
    userId,
  ];
  if (p.resource === 'human/geo')
    queryKey.push(JSON.stringify([p.geoSort || 'sessions', p.direction || 'desc']));
  if (p.resource === 'human/keywords')
    queryKey.push(
      JSON.stringify([
        p.engine || '',
        p.evidence || '',
        p.status || '',
        p.sort || 'sessions',
        p.direction || 'desc',
        p.keywordSnapshot || '',
      ]),
    );
  return {
    queryKey,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      withClientFreshness(
        signal,
        () =>
          featureApi.get<LiekanPageReport>(
            `/liekan/websites/${websiteId}/page-report`,
            { ...p, tablePages: undefined, ...tpParams, ...(fresh?.() ? { refresh: '1' } : {}) },
            signal,
            { priority },
          ),
        { priority, queryKey },
      ),
    staleTime: (query: any) => (p.resource === 'logs' ? 0 : freshnessStaleTime(query)),
    gcTime: 600000,
    structuralSharing: shareWithFreshness,
    refetchOnMount: (query: any) =>
      hasClientFreshness(query.state.data) &&
      remainingFreshness(query.state.data, query.state.dataUpdatedAt) <= 0
        ? 'always'
        : true,
    refetchOnWindowFocus: false as const,
    refetchOnReconnect: false as const,
    retry: false as const,
  };
}
