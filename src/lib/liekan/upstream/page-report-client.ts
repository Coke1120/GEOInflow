'use client';
import type { LiekanPageReport, ReportResource } from '../contracts/page-report';
import { featureApi } from './features-client';
import {
  freshnessStaleTime,
  shareWithFreshness,
  withClientFreshness,
  remainingFreshness,
  hasClientFreshness,
} from './client-freshness';

export function pageReportQuery(
  userId: string,
  websiteId: string,
  input: {
    resource: ReportResource;
    startAt: number;
    endAt: number;
    timezone: string;
    chartPeriod?: string;
    filter?: string;
    search?: string;
    page?: number;
    cursor?: string;
    seek?: string;
  },
  teamId?: string,
  fresh?: () => boolean,
  priority: 'foreground' | 'prefetch' = 'foreground',
) {
  const p = { chartPeriod: '30d', filter: '', search: '', page: 1, cursor: '', seek: '', ...input };
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
    userId,
  ];
  return {
    queryKey,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      withClientFreshness(
        signal,
        () =>
          featureApi.get<LiekanPageReport>(
            `/liekan/websites/${websiteId}/page-report`,
            { ...p, ...(fresh?.() ? { refresh: '1' } : {}) },
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
