import { useApi } from '../useApi';
import { useModified } from '../useModified';
import { usePagedQuery } from '../usePagedQuery';

export function useSavedReplaysQuery(websiteId: string) {
  const { get } = useApi();
  const { modified } = useModified('replays');

  return usePagedQuery({
    queryKey: ['replays:saved', { websiteId, modified }],
    queryFn: (pageParams, { signal }: { signal?: AbortSignal } = {}) => {
      return get(
        `/websites/${websiteId}/replays/saved`,
        {
          ...pageParams,
        },
        {},
        signal,
      );
    },
  });
}
