'use client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { dehydrate, hashKey, hydrate, QueryClient, useQueryClient } from '@tanstack/react-query';
import {
  type PersistedClient,
  persistQueryClientRestore,
  persistQueryClientSave,
} from '@tanstack/react-query-persist-client';
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { getApiUrl } from '@/lib/api-url';
import { getClientAuthToken } from '@/lib/client';
import { AUTH_TOKEN } from '@/lib/constants';
import { useApp } from '@/store/app';
import {
  type CacheManifestResponse,
  type CacheResource,
  cacheManifestResponseSchema,
} from '../contracts/cache-manifest';
import {
  browserCacheLimits,
  browserQueryPolicy,
  stableBusinessKey,
  uniqueCacheResources,
} from './cache-policy';
import {
  aggregateReadFailure,
  monotonicNow,
  restoreClientFreshness,
  type SerializedFreshness,
  serializeClientFreshness,
} from './client-freshness';

const broadcastKey = 'liekan-cache-invalidation-v1';
const resourceKey = (value: CacheResource) => `${value.type}:${value.id}`;
function resourceVersion(value: CacheManifestResponse['resources'][number], geo = false) {
  if (value.authorized !== true) return null;
  const authorized = value as CacheResource & { strongVersion: string; geoVersion?: string | null };
  return geo ? authorized.geoVersion || authorized.strongVersion : authorized.strongVersion;
}
type Scope = {
  namespace: string;
  userId: string;
  versionKind?: 'geo' | 'ordinary';
  resources: (CacheResource & { strongVersion: string })[];
};
type Envelope = Scope & { freshness?: SerializedFreshness; savedAt: number; accessedAt: number };
export type PreparedCacheQuery = {
  key: readonly unknown[];
  scope?: Scope;
  generation: number;
  requests?: { key: string; sequence: number }[];
};
export interface AsyncCacheStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
}

