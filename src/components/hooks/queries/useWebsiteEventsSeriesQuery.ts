import type { ReactQueryOptions } from '@/lib/types';
import { useApi } from '../useApi';
import { useDateParameters } from '../useDateParameters';
import { useFilterParameters } from '../useFilterParameters';

export function useWebsiteEventsSeriesQuery(
  websiteId: string,
  params?: { limit?: number },
  options?: ReactQueryOptions,
) {
  const { get, useQuery } = useApi();
  const { startAt, endAt, unit, timezone } = useDateParameters();
  const filters = useFilterParameters();

  return useQuery({
    queryKey: [
      'websites:events:series',
      { websiteId, startAt, endAt, unit, timezone, ...filters, ...params },
    ],
    queryFn: ({ signal }: { signal?: AbortSignal } = {}) =>
      get(
        `/websites/${websiteId}/events/series`,
        {
          startAt,
          endAt,
          unit,
          timezone,
          ...filters,
          ...params,
        },
        {},
        signal,
      ),
    enabled: !!websiteId,
    ...options,
  });
}
