import { type AnalyticsParameters, serializeAnalyticsQuery } from '@/lib/analytics-query';
import type { ReactQueryOptions } from '@/lib/types';
import { useApi } from '../useApi';
import { useDateParameters } from '../useDateParameters';
import { useFilterParameters } from '../useFilterParameters';
import { useModified } from '../useModified';
import { calendarDateTimeToUtc } from '@/lib/liekan/contracts/calendar';

export function useAnalyticsQuery<T>(
  path: string,
  params: AnalyticsParameters & Record<string, any>,
  options?: ReactQueryOptions<T>,
) {
  const { get, useQuery } = useApi();
  const { startAt, endAt, timezone, unit, datesAreLocal, displayStartAt, displayEndAt } =
    useDateParameters({ calendarMetadata: true });
  const filters = useFilterParameters({ includePagination: false });
  const { modified } = useModified(`websites:${path.split('/')[0]}`);
  const query = serializeAnalyticsQuery({
    startAt,
    endAt,
    timezone,
    unit,
    ...filters,
    ...Object.fromEntries(
      Object.entries(params)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [
          key,
          datesAreLocal &&
          ['startDate', 'endDate'].includes(key) &&
          value instanceof Date &&
          Number.isFinite(+value)
            ? new Date(
                key === 'startDate' && +value === displayStartAt
                  ? startAt
                  : key === 'endDate' && +value === displayEndAt
                    ? endAt
                    : calendarDateTimeToUtc(value, timezone),
              )
            : value,
        ]),
    ),
  });
  return useQuery<T>({
    queryKey: [`websites:${path}`, { websiteId: params.websiteId, ...query, modified }],
    queryFn: ({ signal }: { signal?: AbortSignal } = {}) =>
      get(`/websites/${params.websiteId}/${path}`, query, {}, signal),
    enabled: !!params.websiteId,
    ...options,
  });
}
