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
  live = false,
) {
  const p = { chartPeriod: '30d', filter: '', search: '', page: 1, cursor: '', seek: '', ...input };
  const rolling = live && p.resource === 'logs';
  return {
    queryKey: [
      'liekan',
      websiteId,
      teamId,
      p.resource,
      rolling ? 'live-30-days' : p.startAt,
      rolling ? 'live' : p.endAt,
      p.timezone,
      p.chartPeriod,
      p.filter,
      p.search,
      p.page,
      p.cursor,
      p.seek,
      userId,
    ],
    queryFn: ({ signal }: { signal: AbortSignal }) => {
      const now = Date.now();
      return featureApi.get<LiekanPageReport>(
        `/liekan/websites/${websiteId}/page-report`,
        {
          ...p,
          ...(rolling ? { startAt: now - 30 * 86400000, endAt: now } : {}),
          ...(fresh?.() ? { refresh: '1' } : {}),
        },
        signal,
      );
    },
    staleTime: (query: any) => (p.resource === 'logs' ? 0 : freshnessStaleTime(query)),
    ...(rolling ? { refetchOnMount: 'always' as const } : {}),
    gcTime: 600000,
    structuralSharing: false as const,
    retry: false as const,
  };
}
