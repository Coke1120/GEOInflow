// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ lock: vi.fn(), ai: vi.fn(), history: vi.fn(), invalidate: vi.fn() }));
vi.mock('./server', () => ({ lockWritableWebsite: h.lock }));
vi.mock('./ai-lifecycle', () => ({ clearAiWebsiteInTransaction: h.ai }));
vi.mock('./history-repair-lifecycle', () => ({
  clearHistoryRepair: h.history,
  invalidateHistoryRepair: h.invalidate,
}));
import { resetLiekanStatistics, stopWebsiteSources } from './lifecycle';
const site = '11111111-1111-4111-8111-111111111111';
beforeEach(() => {
  vi.clearAllMocks();
  h.lock.mockResolvedValue(undefined);
});
function transaction() {
  const calls: Array<[string, ...unknown[]]> = [];
  const run = async (sql: string, ...params: unknown[]) => {
    calls.push([sql, ...params]);
    return 1;
  };
  return { calls, $executeRawUnsafe: vi.fn(run), $queryRawUnsafe: vi.fn(run) };
}
it('fences old GEO publication before resetting input and frees current-day capacity', async () => {
  const tx = transaction();
  await resetLiekanStatistics(tx, site);
  const head = tx.calls.findIndex(([sql]) => sql.startsWith('DELETE FROM liekan_geo_weight_head'));
  const snapshot = tx.calls.findIndex(([sql]) =>
    sql.startsWith('DELETE FROM liekan_geo_weight_snapshot'),
  );
  const logs = tx.calls.findIndex(([sql]) => sql.startsWith('DELETE FROM liekan_log WHERE'));
  expect(head).toBeGreaterThan(0);
  expect(snapshot).toBeGreaterThan(head);
  expect(logs).toBeGreaterThan(snapshot);
  for (const [sql, id] of tx.calls.filter(([sql]) => sql.includes('liekan_geo_weight_'))) {
    expect(sql).toContain('WHERE website_id=$1::uuid');
    expect(id).toBe(site);
  }
  expect(tx.calls.at(-1)?.[0]).toContain('DELETE FROM liekan_geo_weight_evidence_revision');
});
it('deletion frees snapshots while a source pause retains published result history', async () => {
  const paused = transaction();
  await stopWebsiteSources(paused, site);
  expect(paused.calls.some(([sql]) => sql.includes('liekan_geo_weight_'))).toBe(false);
  const deleted = transaction();
  await stopWebsiteSources(deleted, site, true);
  expect(deleted.calls.filter(([sql]) => sql.includes('liekan_geo_weight_'))).toHaveLength(3);
});
it('does not change GEO state when the website write boundary rejects the operation', async () => {
  const tx = transaction();
  h.lock.mockRejectedValue(new Error('denied'));
  await expect(resetLiekanStatistics(tx, site)).rejects.toThrow('denied');
  expect(tx.calls.some(([sql]) => sql.includes('liekan_geo_weight_'))).toBe(false);
});
