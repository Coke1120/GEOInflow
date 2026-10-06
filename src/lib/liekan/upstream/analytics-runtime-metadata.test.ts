import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryCache } from './query-cache';
import { AnalyticsRedis } from './analytics-redis';
import { installAnalyticsRuntime } from './analytics-runtime';
import { AnalyticsRestart } from './analytics-budget';
import {
  bindCacheRequest,
  currentCacheContext,
  prepareAnalyticsVersions,
  withQueryCacheHeaders,
} from './cache-context';

vi.mock('./analytics-hot', () => ({
  rememberAnalyticsHot: async () => {},
  reserveWorkerComputation: async () => true,
}));
const id = '30000000-0000-4000-8000-000000000001';
const otherId = '30000000-0000-4000-8000-000000000002';
const actor = '40000000-0000-4000-8000-000000000001';
const tags = [`website:${id}`];
type Read = { query: string; parameters: any[] };
type Metadata = { reads: Read[]; timeout: number };
type Entry = { key: string; tags: string[] };
const entries = [
  { key: 'current', tags },
  { key: 'comparison', tags },
];

function fixture() {
  const metadata: Metadata[] = [];
  const state = {
    denied: false,
    strong: 0,
    holdCommit: undefined as (() => Promise<void>) | undefined,
  };
  const primary = () => ({
    $transaction: async (work: (tx: any) => Promise<any>, options: any) => {
      const snapshot = options?.isolationLevel === 'RepeatableRead' ? state.strong : undefined;
      const record = { reads: [], timeout: options.timeout } as Metadata;
      if (snapshot === undefined) metadata.push(record);
      const result = await work({
        $executeRawUnsafe: async () => 0,
        $queryRawUnsafe: async (query: string, ...parameters: any[]) => {
          record.reads.push({ query, parameters });
          if (query.includes('SELECT role')) return [{ role: 'admin' }];
          if (query.includes('WITH resources'))
            return state.denied ? [] : parameters[0].map((id: string) => ({ id }));
          if (query.includes('FROM liekan_analytics_revision'))
            return parameters[0].map((id: string) => ({
              type: 'website',
              id,
              revision: String(snapshot ?? state.strong),
            }));
          if (query.includes('FROM liekan_log_state'))
            return parameters[0].map((id: string) => ({ id, data: '0', policy: '0' }));
          return [];
        },
      });
      if (snapshot === undefined && state.holdCommit) {
        const held = state.holdCommit;
        state.holdCommit = undefined;
        await held();
      }
      return result;
    },
  });
  const cache = new QueryCache();
  installAnalyticsRuntime(cache, primary, new AnalyticsRedis(''));
  return { cache, metadata, state };
}
type Fixture = ReturnType<typeof fixture>;

function request(work: () => Promise<unknown>, scope: unknown = { private: true }) {
  return withQueryCacheHeaders(async () => {
    bindCacheRequest(new Request('http://localhost/synthetic'), { user: { id: actor } });
    currentCacheContext().scope = scope;
    return Response.json(await work());
  });
}
async function prime(f: Fixture, definitions = entries, scope?: unknown) {
  await request(async () => {
    const results = await Promise.all(
      definitions.map(entry =>
        f.cache.read(entry.key, 30000, entry.tags, async () => ({ strong: f.state.strong })),
      ),
    );
    return results.map(result => result.value);
  }, scope);
  f.metadata.length = 0;
}
async function warmPair(f: Fixture, definitions = entries) {
  return request(async () => {
    for (const entry of definitions) await prepareAnalyticsVersions(entry.tags);
    return Promise.all(
      definitions.map(entry =>
        f.cache.read(entry.key, 30000, entry.tags, async () => {
          throw new Error('Expected a warm result');
        }),
      ),
    );
  });
}
beforeEach(() =>
  vi.stubEnv('DATABASE_URL', 'postgresql://synthetic:synthetic@localhost/metadata_fixture'),
);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('shares one final primary authorization/version check for two ready warm results', async () => {
  const f = fixture();
  await prime(f);
  const response = await warmPair(f);
  expect(response.status).toBe(200);
  expect((await response.json()).every((result: any) => result.status === 'hit')).toBe(true);
  expect(f.metadata).toHaveLength(2);
  for (const needle of [
    'SELECT role',
    'WITH resources',
    'FROM liekan_analytics_revision',
    'FROM liekan_log_state',
  ])
    expect(
      f.metadata.flatMap(record => record.reads).filter(read => read.query.includes(needle)),
    ).toHaveLength(2);
});

it('normalizes tag order and duplicates within a ready batch', async () => {
  const definitions = [
    { key: 'a', tags: [...tags, `website:${otherId}`] },
    { key: 'b', tags: [`website:${otherId}`, ...tags, ...tags] },
  ];
  const f = fixture();
  await prime(f, definitions);
  expect((await warmPair(f, definitions)).status).toBe(200);
  expect(f.metadata).toHaveLength(2);
});

it('keeps different resource tag sets in separate final checks', async () => {
  const definitions = [
    { key: 'a', tags },
    { key: 'b', tags: [`website:${otherId}`] },
  ];
  const f = fixture();
  await prime(f, definitions);
  expect((await warmPair(f, definitions)).status).toBe(200);
  expect(f.metadata).toHaveLength(4);
});

it('keeps simultaneous consumers in different request contexts independently authorized', async () => {
  const f = fixture();
  await prime(f);
  const responses = await Promise.all(
    entries.map(entry =>
      request(async () => {
        await prepareAnalyticsVersions(tags);
        return f.cache.read(entry.key, 30000, tags, async () => null);
      }),
    ),
  );
  expect(responses.every(response => response.status === 200)).toBe(true);
  expect(f.metadata).toHaveLength(4);
});

