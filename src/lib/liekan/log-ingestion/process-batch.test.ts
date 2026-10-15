// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  batches: new Map<string, any>(),
  sources: new Map<string, any>(),
  epochs: new Map<string, number>(),
  gates: new Map<string, Promise<void>>(),
  failures: new Set<string>(),
  entered: [] as string[],
  imports: [] as string[],
  transactions: 0,
}));
vi.mock('../upstream/server', () => ({
  LiekanError: class extends Error {},
  query: async (_sql: string, id: string) => [{ ...state.batches.get(id) }],
  sourceWebsite: async () => ({ domain: 'example.com', user_id: null, team_id: null }),
  transaction: async (work: any) => {
    state.transactions++;
    try {
      return await work({
        $queryRawUnsafe: async (sql: string, id: string) => {
          if (sql.includes('FROM liekan_log_source')) return [{ ...state.sources.get(id) }];
          if (sql.includes('FROM liekan_log_state')) return [{ epoch: state.epochs.get(id) || 1 }];
          if (sql.includes('FROM liekan_ingest_batch')) {
            state.entered.push(id);
            await state.gates.get(id);
            if (state.failures.has(id)) throw new Error('Worker fixture failure');
            return [{ ...state.batches.get(id) }];
          }
          return [];
        },
        $executeRawUnsafe: async (sql: string, id: string) => {
          if (sql.includes('INSERT INTO liekan_import')) state.imports.push(id);
          if (sql.includes("SET state='processed'")) state.batches.get(id).state = 'processed';
          if (sql.includes("SET state='cancelled'")) state.batches.get(id).state = 'cancelled';
          return 0;
        },
      });
    } finally {
      state.transactions--;
    }
  },
}));
import { processBatch } from './service';
function batch(websiteId: string) {
  const id = randomUUID(),
    sourceId = randomUUID();
  state.sources.set(sourceId, {
    id: sourceId,
    website_id: websiteId,
    domain: 'example.com',
    owner_id: null,
    team_id: null,
    state: 'active',
  });
  state.batches.set(id, {
    id,
    website_id: websiteId,
    source_id: sourceId,
    state: 'pending',
    epoch: 1,
    payload: [],
    digest: id,
    rejected: 0,
  });
  return id;
}
function hold(id: string) {
  let release!: () => void;
  state.gates.set(
    id,
    new Promise<void>(resolve => {
      release = resolve;
    }),
  );
  return release;
}
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
beforeEach(() => {
  for (const map of [state.batches, state.sources, state.epochs, state.gates]) map.clear();
  state.failures.clear();
  state.entered = [];
  state.imports = [];
  state.transactions = 0;
});
describe('same-website batch admission before database transactions', () => {
  it('queues one website in arrival order and lets another website process concurrently', async () => {
    const site = randomUUID(),
      first = batch(site),
      second = batch(site),
      other = batch(randomUUID());
    const releaseFirst = hold(first),
      releaseOther = hold(other);
    const tasks = [processBatch(first), processBatch(second), processBatch(other)];
    try {
      await settle();
      expect(state.entered).toEqual([first, other]);
      expect(state.transactions).toBe(2);
      releaseFirst();
      await settle();
      expect(state.entered).toEqual([first, other, second]);
    } finally {
      releaseFirst();
      releaseOther();
      await Promise.allSettled(tasks);
    }
    expect(state.imports).toHaveLength(3);
    expect(state.transactions).toBe(0);
  });
  it('releases failed work so queued batches and a later retry can proceed', async () => {
    const site = randomUUID(),
      first = batch(site),
      second = batch(site),
      releaseFirst = hold(first);
    state.failures.add(first);
    const tasks = [processBatch(first), processBatch(second)];
    const settled = Promise.allSettled(tasks);
    try {
      await settle();
      expect(state.entered).toEqual([first]);
    } finally {
      releaseFirst();
      await settled;
    }
    expect((await settled).map(result => result.status)).toEqual(['rejected', 'fulfilled']);
    expect(state.imports).toEqual([second]);
    state.failures.delete(first);
    await processBatch(first);
    expect(state.imports).toEqual([second, first]);
    expect(state.transactions).toBe(0);
  });
  it('rechecks the live epoch after queued work enters its original database transaction', async () => {
    const site = randomUUID(),
      first = batch(site),
      second = batch(site),
      releaseFirst = hold(first);
    const tasks = [processBatch(first), processBatch(second)];
    try {
      await settle();
      expect(state.entered).toEqual([first]);
      state.epochs.set(site, 2);
    } finally {
      releaseFirst();
      await Promise.allSettled(tasks);
    }
    expect(state.batches.get(second).state).toBe('cancelled');
    expect(state.imports).toEqual([first]);
  });
});
