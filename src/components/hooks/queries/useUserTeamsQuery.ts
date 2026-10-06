import { useApi } from '../useApi';
import { useModified } from '../useModified';
import { usePagedQuery } from '../usePagedQuery';

export function useUserTeamsQuery(userId: string) {
  const { get } = useApi();
  const { modified } = useModified(`teams`);

  return usePagedQuery({
    queryKey: ['teams', { userId, modified }],
    queryFn: (params, { signal }: { signal?: AbortSignal } = {}) => {
      return get(`/users/${userId}/teams`, params, {}, signal);
    },
    enabled: !!userId,
  });
}
