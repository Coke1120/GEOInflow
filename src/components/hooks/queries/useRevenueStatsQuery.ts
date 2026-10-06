import { keepPreviousData, type UseQueryOptions } from '@tanstack/react-query';
import { useDateParameters } from '@/components/hooks/useDateParameters';
import { useApi } from '../useApi';
import { useFilterParameters } from '../useFilterParameters';

export interface RevenueStatsData {
  sum: number;
  count: number;
  average: number;
  unique_count: number;
  arpu: number;
  comparison: {
    sum: number;
    count: number;
    average: number;
    unique_count: number;
    arpu: number;
  };
}

export function useRevenueStatsQuery(
  {
    websiteId,
    currency,
    compare,
  }: {
    websiteId: string;
    currency: string;
    compare?: string;
  },
  options?: UseQueryOptions<RevenueStatsData, Error, RevenueStatsData>,
) {
  const { get, useQuery } = useApi();
  const { startAt, endAt, timezone } = useDateParameters();
  const filters = useFilterParameters({ includePagination: false });

  return useQuery<RevenueStatsData>({
    queryKey: [
      'websites:revenue:stats',
      { websiteId, currency, compare, startAt, endAt, timezone, ...filters },
    ],
    queryFn: ({ signal }: { signal?: AbortSignal } = {}) =>
      get(
        `/websites/${websiteId}/revenue/stats`,
        {
          currency,
          compare,
          startAt,
          endAt,
          timezone,
          ...filters,
        },
        {},
        signal,
      ),
    enabled: !!(websiteId && currency),
    placeholderData: keepPreviousData,
    ...options,
  });
}
