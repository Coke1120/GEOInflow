'use client';
import type { LiekanPageReport, ReportResource } from '../contracts/page-report';
import { featureApi } from './features-client';
import { freshnessStaleTime } from './client-freshness';

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
) {
  const p = { chartPeriod: '30d', filter: '', search: '', page: 1, cursor: '', seek: '', ...input };
  return {
    queryKey: [
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
    ],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      featureApi.get<LiekanPageReport>(
        `/liekan/websites/${websiteId}/page-report`,
        { ...p, ...(fresh?.() ? { refresh: '1' } : {}) },
        signal,
      ),
    staleTime: (query: any) => (p.resource === 'logs' ? 0 : freshnessStaleTime(query)),
    gcTime: 600000,
    structuralSharing: false as const,
    retry: false as const,
  };
}
