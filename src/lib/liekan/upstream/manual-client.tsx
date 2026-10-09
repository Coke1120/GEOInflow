'use client';
import {
  hashKey,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { getClientAuthToken } from '@/lib/client';
import { AUTH_TOKEN } from '@/lib/constants';
import { setUser } from '@/store/app';
import { reportSnapshotOwner } from '../contracts/query';
import { aggregateReadFailure, withClientFreshness } from './client-freshness';

export const ordinaryReadOptions = {
  retry: false,
  networkMode: 'always' as const,
  staleTime: Infinity,
  gcTime: 600000,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  refetchInterval: false,
} as const;

let nextPage = 0;
interface PageRead {
  scope: string;
  token: number;
  round: number;
  force: boolean;
  now: number;
  queries: Map<string, { key: readonly unknown[]; count: number }>;
}
interface ManualReading {
  page: PageRead;
  busy: boolean;
  readAt: number;
  error: string;
  refresh: (expectedPage?: number, force?: boolean) => Promise<void>;
  register: (key: readonly unknown[]) => () => void;
  authorized?: boolean;
}
const ManualContext = createContext<ManualReading>(null);
const AuthorizationContext = createContext(true);

/** A trusted departure followed by a cached return is a new page visit. */
export function observeHistoryReturn(target: Window, reenter: () => void) {
  let departed = false;
  const hide = (event: PageTransitionEvent) => {
    if (event.isTrusted) departed = event.persisted;
  };
  const show = (event: PageTransitionEvent) => {
    if (!event.isTrusted || !event.persisted || !departed) return;
    departed = false;
    reenter();
  };
  target.addEventListener('pagehide', hide);
  target.addEventListener('pageshow', show);
  return () => {
    target.removeEventListener('pagehide', hide);
    target.removeEventListener('pageshow', show);
  };
}

/** Resolve URL aliases using metadata already read for this website. */
export function manualPageScope(path: string, client: QueryClient) {
  return path.replace(/\/websites\/([^/?#]+)/, (match, handle) => {
    for (const query of client.getQueryCache().getAll()) {
      const key = query.queryKey;
      if (key[0] !== 'liekan-feature' || !['site', 'sites'].includes(String(key[2]))) continue;
      const value: any = query.state.data;
      const sites = Array.isArray(value)
        ? value
        : Array.isArray(value?.data)
          ? value.data
          : [value];
      const site = sites.find(site => site?.id === handle || String(site?.siteNumber) === handle);
      if (site?.id) return `/websites/${site.id}`;
    }
    return match;
  });
}

export function ManualRefreshProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const client = useQueryClient();
  const [revision, update] = useReducer(value => value + 1, 0);
  const [busy, setBusy] = useState(false);
  const [readState, setReadState] = useState({ token: 0, at: 0, error: '' });
  const principal = useRef(getClientAuthToken());
  const conditions = new URLSearchParams(search?.toString() || '');
  for (const cosmetic of ['theme', 'language', 'locale']) conditions.delete(cosmetic);
  // Conversation and task acknowledgments keep the current AI workspace mounted.
  if (pathname === '/liekan/ai-chat') {
    conditions.delete('aiConversation');
    conditions.delete('aiRun');
  }
  if (conditions.get('dateMode') === 'default') {
    conditions.delete('date');
    conditions.delete('dateMode');
    conditions.delete('live');
  }
  conditions.sort();
  const resourceConditions = new URLSearchParams();
  for (const name of ['websiteId', 'teamId', 'id', 'context', 'scope']) {
    if (conditions.has(name)) resourceConditions.set(name, conditions.get(name));
  }
  resourceConditions.sort();
  const scope = `${manualPageScope(pathname || '', client)}?${resourceConditions}`;
  const clockConditions = ['date', 'unit', 'offset', 'timezone']
    .map(name => conditions.get(name))
    .join('|');
  const lastClock = useRef(clockConditions);
  const current = useRef<PageRead>(null);
  const pending = useRef<{
    page: PageRead;
    resolve: () => void;
    reject: (error: Error) => void;
    promise: Promise<void>;
  }>(null);
  if (!current.current || manualPageScope(current.current.scope, client) !== scope) {
    pending.current?.resolve();
    pending.current = null;
    current.current = {
      scope,
      token: ++nextPage,
      round: 0,
      force: false,
      now: Date.now(),
      queries: new Map(),
    };
    lastClock.current = clockConditions;
  } else if (lastClock.current !== clockConditions) {
    lastClock.current = clockConditions;
    const next = { ...current.current, now: Date.now() };
    if (pending.current?.page === current.current) pending.current.page = next;
    current.current = next;
  }
  current.current.scope = scope;
  const page = current.current;
  const register = useCallback((key: readonly unknown[]) => {
    const owner = current.current;
    const id = hashKey(key);
    const existing = owner.queries.get(id);
    owner.queries.set(id, { key, count: (existing?.count || 0) + 1 });
    if (!existing) update();
    return () => {
      const registered = owner.queries.get(id);
      if (!registered) return;
      if (registered.count > 1) registered.count--;
      else owner.queries.delete(id);
    };
  }, []);
  const refresh = useCallback(
    (expectedPage?: number, force = true) => {
      if (expectedPage !== undefined && expectedPage !== current.current?.token)
        return Promise.resolve();
      if (force && pending.current?.page === current.current && pending.current.page.force)
        return pending.current.promise;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setReadState(state => ({
          token: current.current.token,
          at: state.token === current.current.token ? state.at : 0,
          error: '网络连接已断开，请恢复连接后主动重试。',
        }));
        return Promise.reject(new Error('网络连接已断开'));
      }
      const previous = current.current;
      pending.current?.resolve();
      for (const { key } of previous.queries.values())
        void client.cancelQueries({ queryKey: key, exact: true });
      const next = {
        ...previous,
        round: previous.round + 1,
        force,
        now: Date.now(),
        queries: new Map(),
      };
      current.current = next;
      let resolve: () => void;
      let reject: (error: Error) => void;
      const promise = new Promise<void>((success, failure) => {
        resolve = success;
        reject = failure;
      });
      pending.current = { page: next, resolve, reject, promise };
      setBusy(true);
      setReadState(state => ({
        token: next.token,
        at: state.token === next.token ? state.at : 0,
        error: '',
      }));
      update();
      return promise;
    },
    [client],
  );

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const settle = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const active = current.current;
        const states = [...active.queries.values()].map(({ key }) => client.getQueryState(key));
        if (states.some(state => !state || state.fetchStatus !== 'idle')) return;
        const job = pending.current;
        const failures = states.filter(
          state => state?.status === 'error' || aggregateReadFailure(state?.data),
        );
        const latest = Math.max(0, ...states.map(state => state?.dataUpdatedAt || 0));
        if (latest && !failures.length)
          setReadState(state => ({
            token: active.token,
            at: latest,
            error: '',
          }));
        if (job?.page === active) {
          pending.current = null;
          setBusy(false);
          if (failures.length) {
            setReadState(state => ({
              token: active.token,
              at: state.token === active.token ? state.at : 0,
              error: '部分数据读取失败，仍显示上次读取结果，请主动重试。',
            }));
            job.reject(new Error('部分数据读取失败'));
          } else job.resolve();
        } else if (!job) {
          setBusy(false);
          if (failures.length)
            setReadState(state => ({
              token: active.token,
              at: state.token === active.token ? state.at : 0,
              error: '部分数据读取失败，仍显示上次读取结果，请主动重试。',
            }));
        }
      }, 25);
    };
    const unsubscribe = client.getQueryCache().subscribe(settle);
    settle();
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [client, revision, page.token]);

  useEffect(() => {
    const credentialsChanged = () => {
      const token = getClientAuthToken();
      if (token === principal.current) return;
      principal.current = token;
      void client.cancelQueries({ predicate: query => query.meta?.readPurpose === 'ordinary' });
      client.removeQueries({ predicate: query => query.meta?.readPurpose === 'ordinary' });
      pending.current?.resolve();
      pending.current = null;
      current.current = null;
      setUser(null);
      update();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === AUTH_TOKEN || event.key === null) credentialsChanged();
    };
    window.addEventListener('storage', storage);
    window.addEventListener('liekan-credentials-change', credentialsChanged);
    return () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener('liekan-credentials-change', credentialsChanged);
    };
  }, [client]);
  useEffect(
    () =>
      observeHistoryReturn(window, () => {
        for (const { key } of current.current?.queries.values() || [])
          void client.cancelQueries({ queryKey: key, exact: true });
        pending.current?.resolve();
        pending.current = null;
        current.current = null;
        setBusy(false);
        update();
      }),
    [client],
  );
  const value = useMemo(
    () => ({
      page,
      busy: busy && pending.current?.page === page,
      readAt: readState.token === page.token ? readState.at : 0,
      error: readState.token === page.token ? readState.error : '',
      refresh,
      register,
    }),
    [page, busy, readState, refresh, register],
  );
  return <ManualContext.Provider value={value}>{children}</ManualContext.Provider>;
}

