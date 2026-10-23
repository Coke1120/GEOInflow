'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { getClientAuthToken } from '@/lib/client';
import type { GeoWeightResponse, GeoWeightSnapshotResponse } from '../contracts/geo-weight';
import { canonicalGeoTimezone } from '../geo-weight/window';
import { useManualRefresh } from '../contracts/manual-refresh';
import { useBrowserCacheQuery } from './cache-client';
import { shareWithFreshness } from './client-freshness';
import { downloadTrafficEvidence, FeatureApiError, featureApi } from './features-client';

const ACTIVE = new Set(['queued', 'running']);
const BOUNDARY = new Set([401, 403, 404, 409, 410]);
const POLL_INTERVAL = 3000;
const POLL_BUDGET = 300000;

/** Undefined asOf delegates the completed-day boundary to the server clock. */
function scope(asOf: string | undefined, timezone: string) {
  return {
    mode: asOf ? ('historical' as const) : ('current' as const),
    asOf,
    timezone: canonicalGeoTimezone(timezone),
  };
}
export function geoWeightSnapshotKey(
  userId: string,
  websiteId: string,
  asOf: string | undefined,
  timezone: string,
  view: 'summary' | 'detail',
  snapshotId?: string,
) {
  return [
    'liekan-feature',
    userId,
    'geo-weight-snapshot',
    websiteId,
    scope(asOf, timezone),
    view,
    snapshotId || null,
  ] as const;
}

