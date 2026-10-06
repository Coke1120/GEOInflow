import { keepPreviousData } from '@tanstack/react-query';
import { useFilterParameters } from '@/components/hooks/useFilterParameters';
import type { ReactQueryOptions } from '@/lib/types';
import { useApi } from '../useApi';
import { useModified } from '../useModified';

export function useWebsiteCohortsQuery(
  websiteId: string,
  params?: Record<string, string>,
  options?: ReactQueryOptions,
) {
  const { get, useQuery } = useApi();
  const { modified } = useModified(`cohorts`);
  const filters = useFilterParameters();

  return useQuery({
    queryKey: ['website:cohorts', { websiteId, modified, ...filters, ...params }],
    queryFn: ({ signal }: { signal?: AbortSignal } = {}) => {
      return get(`/websites/${websiteId}/segments`, { ...filters, ...params }, {}, signal);
    },
    enabled: !!websiteId,
    placeholderData: keepPreviousData,
    ...options,
  });
}
