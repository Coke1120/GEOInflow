import { useApi } from '../useApi';

export function useWebsiteSessionQuery(websiteId: string, sessionId: string | undefined) {
  const { get, useQuery } = useApi();

  return useQuery({
    queryKey: ['session', { websiteId, sessionId }],
    queryFn: ({ signal }: { signal?: AbortSignal } = {}) => {
      return get(`/websites/${websiteId}/sessions/${sessionId}`, {}, {}, signal);
    },
    enabled: Boolean(websiteId && sessionId),
  });
}
