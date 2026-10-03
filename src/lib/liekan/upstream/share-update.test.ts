import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  row: null as any,
  firstRead: null as (() => void) | null,
  releaseRead: null as Promise<void> | null,
  tail: Promise.resolve(),
  queries: [] as { sql: string; values: unknown[] }[],
}));
vi.mock('@/lib/prisma', () => {
  const share = {
    findUnique: async () => {
      const snapshot = structuredClone(state.row);
      if (state.firstRead) {
        const announce = state.firstRead;
        state.firstRead = null;
        announce();
        await state.releaseRead;
      }
      return snapshot;
    },
    update: async ({ data }: any) => {
      state.row = { ...state.row, ...data };
      return structuredClone(state.row);
    },
  };
  const client = {
    share,
    $transaction: async (run: any) => {
      const previous = state.tail;
      let release!: () => void;
      state.tail = new Promise<void>(resolve => {
        release = resolve;
      });
      await previous;
      try {
        return await run({
          share,
          $queryRawUnsafe: async (sql: string, ...values: unknown[]) => {
            state.queries.push({ sql, values });
            return [{ share_id: state.row.id }];
          },
        });
      } finally {
        release();
      }
    },
  };
  return {
    default: { client },
    getRawQueryClient: (input: any, options: any) => {
      expect(options).toEqual({ write: true });
      return input;
    },
    getSchema: () => 'tenant"quoted',
  };
});

import { updateShare } from '@/queries/prisma/share';
import { hasSharePassword, secureShareParameters, verifySharePassword } from './share-security';

beforeEach(() => {
  state.row = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Share',
    parameters: secureShareParameters({ overview: true, password: 'old-fixture' }),
  };
  state.firstRead = null;
  state.releaseRead = null;
  state.tail = Promise.resolve();
  state.queries = [];
});

describe('atomic managed-share password updates', () => {
  it.each(['new-fixture', null])(
    'a concurrent metadata edit cannot restore an old password after %s',
    async password => {
      let announce!: () => void;
      const readStarted = new Promise<void>(resolve => {
        announce = resolve;
      });
      let release!: () => void;
      state.releaseRead = new Promise<void>(resolve => {
        release = resolve;
      });
      state.firstRead = announce;
      const metadata = updateShare(state.row.id, {
        name: 'Renamed',
        parameters: { overview: true },
      });
      await readStarted;
      const rotation = updateShare(state.row.id, { parameters: { overview: true, password } });
      // Let the competing request finish its read/write on the old implementation.
      for (let i = 0; i < 12; i++) await Promise.resolve();
      release();
      const results = await Promise.all([metadata, rotation]);
      expect(verifySharePassword('old-fixture', state.row.parameters)).toBe(password === null);
      expect(hasSharePassword(state.row.parameters)).toBe(password !== null);
      if (password) expect(verifySharePassword(password, state.row.parameters)).toBe(true);
      for (const result of results) {
        expect(result.parameters).not.toHaveProperty('password');
        expect(result.parameters).not.toHaveProperty('passwordHash');
      }
    },
  );

  it('locks the configured schema row on the primary before merging parameters', async () => {
    await updateShare(state.row.id, { parameters: { overview: false } });
    expect(state.queries).toHaveLength(1);
    expect(state.queries[0]).toEqual({
      sql: 'SELECT share_id FROM "tenant""quoted"."share" WHERE share_id = $1::uuid FOR UPDATE',
      values: [state.row.id],
    });
    expect(verifySharePassword('old-fixture', state.row.parameters)).toBe(true);
  });
});