export function useManualRefresh() {
  return useContext(ManualContext);
}
export function ManualAuthorizationBoundary({
  authorized,
  children,
}: {
  authorized: boolean;
  children: ReactNode;
}) {
  const parent = useContext(AuthorizationContext);
  return (
    <AuthorizationContext.Provider value={authorized && parent}>
      {children}
    </AuthorizationContext.Provider>
  );
}

/** Each page visit and explicit refresh owns one stable query generation. */
export function useManualQueryOptions(options: any) {
  const reading = useManualRefresh();
  const authorized = useContext(AuthorizationContext);
  const ordinary =
    options.meta?.readPurpose !== 'authorization' && typeof options.queryFn === 'function';
  const key =
    reading && ordinary
      ? [...options.queryKey, { manualPage: reading.page.token, manualRound: reading.page.round }]
      : options.queryKey;
  if (!ordinary) return options;
  const canRead = (query: any) =>
    authorized &&
    (typeof options.enabled === 'function'
      ? options.enabled(query) !== false
      : options.enabled !== false);
  return {
    ...options,
    ...ordinaryReadOptions,
    ...(!reading ? { refetchOnMount: 'always' as const } : {}),
    queryKey: key,
    // A failed attempt waits for an explicit read, including after authorization resumes.
    enabled: (query: any) => canRead(query) && query.state.status !== 'error',
    canRead,
    meta: { ...options.meta, readPurpose: 'ordinary' },
    queryFn:
      typeof options.queryFn === 'function'
        ? (context: any) => {
            if (typeof navigator !== 'undefined' && navigator.onLine === false)
              throw Object.assign(new Error('网络连接已断开，请恢复连接后主动重试。'), {
                offline: true,
              });
            return withClientFreshness(
              context.signal,
              () => options.queryFn({ ...context, queryKey: options.queryKey }),
              { refresh: !!reading?.busy && reading.page.force, queryKey: key },
            );
          }
        : options.queryFn,
  };
}
function ownerScope(key: readonly any[]) {
  if (!(key.at(-1) as any)?.manualPage) return hashKey(key);
  return hashKey(
    reportSnapshotOwner(key).map(value =>
      typeof value === 'string'
        ? value
        : value && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value).filter(
                ([name]) => !['manualRound', 'manualCondition', 'startAt', 'endAt'].includes(name),
              ),
            )
          : value,
    ),
  );
}
export function useRetainedRead(
  result: any,
  key: readonly unknown[],
  options?: any,
  queryClient?: QueryClient,
) {
  const reading = useManualRefresh();
  const client = useQueryClient(queryClient);
  const query = client.getQueryCache?.().find?.({ queryKey: key, exact: true });
  const readable = options?.canRead ? options.canRead(query) : result.isEnabled !== false;
  const id = hashKey(key);
  const registered =
    !!reading && (key.at(-1) as any)?.manualPage === reading.page.token && readable;
  useEffect(() => {
    if (registered) return reading.register(key);
  }, [id, registered, reading?.register]);
  const previousSelection = useRef<{ epoch: string; id: string }>(null);
  const epoch = `${reading?.page.token}:${reading?.page.round}`;
  useEffect(() => {
    const previous = previousSelection.current;
    previousSelection.current = { epoch, id };
    if (
      registered &&
      previous?.epoch === epoch &&
      previous.id !== id &&
      query?.isFetched() &&
      query.state.fetchStatus === 'idle'
    )
      void result.refetch({ cancelRefetch: false }).catch(() => {});
  }, [id, epoch, registered]);
  const owner = ownerScope(key);
  const previous = useRef<{ owner: string; id: string; epoch: string; data: any }>(null);
  const partialFailure = aggregateReadFailure(result.data);
  if (result.data !== undefined && !result.isPlaceholderData && !partialFailure)
    previous.current = { owner, id, epoch, data: result.data };
  const restricted = [401, 403, 404].includes(result.error?.status);
  if (restricted) previous.current = null;
  const retained =
    previous.current?.owner === owner &&
    (previous.current.id === id || previous.current.epoch !== epoch)
      ? previous.current.data
      : undefined;
  if (retained !== undefined && previous.current.epoch !== epoch)
    previous.current = { ...previous.current, id, epoch };
  const data =
    partialFailure && Array.isArray(result.data) && Array.isArray(retained)
      ? result.data.map(row => {
          const old = retained.find(previous => previous.id === row.id);
          return row.error && ![401, 403, 404].includes(row.error.status) && old && !old.error
            ? old
            : row;
        })
      : (result.data ?? retained);
  if (partialFailure && data !== undefined) previous.current = { owner, id, epoch, data };
  return {
    ...result,
    ...(partialFailure
      ? { error: partialFailure, isError: true, isSuccess: false, status: 'error' }
      : {}),
    data: restricted ? undefined : data,
    ...(result.data === undefined && !restricted && retained !== undefined
      ? {
          isPending: false,
          isLoading: false,
          isPlaceholderData: !result.error,
          ...(!result.error ? { status: 'success', isSuccess: true } : {}),
        }
      : {}),
    resolvedQueryKey: key,
    manualCanRead: readable,
    refetch: (settings?: any) => (readable ? result.refetch(settings) : Promise.resolve(result)),
  };
}
export const useManualQuery: typeof useQuery = ((options: any, client?: any) => {
  const input = useManualQueryOptions(options);
  return useRetainedRead(useQuery(input, client), input.queryKey, input, client);
}) as typeof useQuery;
export const useManualInfiniteQuery: typeof useInfiniteQuery = ((options: any, client?: any) => {
  const input = useManualQueryOptions(options);
  return useRetainedRead(useInfiniteQuery(input, client), input.queryKey, input, client);
}) as typeof useInfiniteQuery;

