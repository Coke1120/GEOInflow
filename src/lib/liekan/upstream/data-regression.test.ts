import { describe, expect, it, vi } from 'vitest';
import {
  createDataAdapters,
  readonlyFixtureSQL,
} from '../../../../scripts/liekan-data-regression.mjs';

describe('read-only data regression runner', () => {
  it('loads the real population contract when the storage reader is isolated', async () => {
    const adapters = createDataAdapters(async () => []);
    const facts = await adapters.analytics.getHumanFacts(
      '11111111-1111-4111-8111-111111111111',
      new Date('2026-10-01T00:00:00Z'),
      new Date('2026-10-02T23:59:59Z'),
      'UTC',
    );
    expect(facts.totals).toMatchObject({ pageviews: 3, visitors: 2 });
    expect(facts.daily).toEqual([]);
  });
  it('captures the live adapter query and bound range without requiring a database for unit tests', async () => {
    const execute = vi.fn(async () => [
      { day: '2026-10-02', pv: 1, uv: 1, sessions: 1, bounces: 1 },
    ]);
    const adapters = createDataAdapters(execute);
    const start = new Date('2026-10-01T00:00:00+08:00'),
      end = new Date('2026-10-02T23:59:59+08:00');
    const result = await adapters.analytics.getHumanDays(
      '11111111-1111-4111-8111-111111111111',
      start,
      end,
      'Asia/Shanghai',
      true,
    );
    expect(result.rows).toEqual([{ day: '2026-10-02', pv: 1, uv: 1, sessions: 1, bounces: 1 }]);
    const [sql, ...params] = execute.mock.calls[0] as unknown as [string, ...unknown[]];
    expect(params).toEqual(['11111111-1111-4111-8111-111111111111', start, end, 'Asia/Shanghai']);
    const replay = readonlyFixtureSQL(sql, params);
    expect(replay).toMatch(/^BEGIN READ ONLY;/);
    expect(replay.trim()).toMatch(/ROLLBACK;$/);
    expect(replay).toContain('PREPARE liekan_data_case AS');
    expect(replay).toContain(sql.trim().slice(5));
    expect(adapters.sourceHash()).toMatch(/^[a-f0-9]{64}$/);
  });
  it('isolates effective log reads in the synthetic fixture', () => {
    const replay = readonlyFixtureSQL('SELECT count(*) FROM liekan_effective_log', []);
    expect(replay).toContain('liekan_effective_log AS (SELECT * FROM liekan_log)');
  });
  it('rejects mutations before preparing a fixture and binds literal values safely', () => {
    expect(() => readonlyFixtureSQL('DELETE FROM liekan_log', [])).toThrow('read queries only');
    const replay = readonlyFixtureSQL('SELECT $1::text AS value', ["author's value"]);
    expect(replay).toContain("EXECUTE liekan_data_case('author''s value')");
    expect(replay).toMatch(/^BEGIN READ ONLY;/);
  });
});
