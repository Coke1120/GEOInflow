import { keepPreviousData } from '@tanstack/react-query';
import type { ReactQueryOptions } from '@/lib/types';
import { useApi } from '../useApi';
import { useModified } from '../useModified';

export function useWebsiteSegmentQuery(
  websiteId: string,
  segmentId: string,
  options?: ReactQueryOptions,
) {
  const { get, useQuery } = useApi();
  const { modified } = useModified(`segments`);

  return useQuery({
    queryKey: ['website:segments', { websiteId, segmentId, modified }],
    queryFn: ({ signal }: { signal?: AbortSignal } = {}) =>
      get(`/websites/${websiteId}/segments/${segmentId}`, {}, {}, signal),
    enabled: !!(websiteId && segmentId),
    placeholderData: keepPreviousData,
    ...options,
  });
}