/** A known task can be followed within one bounded foreground visit. */
export function useTaskPolling(
  key: string,
  enabled: boolean,
  read: (signal: AbortSignal) => Promise<unknown>,
  interval: number,
) {
  const [round, resume] = useReducer(value => value + 1, 0);
  const [expired, setExpired] = useState(false);
  const work = useRef(read);
  work.current = read;
  useEffect(() => {
    setExpired(false);
    if (!enabled) return;
    const deadline = Date.now() + 300000;
    const abort = new AbortController();
    let busy = false;
    let alive = true;
    const poll = () => {
      if (Date.now() >= deadline) {
        setExpired(true);
        return;
      }
      if (!alive || busy || document.visibilityState === 'hidden' || navigator.onLine === false)
        return;
      busy = true;
      void work
        .current(abort.signal)
        .catch(() => {})
        .finally(() => {
          busy = false;
        });
    };
    const timer = setInterval(poll, interval);
    const expiry = setTimeout(() => {
      clearInterval(timer);
      abort.abort();
      setExpired(true);
    }, 300000);
    window.addEventListener('online', poll);
    document.addEventListener('visibilitychange', poll);
    return () => {
      alive = false;
      abort.abort();
      clearInterval(timer);
      clearTimeout(expiry);
      window.removeEventListener('online', poll);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [key, enabled, interval, round]);
  return { expired, resume };
}
