// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ transaction: vi.fn(), query: vi.fn(), execute: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: { client: { $transaction: h.transaction } },
  getRawQueryClient: (client: unknown) => client,
}));
import { aiTransaction } from './ai-db';
beforeEach(() => {
  vi.stubEnv(
    'DATABASE_URL',
    'postgresql://fixture:fixture@127.0.0.1:1/isolated?schema=Tenant_2026',
  );
  h.transaction
    .mockClear()
    .mockImplementation(work => work({ $queryRawUnsafe: h.query, $executeRawUnsafe: h.execute }));
  h.query.mockClear().mockResolvedValue([]);
  h.execute.mockClear().mockResolvedValue(0);
});
afterEach(() => vi.unstubAllEnvs());
it('retains configured schema casing before executing queries', async () => {
  await aiTransaction(tx => tx.query('SELECT 1'));
  expect(h.execute.mock.calls[0][0]).toBe('SET LOCAL search_path TO "Tenant_2026"');
  expect(h.execute.mock.invocationCallOrder[0]).toBeLessThan(h.query.mock.invocationCallOrder[0]);
});
it.each(['tenant"; DROP TABLE session;--', 'tenant,public', 'tenant.schema'])(
  'rejects unsafe schema before starting a transaction (%s)',
  async schema => {
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set('schema', schema);
    vi.stubEnv('DATABASE_URL', url.toString());
    await expect(aiTransaction(tx => tx.query('SELECT 1'))).rejects.toMatchObject({
      code: 'database_unavailable',
      status: 503,
    });
    expect(h.transaction).not.toHaveBeenCalled();
  },
);
