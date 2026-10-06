import type { ReactQueryOptions } from '@/lib/types';
import { useApi } from '../useApi';
import { useModified } from '../useModified';
import { usePagedQuery } from '../usePagedQuery';

export function useLinksQuery(
  { teamId }: { teamId?: string },
  params?: Record<string, any>,
  options?: ReactQueryOptions,
) {
  const { modified } = useModified('links');
  const { get } = useApi();

  return usePagedQuery({
    queryKey: ['links', { teamId, modified, ...params }],
    queryFn: (pageParams, { signal }: { signal?: AbortSignal } = {}) => {
      return get(
        teamId ? `/teams/${teamId}/links` : '/links',
        {
          ...pageParams,
          ...params,
        },
        {},
        signal,
      );
    },
    ...options,
  });
}
