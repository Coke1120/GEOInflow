'use client';
import { hashKey, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { clientCatalogVersion } from './catalog-client';
import { getApiUrl } from '@/lib/api-url';
import { getClientAuthToken } from '@/lib/client';
import { SHARE_CONTEXT_HEADER, SHARE_TOKEN_HEADER } from '@/lib/constants';
import { buildPath } from '@/lib/url';
import { useApp } from '@/store/app';
import { aggregateRequestResources, isAggregateRequest } from './cache-policy';
import {
  clientRequestOptions,
  projectClientFreshness,
  freshnessStaleTime,
  hasClientFreshness,
  monotonicNow,
  remainingFreshness,
  rememberRequestFreshness,
  rememberResponseFreshness,
  shareWithFreshness,
  useFreshnessLifecycle,
  withClientFreshness,
} from './client-freshness';
import { browserReads as reads } from './request-pool';
import { useManualQueryOptions, useRetainedRead } from './manual-client';

const identities = new Map<string, number>();
let nextIdentity = 0;

function normalizedHeaders(headers: HeadersInit) {
  return [...new Headers(headers).entries()].sort(([a], [b]) => a.localeCompare(b));
}
/** Keep credentials out of observable query keys while separating browser identities. */
export function nativeShareScope(share: any) {
  const identifiers = Object.fromEntries(
    [
      'shareId',
      'shareType',
      'websiteId',
      'boardId',
      'pixelId',
      'linkId',
      'boardLayoutHash',
      'parameters',
    ].map(name => [name, share?.[name]]),
  );
  for (const name of ['websiteIds', 'pixelIds', 'linkIds'])
    identifiers[name] = share?.[name] ? [...share[name]].sort() : undefined;
  identifiers.parameters = Object.fromEntries(
    Object.entries(share?.parameters || {}).filter(
      ([name]) => !['theme', 'hasPassword'].includes(name),
    ),
  );
  return hashKey(['public-native-share', identifiers]);
}
export function nativeIdentityKey(headers: HeadersInit, principal?: string, share?: any) {
  const key =
    share?.shareId && new Headers(headers).has(SHARE_TOKEN_HEADER)
      ? nativeShareScope(share)
      : JSON.stringify([normalizedHeaders(headers), principal]);
  const existing = identities.get(key);
  if (existing !== undefined) return existing;
  if (identities.size >= 64) {
    const oldest = identities.keys().next().value;
    if (oldest !== undefined) identities.delete(oldest);
  }
  const value = ++nextIdentity;
  identities.set(key, value);
  return value;
}

function retryAfter(response: Response) {
  const value = response.headers.get('Retry-After');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const serverTime =
    Number(response.headers.get('X-Liekan-Server-Time')) ||
    Date.parse(response.headers.get('Date') || '');
  return Math.max(0, Date.parse(value) - (Number.isFinite(serverTime) ? serverTime : Date.now()));
}

export async function nativeGet<T = any>(
  path: string,
  params: Record<string, any> = {},
  headers: HeadersInit = {},
  signal?: AbortSignal,
): Promise<T> {
  const aggregate = isAggregateRequest(path, params);
  const context = clientRequestOptions(signal);
  const requestHeaders = new Headers({
    Accept: 'application/json',
    'Content-Type': 'application/json',
  });
  new Headers(headers).forEach((value, key) => {
    requestHeaders.set(key, value);
  });
  if (aggregate && context?.catalogScope) {
    const version = await clientCatalogVersion(
      context.catalogScope,
      Object.fromEntries(requestHeaders.entries()),
    );
    if (version) requestHeaders.set('X-Liekan-Catalog-Version', version);
    signal?.throwIfAborted();
  }
  // Preserve the native API's parameter coercion and third-argument header overrides.
  const url = buildPath(getApiUrl(path), {
    ...params,
    ...(aggregate && context?.refresh ? { refresh: 1 } : {}),
  });
  try {
    const data = await reads.read(
      JSON.stringify([url, normalizedHeaders(requestHeaders)]),
      async requestSignal => {
        const startedAt = monotonicNow();
        const response = await fetch(url, {
          method: 'GET',
          headers: requestHeaders,
          signal: requestSignal,
          cache: 'no-store',
        });
        const value = await response.json();
        if (!response.ok)
          throw Object.assign(new Error(value?.error?.message || `请求失败 (${response.status})`), {
            status: response.status,
            code: value?.error?.code,
            retryAfterMs: retryAfter(response),
          });
        if (aggregate)
          rememberResponseFreshness(
            value,
            response.headers,
            startedAt,
            monotonicNow(),
            requestHeaders.has(SHARE_TOKEN_HEADER)
              ? undefined
              : aggregateRequestResources(path, params),
          );
        return value;
      },
      signal,
      context?.priority,
    );
    if (data && typeof data === 'object') rememberRequestFreshness(data, signal);
    return data;
  } catch (error: any) {
    if (aggregate && error && typeof error === 'object' && error.name !== 'AbortError')
      error.aggregate = true;
    throw error;
  }
}

/** Resolve the existing native hook keys through the shared request policy. */
export function nativeQueryPolicy(queryKey: readonly unknown[]) {
  const label = String(queryKey[0]);
  const params = (queryKey.find(
    value => value && typeof value === 'object' && !Array.isArray(value),
  ) || {}) as Record<string, any>;
  const path = label.endsWith(':list:charts')
    ? `/${label.split(':')[0]}/charts`
    : label.startsWith('websites:')
      ? `/websites/${params.websiteId}/${label.slice(9).replaceAll(':', '/')}`
      : '';
  const aggregate = isAggregateRequest(path, params);
  const direct =
    !aggregate &&
    (/^(?:realtime|session(?:$|[:-])|sessions(?:$|:)|replay(?:$|s(?:$|:))|revenue-sessions|websites:(?:active|events$|values|event-data|session-data))/.test(
      label,
    ) ||
      ['date-range', '2fa-status', 'user-2fa-status', 'share', 'login'].includes(label));
  return { aggregate, direct, endAt: params.endAt, timezone: params.timezone };
}

function placeholderScope(queryKey: readonly unknown[]) {
  const identifiers = Object.assign(
    {},
    ...queryKey
      .filter(value => value && typeof value === 'object' && !Array.isArray(value))
      .map(value =>
        Object.fromEntries(
          Object.entries(value).filter(
            ([name]) =>
              name === 'nativeIdentity' || name === 'id' || name === 'ids' || name.endsWith('Id'),
          ),
        ),
      ),
  );
  return hashKey([queryKey[0], identifiers]);
}

/** Retain native configuration options and apply server deadlines to analytics. */
export const useNativeQuery: typeof useQuery = ((input: any, queryClient?: any) => {
  const userId = useApp(state => state.user?.id);
  const share = useApp(state => state.share);
  const shareId = share?.shareId;
  const shareToken = useApp(state => state.shareToken?.token);
  const identity = nativeIdentityKey(
    {
      authorization: `Bearer ${getClientAuthToken()}`,
      ...(shareId && shareToken
        ? { [SHARE_TOKEN_HEADER]: shareToken, [SHARE_CONTEXT_HEADER]: '1' }
        : {}),
    },
    userId,
    share,
  );
  const product = typeof input.queryKey[0] === 'string' && input.queryKey[0].startsWith('liekan');
  const options = {
    ...input,
    ...(!product ? { queryKey: [...input.queryKey, { nativeIdentity: identity }] } : {}),
    meta: { ...input.meta, localeInvariant: true },
  };
  const client = useQueryClient(queryClient);
  const policy = nativeQueryPolicy(options.queryKey);
  const key = JSON.stringify(options.queryKey);
  const currentKey = useRef(key);
  currentKey.current = key;
  const force = useRef<{ key: string; round: object }>(null);
  const manual = useRef<{ key: string; promise: Promise<any> }>(null);
  const metadataStaleTime = options.staleTime ?? client.getDefaultOptions().queries?.staleTime ?? 0;
  const nativeOptions = {
    ...options,
    queryFn:
      typeof options.queryFn === 'function'
        ? (context: any) => {
            const refresh = force.current?.key === JSON.stringify(context.queryKey);
            if (refresh) force.current = null;
            return withClientFreshness(context.signal, () => options.queryFn(context), {
              refresh,
              queryKey: context.queryKey,
            });
          }
        : options.queryFn,
    ...(policy.aggregate || policy.direct ? { placeholderData: undefined } : {}),
    ...(!policy.aggregate && !policy.direct && options.placeholderData !== undefined
      ? {
          placeholderData: (previousData: any, previousQuery: any) => {
            if (
              previousQuery &&
              placeholderScope(previousQuery.queryKey) !== placeholderScope(options.queryKey)
            )
              return undefined;
            return typeof options.placeholderData === 'function'
              ? options.placeholderData(previousData, previousQuery)
              : options.placeholderData;
          },
        }
      : {}),
    staleTime: (query: any) => {
      if (policy.direct) return 0;
      if (policy.aggregate || hasClientFreshness(query.state.data))
        return freshnessStaleTime(query);
      return typeof metadataStaleTime === 'function' ? metadataStaleTime(query) : metadataStaleTime;
    },
    ...(policy.direct ? { gcTime: 0, refetchOnMount: 'always' as const } : {}),
    structuralSharing: (oldData: any, newData: any) => {
      if (hasClientFreshness(newData)) return shareWithFreshness(oldData, newData);
      if (typeof options.structuralSharing === 'function')
        return options.structuralSharing(oldData, newData);
      return options.structuralSharing === false ? newData : shareWithFreshness(oldData, newData);
    },
    ...(options.select
      ? {
          select: (data: any) => {
            const selected = options.select(data);
            projectClientFreshness(selected, data);
            return selected;
          },
        }
      : {}),
    ...(policy.aggregate ? { refetchOnWindowFocus: false, refetchOnReconnect: false } : {}),
    ...(policy.aggregate
      ? {
          refetchOnMount: (query: any) =>
            query.state.data !== undefined &&
            remainingFreshness(query.state.data, query.state.dataUpdatedAt) <= 0
              ? 'always'
              : false,
        }
      : {}),
  };
  const purpose = ['login', 'share', '2fa-status', 'user-2fa-status', 'subscription'].includes(
    String(input.queryKey[0]),
  );
  const manualOptions = useManualQueryOptions(
    purpose
      ? { ...nativeOptions, meta: { ...options.meta, readPurpose: 'authorization' } }
      : product
        ? options
        : nativeOptions,
  );
  const result = useRetainedRead(
    useQuery(manualOptions, client),
    manualOptions.queryKey,
    manualOptions,
    client,
  );
  // Product callers own their lifecycle; an inert input preserves React's hook ordering.
  const visible = useFreshnessLifecycle(
    product ? { ...result, data: undefined, error: null } : result,
    {
      ...policy,
      aggregate: product || policy.direct ? false : policy.aggregate || undefined,
      queryKey: options.queryKey,
      enabled: product
        ? false
        : typeof options.enabled === 'function'
          ? result.isEnabled
          : options.enabled,
    },
  );
  if (product) return result;
  return {
    ...visible,
    refetch: (settings?: any) => {
      if (!result.manualCanRead || typeof options.queryFn !== 'function')
        return Promise.resolve(result);
      if (manual.current?.key === key) return manual.current.promise;
      const round = {};
      const promise = (async () => {
        await client.cancelQueries({ queryKey: manualOptions.queryKey, exact: true });
        if (currentKey.current !== key) return result;
        force.current = { key, round };
        return result.refetch({ ...settings, cancelRefetch: false });
      })();
      const running = { key, promise };
      manual.current = running;
      const release = () => {
        if (manual.current === running) manual.current = null;
        if (force.current?.round === round) force.current = null;
      };
      void promise.then(release, release);
      return promise;
    },
  };
}) as typeof useQuery;
