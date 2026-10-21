// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  receipts: new Map<string, { payload_hash: string; event_id: string | null }>(),
  locks: new Map<string, Promise<void>>(),
  events: [] as any[],
  data: [] as any[],
  revenue: [] as any[],
  quality: [] as any[],
  geography: [] as any[],
  observation: [] as any[],
  diagnostics: [] as any[],
  queries: [] as { sql: string; values: unknown[] }[],
  primaryOptions: [] as unknown[],
  schema: 'collection_fixture',
  failAt: '' as string,
  transactions: 0,
  rollbacks: 0,
}));

vi.mock('@/lib/prisma', () => {
  const writers = (target: { events: any[]; data: any[]; revenue: any[] }) => ({
    websiteEvent: {
      create: async ({ data }: any) => {
        if (state.failAt === 'event') throw new Error('event-write-failed');
        target.events.push(data);
        return data;
      },
    },
    eventData: {
      createMany: async ({ data }: any) => {
        if (state.failAt === 'data') throw new Error('data-write-failed');
        target.data.push(...data);
        return { count: data.length };
      },
    },
    revenue: {
      create: async ({ data }: any) => {
        if (state.failAt === 'revenue') throw new Error('revenue-write-failed');
        target.revenue.push(data);
        return data;
      },
    },
  });
  const client = {
    ...writers(state),
    $executeRawUnsafe: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    $transaction: async (work: any) => {
      state.transactions++;
      const pending = {
        events: [] as any[],
        data: [] as any[],
        revenue: [] as any[],
        quality: [] as any[],
        geography: [] as any[],
        observation: [] as any[],
        diagnostics: [] as any[],
      };
      const receipts = new Map<string, { payload_hash: string; event_id: string | null }>();
      const releases: (() => void)[] = [];
      const tx = {
        ...writers(pending),
        $queryRawUnsafe: async (sql: string, ...values: unknown[]) => {
          state.queries.push({ sql, values });
          if (/SELECT website_id FROM website .* FOR SHARE/.test(sql))
            return [{ website_id: values[0] }];
          if (/SELECT repair_scope_id FROM liekan_history_repair_run/.test(sql)) return [];
          const key = `${values[0]}:${values[1]}`;
          if (/INSERT INTO liekan_collection_receipt/i.test(sql)) {
            const previous = state.locks.get(key) || Promise.resolve();
            let release!: () => void;
            const lock = new Promise<void>(resolve => {
              release = resolve;
            });
            state.locks.set(key, lock);
            await previous;
            releases.push(() => {
              release();
              if (state.locks.get(key) === lock) state.locks.delete(key);
            });
            if (state.receipts.has(key)) return [];
            receipts.set(key, { payload_hash: values[2] as string, event_id: null });
            return [{ client_event_id: values[1] }];
          }
          if (/SELECT (?:r\.)?payload_hash/i.test(sql)) {
            const receipt = receipts.get(key) || state.receipts.get(key);
            const event = state.events.find(event => event.id === receipt?.event_id);
            return receipt
              ? [{ ...receipt, session_id: event?.sessionId, visit_id: event?.visitId }]
              : [];
          }
          throw new Error('unexpected-query');
        },
        $executeRawUnsafe: async (sql: string, ...values: unknown[]) => {
          state.queries.push({ sql, values });
          if (/SET LOCAL search_path/i.test(sql)) return 0;
          if (/INSERT INTO liekan_collection_diagnostic_state/i.test(sql)) return 1;
          if (/INSERT INTO liekan_collection_diagnostic\(/i.test(sql)) {
            if (state.failAt === 'diagnostic') throw new Error('diagnostic-write-failed');
            pending.diagnostics.push(values);
            return 1;
          }
          if (/INSERT INTO liekan_event_geography/i.test(sql)) {
            if (state.failAt === 'geography') throw new Error('geography-write-failed');
            pending.geography.push(values);
            return 1;
          }
          if (/INSERT INTO liekan_event_observation/.test(sql)) {
            if (state.failAt === 'observation') throw new Error('observation-write-failed');
            const event = pending.events.find(
              event =>
                event.id === values[0] && event.websiteId === values[1] && event.eventType === 1,
            );
            if (!event) return 0;
            pending.observation.push(values);
            return 1;
          }
          if (/INSERT INTO liekan_observation_state/.test(sql)) return 1;
          if (/INSERT INTO liekan_analytics_revision/i.test(sql)) return 1;
          if (/INSERT INTO liekan_event_quality/i.test(sql)) {
            if (state.failAt === 'quality') throw new Error('quality-write-failed');
            pending.quality.push({
              eventId: values[0],
              websiteId: values[1],
              classification: values[2],
              values,
            });
            return 1;
          }
          if (/UPDATE liekan_collection_receipt/i.test(sql)) {
            if (state.failAt === 'receipt_link') throw new Error('receipt-link-failed');
            const key = `${values[1]}:${values[2]}`;
            const receipt = receipts.get(key);
            if (!receipt) throw new Error('receipt-not-in-transaction');
            receipt.event_id = values[0] as string;
            return 1;
          }
          throw new Error('unexpected-execution');
        },
      };
      try {
        const result = await work(tx);
        state.events.push(...pending.events);
        state.data.push(...pending.data);
        state.revenue.push(...pending.revenue);
        state.quality.push(...pending.quality);
        state.geography.push(...pending.geography);
        state.observation.push(...pending.observation);
        state.diagnostics.push(...pending.diagnostics);
        for (const [key, value] of receipts) state.receipts.set(key, value);
        return result;
      } catch (error) {
        state.rollbacks++;
        throw error;
      } finally {
        for (const release of releases) release();
      }
    },
  };
  return {
    default: { client },
    getRawQueryClient: (input: unknown, options: unknown) => {
      state.primaryOptions.push(options);
      return input;
    },
    getSchema: () => state.schema,
  };
});
vi.mock('@/lib/clickhouse', () => ({ default: { insert: vi.fn(), getUTCString: vi.fn() } }));
vi.mock('@/lib/kafka', () => ({ default: { enabled: false } }));

import prisma from '@/lib/prisma';
import { saveEvent } from '@/queries/sql/events/saveEvent';
import type { CollectionQuality } from './collection-quality';
import {
  CollectionConflictError,
  collectionWriteClient,
  recordEventQuality,
  withCollectionWrite,
} from './collection-write';

const websiteId = '11111111-1111-4111-8111-111111111111';
const otherWebsiteId = '22222222-2222-4222-8222-222222222222';
const eventId = '33333333-3333-4333-8333-333333333333';
const quality: CollectionQuality = {
  classification: 'browser',
  source: 'browser',
  reasons: ['browser_compatible'],
  ruleVersion: 'traffic-quality-v1',
  rangeVersion: null,
  rangeStatus: 'untrusted',
  hostname: 'example.com',
};
const args = (site = websiteId) => ({
  websiteId: site,
  sessionId: '44444444-4444-4444-8444-444444444444',
  visitId: '55555555-5555-4555-8555-555555555555',
  eventType: 2,
  urlPath: '/purchase',
  eventName: 'purchase',
  eventData: { revenue: 10, currency: 'USD', product: 'fixture' },
});
const collection = (changes: Partial<Parameters<typeof withCollectionWrite>[0]> = {}) => ({
  websiteId,
  eventId,
  fingerprint: 'opaque-fixture-hash',
  quality,
  ...changes,
});

beforeEach(() => {
  state.receipts.clear();
  state.locks.clear();
  state.events = [];
  state.data = [];
  state.revenue = [];
  state.quality = [];
  state.geography = [];
  state.observation = [];
  state.diagnostics = [];
  state.queries = [];
  state.primaryOptions = [];
  state.transactions = 0;
  state.rollbacks = 0;
  state.failAt = '';
  state.schema = 'collection_fixture';
  vi.stubEnv('DATABASE_URL', 'postgresql://fixture@127.0.0.1/fixture');
  vi.stubEnv('CLICKHOUSE_URL', '');
});

describe('atomic collection writes', () => {
  it('uses the original client when collection context is absent', async () => {
    expect(collectionWriteClient()).toBe(prisma.client);
    await saveEvent(args());
    expect(state.events).toHaveLength(1);
    expect(state.data.length).toBeGreaterThan(0);
    expect(state.revenue).toHaveLength(1);
    expect(state.quality).toHaveLength(0);
    expect(state.transactions).toBe(0);
  });

  it('commits event, properties, revenue, evidence and receipt on the primary transaction', async () => {
    const result = await withCollectionWrite(collection(), async () => {
      expect(collectionWriteClient()).not.toBe(prisma.client);
      await saveEvent(args());
      expect(state.events).toHaveLength(0);
      return 'saved';
    });
    expect(result).toEqual({ status: 'written', value: 'saved' });
    expect(state.events).toHaveLength(1);
    expect(state.data.length).toBeGreaterThan(0);
    expect(state.revenue).toHaveLength(1);
    expect(state.quality).toHaveLength(1);
    const savedId = state.events[0].id;
    expect(state.quality[0]).toMatchObject({ eventId: savedId, websiteId });
    expect(state.receipts.get(`${websiteId}:${eventId}`)).toEqual({
      payload_hash: 'opaque-fixture-hash',
      event_id: savedId,
    });
    expect(state.primaryOptions).toEqual([{ write: true }]);
    expect(state.queries[0]).toEqual({
      sql: 'SET LOCAL search_path TO "collection_fixture"',
      values: [],
    });
    expect(state.quality[0].values).toEqual([
      savedId,
      websiteId,
      quality.classification,
      quality.source,
      quality.reasons,
      quality.ruleVersion,
      quality.rangeVersion,
      quality.rangeStatus,
      quality.hostname,
      quality.catalogVersion ?? null,
      null,
    ]);
    expect(collectionWriteClient()).toBe(prisma.client);
  });

  it('allows exactly one callback for concurrent identical retries', async () => {
    const work = vi.fn(async () => {
      await saveEvent(args());
    });
    const results = await Promise.all([
      withCollectionWrite(collection(), work),
      withCollectionWrite(collection(), work),
    ]);
    expect(results.map(result => result.status).sort()).toEqual(['duplicate', 'written']);
    expect(work).toHaveBeenCalledTimes(1);
    expect(state.events).toHaveLength(1);
    expect(state.revenue).toHaveLength(1);
    expect(state.quality).toHaveLength(1);
  });

  it('keeps the stored event identity when a duplicate is acknowledged', async () => {
    await withCollectionWrite(collection(), () => saveEvent(args()));
    const retry = vi.fn(() =>
      saveEvent({ ...args(), sessionId: otherWebsiteId, visitId: eventId }),
    );
    expect(await withCollectionWrite(collection(), retry)).toEqual({
      status: 'duplicate',
      sessionId: args().sessionId,
      visitId: args().visitId,
    });
    expect(retry).not.toHaveBeenCalled();
  });

  it('rejects a duplicate whose original event identity is unavailable', async () => {
    state.receipts.set(`${websiteId}:${eventId}`, {
      payload_hash: 'opaque-fixture-hash',
      event_id: null,
    });
    await expect(withCollectionWrite(collection(), () => saveEvent(args()))).rejects.toThrow(
      'Collection receipt is unavailable',
    );
    expect(state.events).toHaveLength(0);
  });

  it('rejects a reused ID with a different payload without repeating writes', async () => {
    await withCollectionWrite(collection(), () => saveEvent(args()));
    const work = vi.fn(() => saveEvent(args()));
    await expect(
      withCollectionWrite(collection({ fingerprint: 'different-hash' }), work),
    ).rejects.toBeInstanceOf(CollectionConflictError);
    expect(work).not.toHaveBeenCalled();
    expect(state.events).toHaveLength(1);
    expect(state.receipts.get(`${websiteId}:${eventId}`)?.payload_hash).toBe('opaque-fixture-hash');
  });

  it('scopes client event IDs to their website', async () => {
    await withCollectionWrite(collection(), () => saveEvent(args()));
    await withCollectionWrite(collection({ websiteId: otherWebsiteId }), () =>
      saveEvent(args(otherWebsiteId)),
    );
    expect(state.events).toHaveLength(2);
    expect(state.receipts.size).toBe(2);
  });

  it.each(['event', 'data', 'revenue', 'quality', 'receipt_link', 'diagnostic'])(
    'rolls back all writes on %s failure and permits retry',
    async failure => {
      state.failAt = failure;
      await expect(withCollectionWrite(collection(), () => saveEvent(args()))).rejects.toThrow();
      expect(state.events).toHaveLength(0);
      expect(state.data).toHaveLength(0);
      expect(state.revenue).toHaveLength(0);
      expect(state.quality).toHaveLength(0);
      expect(state.receipts.size).toBe(0);
      expect(collectionWriteClient()).toBe(prisma.client);
      state.failAt = '';
      expect((await withCollectionWrite(collection(), () => saveEvent(args()))).status).toBe(
        'written',
      );
      expect(state.events).toHaveLength(1);
      expect(state.quality).toHaveLength(1);
    },
  );

  it('links a receipt even when quality metadata is absent', async () => {
    await withCollectionWrite(collection({ quality: undefined }), () => saveEvent(args()));
    expect(state.receipts.get(`${websiteId}:${eventId}`)?.event_id).toBe(state.events[0].id);
    expect(state.quality).toHaveLength(0);
  });

  it('preserves legacy events without IDs and still attaches atomic quality evidence', async () => {
    await withCollectionWrite(collection({ eventId: undefined }), () => saveEvent(args()));
    await withCollectionWrite(collection({ eventId: undefined }), () => saveEvent(args()));
    expect(state.events).toHaveLength(2);
    expect(state.quality).toHaveLength(2);
    expect(state.receipts.size).toBe(0);
  });

  it('isolates active clients and quality between overlapping requests', async () => {
    let started!: () => void;
    let release!: () => void;
    const firstStarted = new Promise<void>(resolve => {
      started = resolve;
    });
    const firstReleased = new Promise<void>(resolve => {
      release = resolve;
    });
    let firstClient: unknown;
    const first = withCollectionWrite(collection({ eventId: undefined }), async () => {
      firstClient = collectionWriteClient();
      started();
      await firstReleased;
      expect(collectionWriteClient()).toBe(firstClient);
      await saveEvent(args());
    });
    await firstStarted;
    await withCollectionWrite(
      collection({
        websiteId: otherWebsiteId,
        eventId: undefined,
        quality: { ...quality, classification: 'suspected' },
      }),
      async () => {
        expect(collectionWriteClient()).not.toBe(firstClient);
        await saveEvent(args(otherWebsiteId));
      },
    );
    release();
    await first;
    expect(state.quality.map(row => [row.websiteId, row.classification])).toEqual([
      [otherWebsiteId, 'suspected'],
      [websiteId, 'browser'],
    ]);
    expect(collectionWriteClient()).toBe(prisma.client);
  });

  it('rejects cross-website evidence and clears the transaction context', async () => {
    await expect(
      withCollectionWrite(collection(), () =>
        recordEventQuality(collectionWriteClient(), eventId, otherWebsiteId),
      ),
    ).rejects.toThrow('Collection context does not match event');
    expect(state.receipts.size).toBe(0);
    expect(state.quality).toHaveLength(0);
    expect(collectionWriteClient()).toBe(prisma.client);
  });

  it('rejects invalid schema identifiers before opening a transaction', async () => {
    state.schema = 'public"; malicious';
    const callback = vi.fn(async () => 'saved');
    await expect(withCollectionWrite(collection(), callback)).rejects.toThrow(
      'Invalid collection database schema',
    );
    expect(callback).not.toHaveBeenCalled();
    expect(state.transactions).toBe(0);
  });
});

it('records committed attempts and UUID coverage without counting rejected conflicts', async () => {
  await withCollectionWrite(collection(), () => saveEvent(args()));
  await Promise.all(
    Array.from({ length: 8 }, () => withCollectionWrite(collection(), () => saveEvent(args()))),
  );
  await withCollectionWrite(collection({ eventId: undefined }), () => saveEvent(args()));
  await expect(
    withCollectionWrite(collection({ fingerprint: 'changed' }), () => saveEvent(args())),
  ).rejects.toThrow();
  expect(state.diagnostics).toHaveLength(10);
  expect(state.diagnostics.reduce((n, r) => n + Number(r[2]), 0)).toBe(2);
  expect(state.diagnostics.reduce((n, r) => n + Number(r[3]), 0)).toBe(1);
  expect(state.diagnostics.reduce((n, r) => n + Number(r[4]), 0)).toBe(8);
  expect(state.diagnostics.every(r => Number(r[1]) >= 0 && Number(r[1]) < 32)).toBe(true);
});

it('geography failure rolls back event, properties, revenue and UUID receipt together', async () => {
  const geography: any = {
    location: { country: 'CN', region: 'CN-44', city: '广州' },
    source: 'mmdb',
    trust: 'trusted_ingress',
    ipFamily: 'ipv4',
    precision: 'city',
    reason: 'city_present',
    ruleVersion: 'g1',
    dataVersion: 'd1',
    cityId: '1',
    accuracyRadius: 20,
    countryBasis: 'located',
    processedAt: '2026-10-14T00:00:00Z',
    shadow: null,
  };
  state.failAt = 'geography';
  await expect(
    withCollectionWrite(collection({ geography }), () => saveEvent(args())),
  ).rejects.toThrow('geography-write-failed');
  expect(state.events).toHaveLength(0);
  expect(state.data).toHaveLength(0);
  expect(state.revenue).toHaveLength(0);
  expect(state.receipts.size).toBe(0);
  state.failAt = '';
  await withCollectionWrite(collection({ geography }), () => saveEvent(args()));
  await withCollectionWrite(collection({ geography }), () => saveEvent(args()));
  expect(state.geography).toHaveLength(1);
  expect(state.events).toHaveLength(1);
  expect(JSON.stringify(state.geography)).not.toContain('userAgent');
});

it.each(['event', 'data', 'revenue', 'quality', 'observation', 'receipt_link', 'diagnostic'])(
  'B-02 rolls all artifacts back at %s with observations enabled',
  async failure => {
    const observation = {
      version: 'browser-observation-v1' as const,
      receivedAt: new Date().toISOString(),
      features: Object.fromEntries(
        ['accept', 'language', 'site', 'mode', 'dest'].map(key => [
          key,
          { state: 'missing', values: [] },
        ]),
      ),
    } as any;
    state.failAt = failure;
    await expect(
      withCollectionWrite(collection({ observation }), () =>
        saveEvent({ ...args(), eventType: 1, eventName: undefined }),
      ),
    ).rejects.toThrow();
    for (const entries of [
      state.events,
      state.data,
      state.revenue,
      state.quality,
      state.observation,
    ])
      expect(entries).toHaveLength(0);
    expect(state.receipts.size).toBe(0);
    state.failAt = '';
    await withCollectionWrite(collection({ observation }), () =>
      saveEvent({ ...args(), eventType: 1, eventName: undefined }),
    );
    expect(state.events).toHaveLength(1);
    expect(state.observation).toHaveLength(1);
  },
);