export function useGeoWeight(
  userId: string,
  websiteId: string,
  asOf: string | undefined,
  timezone: string,
  view: 'summary' | 'detail',
  enabled = true,
  snapshotId?: string,
) {
  const client = useQueryClient();
  const readGeneration = useRef(0);
  const [pollError, setPollError] = useState<Error | null>(null);
  const reading = useManualRefresh();
  const baseKey = geoWeightSnapshotKey(userId, websiteId, asOf, timezone, view, snapshotId);
  const refreshRound = `${reading?.page.token}:${reading?.page.round}`;
  const allowed = enabled && !!userId && !!websiteId && reading?.authorized !== false;
  const cached = useBrowserCacheQuery(
    {
      queryKey: baseKey,
      meta: {
        readPurpose: 'ordinary',
        geoSnapshot: true,
        cacheAggregate: true,
        cacheResources: [{ type: 'website', id: websiteId }],
      },
    },
    refreshRound,
    allowed,
  );
  const queryKey = cached.key;
  const key = JSON.stringify(queryKey);
  const canRead = allowed && cached.ready;
  const query = useQuery<GeoWeightSnapshotResponse>({
    queryKey,
    queryFn: async ({ signal }) => {
      readGeneration.current++;
      setPollError(null);
      cached.assertCurrent();
      const token = getClientAuthToken();
      const value = await featureApi.get<GeoWeightSnapshotResponse>(
        `/liekan/websites/${websiteId}/geo-weight/snapshot`,
        { ...scope(asOf, timezone), view, snapshotId },
        signal,
      );
      signal.throwIfAborted();
      cached.assertCurrent();
      if (getClientAuthToken() !== token)
        throw new FeatureApiError('登录身份已变更，请重新读取。', 401);
      return value;
    },
    enabled: canRead,
    retry: false,
    staleTime: Infinity,
    gcTime: 600000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    structuralSharing: shareWithFreshness,
    // The ordinary-read owner clears this query on local or cross-tab identity changes.
    meta: { ...cached.meta, readPurpose: 'ordinary', geoSnapshot: true },
  });
  const { refetch } = query;
  const lastRefresh = useRef<string>(null);
  useEffect(() => {
    const entry = `${key}:${refreshRound}`;
    if (!canRead || lastRefresh.current === entry) return;
    lastRefresh.current = entry;
    void refetch({ cancelRefetch: false });
  }, [canRead, key, refreshRound, refetch]);
  useEffect(() => {
    if (!reading || (!canRead && !cached.meta?.cachePending)) return;
    return reading.register(queryKey, {
      status: query.status,
      fetchStatus: query.fetchStatus,
      dataUpdatedAt: query.dataUpdatedAt,
      errorUpdatedAt: query.errorUpdatedAt,
    });
  }, [
    reading?.register,
    reading?.page.token,
    reading?.page.round,
    key,
    canRead,
    query.status,
    query.fetchStatus,
    query.dataUpdatedAt,
    query.errorUpdatedAt,
  ]);

  const [pollExpired, setPollExpired] = useState(false);
  const polling =
    canRead &&
    view === 'summary' &&
    !snapshotId &&
    ACTIVE.has(query.data?.taskStatus) &&
    !!query.data?.taskId &&
    !BOUNDARY.has(((pollError || query.error) as any)?.status);
  const taskKey = polling ? `${key}:${query.data.taskId || 'pending'}` : '';
  const budgets = useRef(new Map<string, number>());
  useEffect(() => {
    setPollExpired(false);
    if (!taskKey) return;
    if (!budgets.current.has(taskKey))
      budgets.current.set(taskKey, performance.now() + POLL_BUDGET);
    const deadline = budgets.current.get(taskKey);
    const taskId = query.data.taskId;
    const owned = new AbortController();
    let busy = false;
    const poll = () => {
      if (document.visibilityState === 'hidden' || navigator.onLine === false || busy) return;
      if (performance.now() >= deadline) {
        setPollExpired(true);
        return;
      }
      busy = true;
      const generation = readGeneration.current;
      const token = getClientAuthToken();
      void featureApi
        .get<GeoWeightSnapshotResponse>(
          `/liekan/websites/${websiteId}/geo-weight/snapshot`,
          { ...scope(asOf, timezone), view: 'summary', taskId },
          owned.signal,
        )
        .then(value => {
          owned.signal.throwIfAborted();
          cached.assertCurrent();
          if (getClientAuthToken() !== token || generation !== readGeneration.current) return;
          if (client.getQueryData<GeoWeightSnapshotResponse>(queryKey)?.taskId !== taskId) return;
          client.setQueryData(queryKey, value);
          setPollError(null);
        })
        .catch(error => {
          if (!owned.signal.aborted && generation === readGeneration.current) setPollError(error);
        })
        .finally(() => {
          busy = false;
        });
    };
    const visible = () => {
      if (document.visibilityState === 'visible') poll();
    };
    const timer = setInterval(poll, POLL_INTERVAL);
    const expiry = setTimeout(
      () => {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', visible);
        setPollExpired(true);
      },
      Math.max(0, deadline - performance.now()),
    );
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(timer);
      clearTimeout(expiry);
      owned.abort();
      document.removeEventListener('visibilitychange', visible);
    };
  }, [taskKey]);

  return {
    ...query,
    error: pollError || query.error,
    isError: !!pollError || query.isError,
    refetch: async (options?: Parameters<typeof refetch>[0]) => {
      setPollError(null);
      if (options?.cancelRefetch) {
        // First reads can still coalesce without data; retire them before boundary validation.
        cached.assertCurrent();
        const token = getClientAuthToken();
        await client.cancelQueries({ queryKey, exact: true });
        cached.assertCurrent();
        if (getClientAuthToken() !== token)
          throw new FeatureApiError('登录身份已变更，请重新读取。', 401);
      }
      return refetch(options);
    },
    pollExpired,
    recalculate: async (requestId: string, signal: AbortSignal) => {
      readGeneration.current++;
      setPollError(null);
      cached.assertCurrent();
      const token = getClientAuthToken();
      const value = await featureApi.post<GeoWeightSnapshotResponse>(
        `/liekan/websites/${websiteId}/geo-weight/recalculate`,
        { ...scope(asOf, timezone), requestId },
        signal,
      );
      signal.throwIfAborted();
      cached.assertCurrent();
      if (getClientAuthToken() !== token)
        throw new FeatureApiError('登录身份已变更，请重新读取。', 401);
      client.setQueryData(queryKey, value);
      return value;
    },
  };
}

export function downloadGeoWeight(data: GeoWeightResponse, locale: string, signal: AbortSignal) {
  if (!data.snapshotId) throw new FeatureApiError('GEO 权重数据已更新，请重新读取后导出', 409);
  return downloadTrafficEvidence(
    `/liekan/websites/${data.websiteId}/geo-weight/export`,
    { snapshotId: data.snapshotId, locale },
    signal,
  );
}
