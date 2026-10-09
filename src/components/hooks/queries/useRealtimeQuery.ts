import type { RealtimeData } from '@/lib/types';
import { useApi } from '../useApi';

export function useRealtimeQuery(websiteId: string) {
  const { get, useQuery } = useApi();
  const { data, isLoading, error } = useQuery<RealtimeData>({
    queryKey: ['realtime', { websiteId }],
    queryFn: async ({ signal }: { signal?: AbortSignal } = {}) => {
      return get(`/realtime/${websiteId}`, {}, {}, signal);
    },
    enabled: !!websiteId,
    refetchInterval: false,
  });

  return { data, isLoading, error };
}
