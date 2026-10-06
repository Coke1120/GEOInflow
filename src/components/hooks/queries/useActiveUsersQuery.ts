import type { ReactQueryOptions } from '@/lib/types';
import { useApi } from '../useApi';

export function useActiveUsersQuery(websiteId: string, options?: ReactQueryOptions) {
  const { get, useQuery } = useApi();
  return useQuery<any>({
    queryKey: ['websites:active', websiteId],
    queryFn: ({ signal }: { signal?: AbortSignal } = {}) =>
      get(`/websites/${websiteId}/active`, {}, {}, signal),
    enabled: !!websiteId,
    ...options,
  });
}
