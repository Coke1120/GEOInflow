import { keepPreviousData } from '@tanstack/react-query';
import type { ReactQueryOptions } from '@/lib/types';
import { useApi } from '../useApi';
import { useDateParameters } from '../useDateParameters';
import { useFilterParameters } from '../useFilterParameters';

export type RevenueMetricType = 'country' | 'region' | 'referrer' | 'channel';

export type RevenueMetricsData = {
  name: string;
  value: number;
  country?: string;
}[];

export function useRevenueMetricsQuery(
  websiteId: string,
  params: { type: RevenueMetricType; currency: string },
  options?: ReactQueryOptions<RevenueMetricsData>,
) {
  const { get, useQuery } = useApi();
  const { startAt, endAt, timezone } = useDateParameters();
  const filters = useFilterParameters({ includePagination: false });

  return useQuery<RevenueMetricsData>({
    queryKey: [
      'websites:revenue:metrics',
      {
        websiteId,
        startAt,
        endAt,
        timezone,
        ...filters,
        ...params,
      },
    ],
    queryFn: async ({ signal }: { signal?: AbortSignal } = {}) =>
      get(
        `/websites/${websiteId}/revenue/metrics`,
        {
          startAt,
          endAt,
          timezone,
          ...filters,
          ...params,
        },
        {},
        signal,
      ),
    enabled: !!(websiteId && params.currency && params.type),
    placeholderData: keepPreviousData,
    ...options,
  });
}
