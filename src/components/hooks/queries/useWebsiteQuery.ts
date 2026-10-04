import { keepPreviousData, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { invalidateFeatureWebsiteQueries } from '@/lib/liekan/upstream/features-client';
import type { ReactQueryOptions } from '@/lib/types';
import { useApi } from '../useApi';
import { useModified } from '../useModified';

export function useWebsiteQuery(
  websiteId?: string,
  options?: ReactQueryOptions & { queryKey?: readonly unknown[] },
) {
  const { get, useQuery } = useApi();
  const { modified } = useModified(`website:${websiteId}`);
  const client = useQueryClient();
  const seen = useRef<unknown>(undefined);
  const version = JSON.stringify([websiteId, modified, options?.queryKey]);
  useEffect(() => {
    if (modified != null && seen.current !== version && options?.queryKey) {
      seen.current = version;
      if (options.queryKey[0] !== 'liekan-feature')
        void client.invalidateQueries({ queryKey: options.queryKey, exact: true });
      void invalidateFeatureWebsiteQueries(client, websiteId);
    }
  }, [modified, version, client, options?.queryKey]);

  return useQuery({
    queryKey: ['website', { websiteId, modified }],
    queryFn: () => get(`/websites/${websiteId}`),
    enabled: !!websiteId,
    placeholderData: keepPreviousData,
    ...options,
  });
}
