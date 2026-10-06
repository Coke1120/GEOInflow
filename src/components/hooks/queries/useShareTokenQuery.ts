import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { SHARE_CONTEXT_HEADER, SHARE_TOKEN_HEADER } from '@/lib/constants';
import { nativeIdentityKey, nativeShareScope } from '@/lib/liekan/upstream/native-client';
import { setShareData, useApp } from '@/store/app';
import { useApi } from '../useApi';

export function useShareTokenQuery(slug: string) {
  const { get } = useApi();
  const client = useQueryClient();
  const currentShare = useApp(state => state.share);
  const shareToken = useApp(state => state.shareToken?.token);
  const query = useQuery({
    queryKey: ['share', slug],
    queryFn: async ({ signal }: { signal?: AbortSignal } = {}) =>
      get(`/share/${slug}`, {}, {}, signal),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    structuralSharing: false,
    retry: false,
  });

  useEffect(() => {
    const restricted = [401, 403, 404].includes((query.error as any)?.status);
    const changed =
      query.isFetchedAfterMount &&
      !query.isFetching &&
      query.isSuccess &&
      (!query.data?.token ||
        (currentShare && nativeShareScope(currentShare) !== nativeShareScope(query.data)));
    if ((restricted || changed) && currentShare) {
      const identity = nativeIdentityKey(
        {
          [SHARE_TOKEN_HEADER]: shareToken || '',
          [SHARE_CONTEXT_HEADER]: '1',
        },
        undefined,
        currentShare,
      );
      const predicate = (entry: any) =>
        entry.queryKey.some((part: any) => part?.nativeIdentity === identity);
      void client.cancelQueries({ predicate });
      client.removeQueries({ predicate });
    }
    if (restricted || (query.isSuccess && query.isFetchedAfterMount && !query.data?.token)) {
      if (currentShare || shareToken) setShareData(null, null);
    } else if (
      query.isFetchedAfterMount &&
      !query.isFetching &&
      query.isSuccess &&
      query.data?.token &&
      (currentShare !== query.data || shareToken !== query.data.token)
    ) {
      setShareData(query.data, { token: query.data.token });
    }
  }, [
    query.data,
    query.error,
    query.isFetchedAfterMount,
    query.isFetching,
    query.isSuccess,
    currentShare,
    shareToken,
    client,
  ]);

  return { share: query.data, ...query };
}
