// @vitest-environment node
import { beforeEach, it, expect, vi } from 'vitest';
const state = vi.hoisted(() => ({
  sites: ['blocked', 'healthy'],
  blocked: true,
  fail: false,
  epoch: '1',
  advanced: false,
  initFailure: false,
  queries: [] as any[],
  writes: [] as any[],
}));
vi.mock('./server', () => ({
  transaction: async (work: any) =>
    work({
      $executeRawUnsafe: async (sql: string, ...values: any[]) => {
        state.writes.push({ sql, values });
        if (sql.includes('WITH candidates AS MATERIALIZED') && state.initFailure)
          throw new Error('concurrent init');
        return 1;
      },
      $queryRawUnsafe: async (sql: string, ...values: any[]) => {
        state.queries.push({ sql, values });
        if (sql.includes('SELECT s.website_id')) {
          const site = state.sites.find(s => !values[0].includes(s));
          return site ? [{ website_id: site }] : [];
        }
        if (sql.includes('FOR SHARE SKIP LOCKED'))
          return values[0] === 'blocked' && state.blocked ? [] : [{ website_id: values[0] }];
        if (sql.includes('SELECT * FROM liekan_browser_risk_state')) {
          expect(sql).toContain("next_window<=date_trunc('minute',now())-interval '2 minutes'");
          expect(sql).toContain('next_attempt_at<=now()');
          return state.advanced ? [] : [{ epoch: 1, next_window: new Date(Date.now() - 180000) }];
        }
        if (sql.includes('SELECT epoch::text')) return [{ epoch: state.epoch }];
        if (sql.includes('SELECT e.session_id')) {
          if (values[0] === 'blocked' && state.fail) throw new Error('timeout');
          return Array.from({ length: 31 }, (_, i) => ({
            session_id: 'session',
            visit_id: 'visit',
            url_path: '/same',
            observed_at: new Date(Date.now() - 300000 + i * 2000),
          }));
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    }),
}));
vi.mock('./traffic-quality', () => ({ parseQualityRange: vi.fn(), qualityTotals: vi.fn() }));
import { processBrowserRisk } from './browser-risk';
beforeEach(() => {
  vi.stubEnv('CLICKHOUSE_URL', '');
  state.sites = ['blocked', 'healthy'];
  state.blocked = true;
  state.fail = false;
  state.epoch = '1';
  state.advanced = false;
  state.initFailure = false;
  state.queries = [];
  state.writes = [];
});
it('skips a website lock and still computes another website and retention', async () => {
  await processBrowserRisk();
  expect(
    state.writes.some(
      w => w.sql.includes('INSERT INTO liekan_browser_risk_window') && w.values[0] === 'healthy',
    ),
  ).toBe(true);
  expect(state.writes.filter(w => w.sql.includes('WHERE ctid IN'))).toHaveLength(2);
  expect(
    state.writes.some(
      w => w.sql.includes('INSERT INTO liekan_browser_risk_window') && w.values[0] === 'blocked',
    ),
  ).toBe(false);
});
it('isolates a failing site with backoff and makes progress on healthy sites', async () => {
  state.blocked = false;
  state.fail = true;
  await processBrowserRisk();
  expect(
    state.writes.some(
      w => w.sql.includes("error_code='analysis-unavailable'") && w.values[0] === 'blocked',
    ),
  ).toBe(true);
  expect(
    state.writes.some(
      w => w.sql.includes('INSERT INTO liekan_browser_risk_window') && w.values[0] === 'healthy',
    ),
  ).toBe(true);
  expect(state.writes.filter(w => w.sql.includes('WHERE ctid IN'))).toHaveLength(2);
});
it('rejects stale epoch results after a reset', async () => {
  state.blocked = false;
  state.epoch = '2';
  await processBrowserRisk();
  expect(
    state.writes.filter(w => w.sql.includes('DELETE FROM liekan_browser_risk_state')),
  ).toHaveLength(2);
  expect(state.writes.some(w => w.sql.includes('INSERT INTO liekan_browser_risk_window'))).toBe(
    false,
  );
});
it('leaves upstream ClickHouse flow untouched', async () => {
  vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.fixture');
  await processBrowserRisk();
  expect(state.queries).toEqual([]);
  expect(state.writes).toEqual([]);
});

it('does not compute a window advanced past the delay by another worker', async () => {
  state.advanced = true;
  await processBrowserRisk();
  expect(state.writes.some(w => w.sql.includes('INSERT INTO liekan_browser_risk_window'))).toBe(
    false,
  );
});
it('keeps existing sites progressing when bounded initialization retries', async () => {
  state.initFailure = true;
  await processBrowserRisk();
  expect(
    state.writes.some(
      w => w.sql.includes('INSERT INTO liekan_browser_risk_window') && w.values[0] === 'healthy',
    ),
  ).toBe(true);
  const initialization = state.writes.find(w => w.sql.includes('WITH candidates AS MATERIALIZED'));
  expect(initialization.sql).toContain('LIMIT 10 FOR SHARE OF w SKIP LOCKED');
});