it('does not reuse a completed final check for a later ready result', async () => {
  const f = fixture();
  await prime(f);
  expect(
    (
      await request(async () => {
        await prepareAnalyticsVersions(tags);
        for (const entry of entries) await f.cache.read(entry.key, 30000, tags, async () => null);
        return true;
      })
    ).status,
  ).toBe(200);
  expect(f.metadata).toHaveLength(3);
});

it.each(['authorization', 'strong version'])(
  'rechecks a late result while the earlier %s check is pending',
  async change => {
    const f = fixture();
    await prime(f);
    let started!: () => void, release!: () => void;
    const finishedSql = new Promise<void>(resolve => {
      started = resolve;
    });
    const heldCommit = new Promise<void>(resolve => {
      release = resolve;
    });
    const response = await request(async () => {
      await prepareAnalyticsVersions(tags);
      f.state.holdCommit = async () => {
        started();
        await heldCommit;
      };
      const first = f.cache.read('current', 30000, tags, async () => null);
      try {
        await finishedSql;
        if (change === 'authorization') f.state.denied = true;
        else f.state.strong++;
        const late = f.cache.read('comparison', 30000, tags, async () => null);
        if (change === 'authorization') await expect(late).rejects.toMatchObject({ status: 403 });
        else await expect(late).rejects.toBeInstanceOf(AnalyticsRestart);
        expect(f.metadata).toHaveLength(3);
      } finally {
        release();
      }
      expect((await first).status).toBe('hit');
      return true;
    });
    expect(response.status).toBe(200);
  },
);

it('uses the shortest deadline of consumers joining the same ready batch', async () => {
  const f = fixture();
  await prime(f);
  expect(
    (
      await request(async () => {
        await prepareAnalyticsVersions(tags);
        const context = currentCacheContext(),
          began = Date.now();
        context.deadline = began + 1000;
        const first = f.cache.read('current', 30000, tags, async () => null);
        context.deadline = began + 200;
        const second = f.cache.read('comparison', 30000, tags, async () => null);
        return Promise.all([first, second]);
      })
    ).status,
  ).toBe(200);
  expect(f.metadata).toHaveLength(2);
  expect(f.metadata[1].timeout).toBeGreaterThan(0);
  expect(f.metadata[1].timeout).toBeLessThanOrEqual(200);
});

it('rejects an expired queued batch before starting primary SQL', async () => {
  const f = fixture();
  await prime(f);
  const queued: Array<() => void> = [];
  const scheduling = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation(work => {
    queued.push(work);
  });
  const response = await request(async () => {
    await prepareAnalyticsVersions(tags);
    const began = Date.now();
    currentCacheContext().deadline = began + 1000;
    const settled = Promise.allSettled(
      entries.map(entry => f.cache.read(entry.key, 30000, tags, async () => null)),
    );
    await vi.waitFor(() => expect(queued).toHaveLength(1));
    vi.spyOn(Date, 'now').mockReturnValue(began + 1001);
    scheduling.mockRestore();
    queued[0]();
    const results = await settled;
    expect(
      results.every(result => result.status === 'rejected' && result.reason.status === 503),
    ).toBe(true);
    expect(f.metadata).toHaveLength(1);
    return true;
  });
  expect(response.status).toBe(200);
});

it('separates authorized final checks from computation-only version checks', async () => {
  const f = fixture();
  await prime(f);
  const queued: Array<() => void> = [];
  const scheduling = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation(work => {
    queued.push(work);
  });
  const response = await request(async () => {
    await prepareAnalyticsVersions(tags);
    const warm = f.cache.read('current', 30000, tags, async () => null);
    await vi.waitFor(() => expect(queued).toHaveLength(1));
    const cold = f.cache.read('cold', 30000, tags, async () => 1);
    await vi.waitFor(() => expect(queued).toHaveLength(2));
    scheduling.mockRestore();
    for (const flush of queued) flush();
    return Promise.all([warm, cold]);
  });
  expect(response.status).toBe(200);
  expect(f.metadata).toHaveLength(4);
  expect(
    f.metadata
      .slice(1, 3)
      .map(record => record.reads.some(read => read.query.includes('SELECT role'))),
  ).toEqual([true, false]);
});

it.each(['actor', 'scope'])(
  'separates ready batches after the request %s changes',
  async change => {
    const f = fixture();
    const scopeA = { private: true, synthetic: 'a' },
      scopeB = { private: true, synthetic: 'b' };
    await prime(f, [entries[0]], change === 'scope' ? scopeA : undefined);
    await prime(f, [entries[1]], change === 'scope' ? scopeB : undefined);
    const queued: Array<() => void> = [];
    const scheduling = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation(work => {
      queued.push(work);
    });
    const response = await request(
      async () => {
        await prepareAnalyticsVersions(tags);
        const first = f.cache.read('current', 30000, tags, async () => null);
        await vi.waitFor(() => expect(queued).toHaveLength(1));
        if (change === 'actor') currentCacheContext().actor = otherId;
        else currentCacheContext().scope = scopeB;
        const second = f.cache.read('comparison', 30000, tags, async () => null);
        await vi.waitFor(() => expect(queued).toHaveLength(2));
        scheduling.mockRestore();
        for (const flush of queued) flush();
        return Promise.all([first, second]);
      },
      change === 'scope' ? scopeA : undefined,
    );
    expect(response.status).toBe(200);
    expect(f.metadata).toHaveLength(3);
    expect(f.metadata[1].reads.find(read => read.query.includes('SELECT role')).parameters[0]).toBe(
      actor,
    );
    expect(f.metadata[2].reads.find(read => read.query.includes('SELECT role')).parameters[0]).toBe(
      change === 'actor' ? otherId : actor,
    );
  },
);
