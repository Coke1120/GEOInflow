import type { UseQueryOptions } from '@tanstack/react-query';
import { useDateParameters } from '@/components/hooks/useDateParameters';
import { useApi } from '../useApi';
import { useFilterParameters } from '../useFilterParameters';

export interface WebsiteStatsData {
  pageviews: number;
  visitors: number;
  visits: number;
  bounces: number;
  totaltime: number;
  comparison: {
    pageviews: number;
    visitors: number;
    visits: number;
    bounces: number;
    totaltime: number;
  };
}

export function useWebsiteStatsQuery(
  { websiteId, compare }: { websiteId: string; compare?: string },
  options?: UseQueryOptions<WebsiteStatsData, Error, WebsiteStatsData>,
) {
  const { get, useQuery } = useApi();
  const { startAt, endAt, timezone } = useDateParameters();
  const filters = useFilterParameters();

  return useQuery<WebsiteStatsData>({
    queryKey: ['websites:stats', { websiteId, compare, startAt, endAt, timezone, ...filters }],
    queryFn: ({ signal }: { signal?: AbortSignal } = {}) =>
      get(
        `/websites/${websiteId}/stats`,
        { compare, startAt, endAt, timezone, ...filters },
        {},
        signal,
      ),
    enabled: !!websiteId,
    ...options,
  });
}
