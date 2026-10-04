// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ transaction: vi.fn(), permission: vi.fn(), stop: vi.fn(), invalidate: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: { client: { $transaction: h.transaction } },
  getRawQueryClient: (client: unknown) => client,
}));
vi.mock('./lifecycle', () => ({ stopWebsiteSources: h.stop }));
vi.mock('./query-cache', () => ({ invalidateWebsiteAnalytics: h.invalidate }));
vi.mock('@/lib/auth', () => ({ hasPermission: h.permission }));
import { transferWebsiteWithAi } from './ai-lifecycle';
beforeEach(() => {
  vi.stubEnv(
    'DATABASE_URL',
    'postgresql://fixture:fixture@127.0.0.1:15439/liekan_ai_acceptance?schema=ai_custom',
  );
  h.transaction.mockReset();
  h.permission.mockResolvedValue(true);
  h.stop.mockReset().mockResolvedValue(undefined);
  h.invalidate.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
it('sets the configured schema before the transfer authorization reads', async () => {
  const order: string[] = [];
  const tx = {
    $executeRawUnsafe: vi.fn(async (sql: string) => {
      order.push(sql);
      return 1;
    }),
    $queryRawUnsafe: vi.fn(async (sql: string) => {
      order.push(sql);
      if (sql.includes('to_regclass')) return [{ installed: false }];
      if (sql.includes('FROM website'))
        return [{ user_id: '11111111-1111-4111-8111-111111111111', team_id: null }];
      if (sql.includes('SELECT role')) return [{ role: 'admin' }];
      return [{ user_id: '22222222-2222-4222-8222-222222222222' }];
    }),
    website: { update: vi.fn().mockResolvedValue({ id: 'site' }) },
  };
  h.transaction.mockImplementation(async fn => fn(tx));
  await transferWebsiteWithAi(
    '11111111-1111-4111-8111-111111111111',
    { userId: '11111111-1111-4111-8111-111111111111' },
    { userId: '22222222-2222-4222-8222-222222222222', teamId: null },
  );
  expect(order[0]).toBe('SET LOCAL search_path TO "ai_custom"');
  expect(h.stop).toHaveBeenCalledWith(tx, '11111111-1111-4111-8111-111111111111');
  expect(h.stop.mock.invocationCallOrder[0]).toBeLessThan(tx.website.update.mock.invocationCallOrder[0]);
  expect(h.invalidate).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
  h.invalidate.mockClear();
  h.transaction.mockRejectedValueOnce(new Error('rollback'));
  await expect(transferWebsiteWithAi('11111111-1111-4111-8111-111111111111', { userId: '11111111-1111-4111-8111-111111111111' }, { userId: '22222222-2222-4222-8222-222222222222', teamId: null })).rejects.toThrow('rollback');
  expect(h.invalidate).not.toHaveBeenCalled();
});
