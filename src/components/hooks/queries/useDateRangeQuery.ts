import type { ReactQueryOptions } from '@/lib/types';
import { useApi } from '../useApi';

type DateRange = {
  startDate?: string;
  endDate?: string;
};

export function useDateRangeQuery(websiteId: string, options?: ReactQueryOptions) {
  const { get, useQuery } = useApi();

  const { data } = useQuery<DateRange>({
    queryKey: ['date-range', websiteId],
    queryFn: ({ signal }: { signal?: AbortSignal } = {}) =>
      get(`/websites/${websiteId}/daterange`, {}, {}, signal),
    enabled: !!websiteId,
    ...options,
  });

  return {
    startDate: data?.startDate ? new Date(data.startDate) : null,
    endDate: data?.endDate ? new Date(data.endDate) : null,
  };
}
