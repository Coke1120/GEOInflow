import { keepPreviousData, type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { invalidateFeatureWebsiteQueries } from '@/lib/liekan/upstream/features-client';
import type { ReactQueryOptions } from '@/lib/types';
import { useApi } from '../useApi';
import { useModified } from '../useModified';

const handledModifications = new WeakMap<QueryClient, Map<string, unknown>>();

export function useWebsiteQuery(
  websiteId?: string,
  options?: ReactQueryOptions & { queryKey?: readonly unknown[] },
) {
  const { get, useQuery } = useApi();
  const { modified } = useModified(`website:${websiteId}`);
  const client = useQueryClient();
  const identity = JSON.stringify([websiteId, options?.queryKey]);
  useEffect(() => {
    let seen = handledModifications.get(client);
    if (!seen) {
      seen = new Map();
      handledModifications.set(client, seen);
    }
    if (modified != null && seen.get(identity) !== modified && options?.queryKey) {
      seen.set(identity, modified);
      if (options.queryKey[0] !== 'liekan-feature')
        void client.invalidateQueries({ queryKey: options.queryKey });
      void invalidateFeatureWebsiteQueries(client, websiteId);
    }
  }, [modified, identity, client, options?.queryKey]);

  return useQuery({
    queryKey: ['website', { websiteId, modified }],
    queryFn: ({ signal }: { signal?: AbortSignal } = {}) =>
      get(`/websites/${websiteId}`, {}, {}, signal),
    enabled: !!websiteId,
    placeholderData: keepPreviousData,
    ...options,
  });
}