/** Every operation joins one transaction queue; a logout delete follows in-flight writes. */
export function createIndexedDbCacheStorage(): AsyncCacheStorage {
  let database: Promise<IDBDatabase>;
  let queue: Promise<unknown> = Promise.resolve();
  const open = () =>
    (database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('liekan-private-aggregates-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('snapshots');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Browser cache unavailable'));
    }));
  const operation = <T,>(
    write: boolean,
    act: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const work = queue
      .catch(() => {})
      .then(async () => {
        const db = await open();
        return new Promise<T>((resolve, reject) => {
          const transaction = db.transaction('snapshots', write ? 'readwrite' : 'readonly');
          const request = act(transaction.objectStore('snapshots'));
          transaction.oncomplete = () => resolve(request.result);
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      });
    queue = work;
    return work;
  };
  return {
    getItem: async key => (await operation(false, store => store.get(key))) ?? null,
    setItem: async (key, value) => {
      await operation(true, store => store.put(value, key));
    },
    removeItem: async key => {
      await operation(true, store => store.delete(key));
    },
    clear: async () => {
      await operation(true, store => store.clear());
    },
  };
}

function safeProjection(value: unknown, depth = 0): boolean {
  if (depth > 40) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(item => safeProjection(item, depth + 1));
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
    return false;
  return Object.entries(value).every(
    ([name, item]) =>
      !/^(?:password|currentPassword|token|partialToken|apiKey|accessToken|authorization|rawIp|ipAddress|userAgent|visitorId|sessionId|recording|replay)$/i.test(
        name,
      ) &&
      (item === undefined || safeProjection(item, depth + 1)),
  );
}

/** Size and age limits apply per item before the whole serialized client is stored. */
export function pruneBrowserClient(client: PersistedClient, now: number): PersistedClient {
  const encoder = new TextEncoder();
  const queries = client.clientState.queries
    .flatMap(query => {
      const envelope = query.meta?.browserCache as Envelope | undefined;
      if (
        query.state.status !== 'success' ||
        !envelope ||
        !safeProjection(query.state.data) ||
        aggregateReadFailure(query.state.data)
      )
        return [];
      const freshness = serializeClientFreshness(query.state.data) || envelope.freshness;
      if (!freshness || !Array.isArray(freshness.resources) || !freshness.resources.length)
        return [];
      if (
        !Number.isFinite(envelope.savedAt) ||
        now - envelope.savedAt > browserCacheLimits.maxAge ||
        envelope.savedAt > now ||
        !envelope.resources?.length
      )
        return [];
      const { manualPage, manualRound, manualEpoch, manualForce, ...metadata } = query.meta;
      const next = {
        ...query,
        meta: {
          ...metadata,
          browserCache: {
            ...envelope,
            freshness,
            savedAt: freshness.generatedAt > 0 ? freshness.generatedAt : envelope.savedAt,
          },
        },
      };
      return encoder.encode(JSON.stringify(next)).byteLength <= browserCacheLimits.resultBytes
        ? [next]
        : [];
    })
    .sort(
      (a, b) =>
        Number((b.meta.browserCache as Envelope).accessedAt) -
        Number((a.meta.browserCache as Envelope).accessedAt),
    );
  let bytes = 0;
  const bounded = queries.filter((query, index) => {
    const size = encoder.encode(JSON.stringify(query)).byteLength;
    if (index >= browserCacheLimits.entries || bytes + size > browserCacheLimits.bytes - 2048)
      return false;
    bytes += size;
    return true;
  });
  return { ...client, clientState: { mutations: [], queries: bounded } };
}

export class BrowserSnapshotCache {
  generation = 0;
  private token: string;
  private session: Promise<CacheManifestResponse>;
  private manifest: CacheManifestResponse;
  private clockAt = 0;
  private persister: ReturnType<typeof createAsyncStoragePersister>;
  private disk: Promise<PersistedClient | undefined>;
  private verified = new Map<string, Promise<CacheManifestResponse['resources'][number]>>();
  private waiting = new Map<
    string,
    { resource: CacheResource; resolve: (value: any) => void; reject: (error: any) => void }
  >();
  private scheduled = false;
  private abort = new AbortController();
  private stopSave: () => void;
  private saveTimer: ReturnType<typeof setTimeout>;
  private touched = new Map<string, number>();
  private resourceScopes = new Map<string, { ordinary: string; geo: string }>();
  private manifestSequence = 0;
  private resourceRequests = new Map<string, number>();
  private resourceSequenceProof = new WeakMap<object, number>();
  constructor(
    private client: QueryClient,
    private storage: AsyncCacheStorage = createIndexedDbCacheStorage(),
    private request: typeof fetch = fetch,
    private credentials = getClientAuthToken,
  ) {
    this.token = credentials();
  }
  private live(generation: number) {
    return generation === this.generation && this.token === this.credentials() && !!this.token;
  }
  assertCurrent(prepared: PreparedCacheQuery) {
    if (!this.live(prepared.generation))
      throw new DOMException('Read identity retired', 'AbortError');
    if (
      prepared.requests?.some(
        request => this.resourceRequests.get(request.key) !== request.sequence,
      )
    )
      throw new DOMException('Manifest request retired', 'AbortError');
    if (
      prepared.scope?.resources.some(resource => {
        const current = this.resourceScopes.get(resourceKey(resource));
        return (
          !current ||
          current[prepared.scope.versionKind === 'geo' ? 'geo' : 'ordinary'] !==
            resource.strongVersion
        );
      })
    )
      throw new DOMException('Resource boundary retired', 'AbortError');
  }
  serverNow() {
    return this.manifest
      ? this.manifest.serverTime + Math.max(0, monotonicNow() - this.clockAt)
      : 0;
  }
  private async readManifest(resources: CacheResource[], generation: number) {
    if (!this.live(generation) || (typeof navigator !== 'undefined' && navigator.onLine === false))
      throw new DOMException('Cache authorization unavailable', 'AbortError');
    const url = new URL(getApiUrl('/liekan/cache-manifest'), window.location.origin);
    url.searchParams.set('resources', JSON.stringify(resources));
    const sequence = ++this.manifestSequence;
    for (const resource of resources) this.resourceRequests.set(resourceKey(resource), sequence);
    const startedAt = monotonicNow();
    const request = this.request;
    const response = await request(url, {
      signal: this.abort.signal,
      cache: 'no-store',
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (!response.ok)
      throw Object.assign(new Error('Cache authorization failed'), { status: response.status });
    const manifest = cacheManifestResponseSchema.parse(await response.json());
    if (!this.live(generation)) throw new DOMException('Read identity retired', 'AbortError');
    if (resources.some(resource => this.resourceRequests.get(resourceKey(resource)) !== sequence))
      throw new DOMException('Manifest request retired', 'AbortError');
    if (
      this.manifest &&
      (this.manifest.userId !== manifest.userId || this.manifest.instanceId !== manifest.instanceId)
    ) {
      this.invalidate(false);
      throw new DOMException('Cache installation changed', 'AbortError');
    }
    this.manifest = {
      ...manifest,
      serverTime: Math.max(
        this.serverNow(),
        manifest.serverTime + Math.max(0, monotonicNow() - startedAt),
      ),
    };
    this.clockAt = monotonicNow();
    for (const resource of manifest.resources) {
      this.resourceSequenceProof.set(resource, sequence);
      this.resourceScopes.set(resourceKey(resource), {
        ordinary: resourceVersion(resource),
        geo: resourceVersion(resource, true),
      });
    }
    return manifest;
  }
  private initialize() {
    if (!this.session)
      this.session = this.readManifest([], this.generation)
        .then(manifest => {
          const generation = this.generation;
          const url = new URL(getApiUrl('/liekan/cache-manifest'), window.location.origin);
          const namespace = hashKey([
            url.origin,
            url.pathname.replace(/\/liekan\/cache-manifest$/, ''),
            manifest.instanceId,
            manifest.userId,
          ]);
          const key = `${browserCacheLimits.format}:${namespace}`;
          const persister = createAsyncStoragePersister({
            key,
            throttleTime: 0,
            storage: {
              getItem: async name =>
                this.live(generation) ? this.storage.getItem(name).catch(() => null) : null,
              setItem: async (name, value) => {
                if (!this.live(generation)) return;
                await this.storage.setItem(name, value).catch(() => {});
              },
              removeItem: async name => {
                await this.storage.removeItem(name).catch(() => {});
              },
            },
            serialize: async persisted => {
              const previous = await this.disk;
              const present = new Set(
                this.client
                  .getQueryCache()
                  .getAll()
                  .map(query => query.queryHash),
              );
              const retained =
                previous?.clientState.queries.filter(query => !present.has(query.queryHash)) || [];
              const bounded = pruneBrowserClient(
                {
                  ...persisted,
                  clientState: {
                    mutations: [],
                    queries: [...retained, ...persisted.clientState.queries],
                  },
                },
                this.serverNow(),
              );
              if (this.live(generation)) this.disk = Promise.resolve(bounded);
              return JSON.stringify(bounded);
            },
          });
          this.persister = persister;
          this.disk = Promise.resolve(persister.restoreClient())
            .then(value => (value?.buster === browserCacheLimits.format ? value : undefined))
            .catch(() => undefined);
          this.stopSave = this.client.getQueryCache().subscribe(event => {
            if (
              !this.live(generation) ||
              event.type !== 'updated' ||
              event.query.state.fetchStatus !== 'idle'
            )
              return;
            clearTimeout(this.saveTimer);
            this.saveTimer = setTimeout(() => {
              void this.save();
            }, 30);
          });
          return manifest;
        })
        .catch(error => {
          this.session = undefined;
          throw error;
        });
    return this.session;
  }
  private async authorize(resources: CacheResource[], visit: string, generation: number) {
    const promises = resources.map(resource => {
      const id = `${visit}:${resourceKey(resource)}`;
      if (!this.verified.has(id)) {
        const promise = new Promise<CacheManifestResponse['resources'][number]>((resolve, reject) =>
          this.waiting.set(id, { resource, resolve, reject }),
        );
        this.verified.set(id, promise);
      }
      return this.verified.get(id);
    });
    if (!this.scheduled && this.waiting.size) {
      this.scheduled = true;
      queueMicrotask(async () => {
        this.scheduled = false;
        const queued = [...this.waiting.entries()];
        this.waiting.clear();
        const unique = uniqueCacheResources(queued.map(([, item]) => item.resource));
        try {
          const responses: CacheManifestResponse['resources'] = [];
          for (let index = 0; index < unique.length; index += 20) {
            const manifest = await this.readManifest(unique.slice(index, index + 20), generation);
            responses.push(...manifest.resources);
          }
          for (const [, item] of queued)
            item.resolve(
              responses.find(value => resourceKey(value) === resourceKey(item.resource)) || {
                ...item.resource,
                authorized: false,
              },
            );
        } catch (error) {
          for (const [, item] of queued) item.reject(error);
        }
      });
    }
    const versions = await Promise.all(promises);
    if (!this.live(generation)) throw new DOMException('Read identity retired', 'AbortError');
    return versions;
  }
  async prepare(
    key: readonly unknown[],
    meta: Record<string, any>,
    visit: string,
    locale: string,
  ): Promise<PreparedCacheQuery> {
    const policy = browserQueryPolicy(key, meta);
    const generation = this.generation;
    if (!policy || !this.token) return { key: stableBusinessKey(key, true), generation };
    await this.initialize();
    const versions = await this.authorize(policy.resources, visit, generation);
    const denied = versions.some(value => !value.authorized);
    const resources = versions
      .filter(value => value.authorized)
      .map(value => ({
        ...value,
        strongVersion: resourceVersion(value, !!meta.geoSnapshot),
      })) as Scope['resources'];
    const namespace = hashKey([
      new URL(getApiUrl('/liekan/cache-manifest'), window.location.origin).href.replace(
        /\/liekan\/cache-manifest$/,
        '',
      ),
      this.manifest.instanceId,
    ]);
    const scope: Scope = {
      namespace,
      userId: this.manifest.userId,
      versionKind: meta.geoSnapshot ? 'geo' : 'ordinary',
      resources,
    };
    const strongScope = hashKey(
      resources.map(value => [value.type, value.id, value.strongVersion]),
    );
    const resolved = [
      ...stableBusinessKey(key, true),
      {
        cacheFormat: browserCacheLimits.format,
        cacheNamespace: namespace,
        cacheUser: scope.userId,
        cacheScope: strongScope,
        cacheLocale: locale,
      },
    ];
    const prepared = {
      key: resolved,
      scope,
      generation,
      requests: versions.map(resource => ({
        key: resourceKey(resource),
        sequence: this.resourceSequenceProof.get(resource),
      })),
    };
    this.assertCurrent(prepared);
    // Clear every old generation of the same resource before permitting a new projection.
    const stale = (query: any) => {
      const previous = query.meta?.browserCache as Envelope | undefined;
      return (
        previous?.namespace === namespace &&
        previous.resources.some(resource =>
          versions.some(
            value =>
              resourceKey(value) === resourceKey(resource) &&
              resourceVersion(value, previous.versionKind === 'geo') !== resource.strongVersion,
          ),
        )
      );
    };
    await this.client.cancelQueries({ predicate: stale });
    this.assertCurrent(prepared);
    this.client.removeQueries({ predicate: stale });
    let persisted = await this.disk;
    this.assertCurrent(prepared);
    if (persisted) {
      const filtered = persisted.clientState.queries.filter(query => !stale(query));
      if (filtered.length !== persisted.clientState.queries.length) {
        persisted = { ...persisted, clientState: { mutations: [], queries: filtered } };
        this.disk = Promise.resolve(persisted);
        await this.persister.persistClient(persisted);
        this.assertCurrent(prepared);
      }
    }
    if (denied) {
      void this.save();
      throw Object.assign(new Error('Resource authorization changed'), { status: 403 });
    }
    this.assertCurrent(prepared);
    const query = persisted?.clientState.queries.find(
      query => hashKey(query.queryKey) === hashKey(resolved),
    );
    const envelope = query?.meta?.browserCache as Envelope | undefined;
    const now = this.serverNow();
    if (
      query &&
      envelope &&
      envelope.namespace === namespace &&
      envelope.userId === scope.userId &&
      envelope.freshness &&
      now >= envelope.savedAt &&
      now - envelope.savedAt <= browserCacheLimits.maxAge &&
      hashKey(envelope.resources.map(value => [value.type, value.id, value.strongVersion])) ===
        strongScope &&
      safeProjection(query.state.data)
    ) {
      const receivedAt = monotonicNow();
      restoreClientFreshness(query.state.data, envelope.freshness, now, receivedAt);
      const staged = new QueryClient();
      await persistQueryClientRestore({
        queryClient: staged,
        buster: browserCacheLimits.format,
        maxAge: Infinity,
        persister: {
          persistClient: async () => {},
          removeClient: async () => {},
          restoreClient: async () => ({
            ...persisted,
            timestamp: Date.now(),
            clientState: { mutations: [], queries: [query] },
          }),
        },
      });
      try {
        this.assertCurrent(prepared);
        hydrate(this.client, dehydrate(staged));
      } finally {
        staged.clear();
      }
    }
    this.touched.set(hashKey(resolved), now);
    this.assertCurrent(prepared);
    // Request order fences preparation; a completed grant follows identity and strong scope.
    return { key: prepared.key, scope: prepared.scope, generation: prepared.generation };
  }
  async clock(scope: string, conditions: string) {
    await this.initialize();
    const persisted = await this.disk;
    const now = this.serverNow();
    return persisted?.clientState.queries
      .flatMap(query => {
        const clock = query.meta?.manualClock as
          | { scope: string; conditions: string; now: number }
          | undefined;
        const envelope = query.meta?.browserCache as Envelope | undefined;
        return clock?.scope === scope &&
          clock.conditions === conditions &&
          Number.isFinite(clock.now) &&
          envelope?.freshness?.expiresAt > now &&
          envelope.savedAt <= now &&
          now - envelope.savedAt <= browserCacheLimits.maxAge
          ? [clock.now]
          : [];
      })
      .sort((a, b) => b - a)[0];
  }
  envelope(prepared: PreparedCacheQuery): Envelope | undefined {
    if (!prepared.scope) return;
    const query = this.client.getQueryCache().find({ queryKey: prepared.key, exact: true });
    const old = query?.meta?.browserCache as Envelope | undefined;
    return {
      ...prepared.scope,
      freshness: old?.freshness,
      savedAt: old?.savedAt || this.serverNow(),
      accessedAt: this.touched.get(hashKey(prepared.key)) || this.serverNow(),
    };
  }
  async save() {
    if (!this.persister || !this.live(this.generation)) return;
    await persistQueryClientSave({
      queryClient: this.client,
      persister: this.persister,
      buster: browserCacheLimits.format,
      dehydrateOptions: {
        shouldDehydrateMutation: () => false,
        shouldDehydrateQuery: query => {
          const envelope = query.meta?.browserCache as Envelope | undefined;
          const proof = serializeClientFreshness(query.state.data);
          return (
            query.state.status === 'success' &&
            !!envelope &&
            envelope.namespace ===
              hashKey([
                new URL(getApiUrl('/liekan/cache-manifest'), window.location.origin).href.replace(
                  /\/liekan\/cache-manifest$/,
                  '',
                ),
                this.manifest.instanceId,
              ]) &&
            envelope.userId === this.manifest.userId &&
            !!proof &&
            proof.resources.every(resource =>
              envelope.resources.some(value => resourceKey(resource) === resourceKey(value)),
            ) &&
            !query.state.isInvalidated &&
            safeProjection(query.state.data)
          );
        },
      },
    }).catch(() => {});
  }
  invalidate(broadcast = true) {
    this.generation++;
    this.abort.abort();
    this.stopSave?.();
    clearTimeout(this.saveTimer);
    this.verified.clear();
    for (const item of this.waiting.values())
      item.reject(new DOMException('Read identity retired', 'AbortError'));
    this.waiting.clear();
    void this.client.cancelQueries({ predicate: query => !!query.meta?.browserCache });
    this.client.removeQueries({ predicate: query => !!query.meta?.browserCache });
    void this.storage.clear().catch(() => {});
    if (broadcast)
      try {
        localStorage.setItem(broadcastKey, `${Date.now()}:${Math.random()}`);
      } catch {}
  }
  dispose() {
    this.stopSave?.();
    clearTimeout(this.saveTimer);
    this.abort.abort();
  }
}

const CacheContext = createContext<BrowserSnapshotCache>(null);
export function BrowserCacheProvider({
  children,
  storage,
}: {
  children: ReactNode;
  storage?: AsyncCacheStorage;
}) {
  const client = useQueryClient();
  const [, setRevision] = useState(0);
  const current = useRef<BrowserSnapshotCache>(null);
  if (!current.current) current.current = new BrowserSnapshotCache(client, storage);
  useEffect(() => {
    const changed = (event?: Event) => {
      if (event instanceof StorageEvent && ![AUTH_TOKEN, broadcastKey, null].includes(event.key))
        return;
      current.current.invalidate(!(event instanceof StorageEvent));
      current.current = new BrowserSnapshotCache(client, storage);
      setRevision(value => value + 1);
    };
    window.addEventListener('liekan-credentials-change', changed);
    window.addEventListener('storage', changed);
    return () => {
      window.removeEventListener('liekan-credentials-change', changed);
      window.removeEventListener('storage', changed);
      current.current.dispose();
    };
  }, [client, storage]);
  return <CacheContext.Provider value={current.current}>{children}</CacheContext.Provider>;
}

export function useBrowserCacheQuery(options: any, visit: string, enabled: boolean) {
  const cache = useContext(CacheContext);
  const locale = useApp(state => state.locale);
  const projectionLocale = options.meta?.geoSnapshot ? 'raw' : locale;
  const share = useApp(state => state.shareToken?.token);
  const eligible = !share && browserQueryPolicy(options.queryKey, options.meta);
  const selection = hashKey([
    stableBusinessKey(options.queryKey),
    visit,
    projectionLocale,
    cache?.generation,
    !!eligible,
  ]);
  const [prepared, setPrepared] = useState<{
    cache: BrowserSnapshotCache;
    selection: string;
    value: PreparedCacheQuery;
  }>(null);
  useEffect(() => {
    if (!cache || !eligible || !enabled) return;
    let alive = true;
    void cache
      .prepare(options.queryKey, options.meta || {}, visit, projectionLocale)
      .then(value => {
        if (alive) setPrepared({ cache, selection, value });
      })
      .catch(() => {
        // A failed manifest never restores private data; the normal API still verifies a new read.
        if (alive)
          setPrepared({
            cache,
            selection,
            value: {
              key: [
                ...stableBusinessKey(options.queryKey),
                { cacheNamespace: 'unverified', cacheScope: selection },
              ],
              generation: cache.generation,
            },
          });
      });
    return () => {
      alive = false;
    };
  }, [cache, selection, enabled]);
  if (!cache || !eligible)
    return {
      key: stableBusinessKey(options.queryKey),
      ready: true,
      meta: options.meta,
      assertCurrent: () => {},
    };
  const value =
    prepared?.cache === cache && prepared.selection === selection ? prepared.value : undefined;
  return {
    key: value?.key || [
      ...stableBusinessKey(options.queryKey),
      { cacheScope: `pending:${selection}` },
    ],
    ready: !!value,
    meta: {
      ...options.meta,
      cachePending: enabled && !value,
      ...(value?.scope ? { browserCache: cache.envelope(value) } : {}),
    },
    assertCurrent: () => {
      if (value) cache.assertCurrent(value);
    },
  };
}

export function useBrowserCacheClock(scope: string, conditions: string) {
  const cache = useContext(CacheContext);
  const selection = hashKey([scope, conditions, cache?.generation]);
  const [value, setValue] = useState<{
    cache: BrowserSnapshotCache;
    selection: string;
    now?: number;
  }>(null);
  useEffect(() => {
    if (!cache || !getClientAuthToken()) return;
    let alive = true;
    void cache
      .clock(scope, conditions)
      .then(now => {
        if (alive) setValue({ cache, selection, now });
      })
      .catch(() => {
        if (alive) setValue({ cache, selection });
      });
    return () => {
      alive = false;
    };
  }, [cache, selection]);
  const current = value?.cache === cache && value?.selection === selection;
  return {
    ready: !cache || !getClientAuthToken() || current,
    now: current ? value.now : undefined,
  };
}
