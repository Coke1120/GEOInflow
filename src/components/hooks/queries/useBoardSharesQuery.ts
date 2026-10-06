import type { ReactQueryOptions } from '@/lib/types';
import { useApi } from '../useApi';
import { useModified } from '../useModified';
import { usePagedQuery } from '../usePagedQuery';

export function useBoardSharesQuery({ boardId }: { boardId: string }, options?: ReactQueryOptions) {
  const { modified } = useModified('shares');
  const { get } = useApi();

  return usePagedQuery({
    queryKey: ['boardShares', { boardId, modified }],
    queryFn: (pageParams, { signal }: { signal?: AbortSignal } = {}) => {
      return get(`/boards/${boardId}/shares`, pageParams, {}, signal);
    },
    ...options,
  });
}
