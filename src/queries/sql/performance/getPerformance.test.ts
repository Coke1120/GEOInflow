import { beforeEach, describe, expect, test, vi } from 'vitest';
import { getPerformance } from './getPerformance';
import { getPerformanceChart } from './getPerformanceChart';
import { getPerformanceMetrics } from './getPerformanceMetrics';
import { getPerformanceStats } from './getPerformanceStats';

const mocks = vi.hoisted(() => ({
  backend: 'prisma',
  rawQuery: vi.fn(),
  parseFilters: vi.fn(() => ({
    queryParams: {},
    filterQuery: 'and filtered',
    cohortQuery: '',
    joinSessionQuery: '',
    excludeBounceQuery: '',
  })),
}));
vi.mock('@/lib/db', () => ({
  PRISMA: 'prisma',
  CLICKHOUSE: 'clickhouse',
  runQuery: (queries: any) => queries[mocks.backend](),
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    rawQuery: mocks.rawQuery,
    parseFilters: mocks.parseFilters,
    getDateSQL: () => 'bucket',
  },
}));
vi.mock('@/lib/clickhouse', () => ({
  default: {
    rawQuery: mocks.rawQuery,
    parseFilters: mocks.parseFilters,
    getDateSQL: () => 'bucket',
  },
}));
const parameters = {
  startDate: new Date(1000),
  endDate: new Date(2000),
  unit: 'day',
  timezone: 'UTC',
  metric: 'inp',
};

describe.each(['prisma', 'clickhouse'])('%s performance datasets', backend => {
  beforeEach(() => {
    mocks.backend = backend;
    mocks.rawQuery.mockReset().mockResolvedValue([]);
    mocks.parseFilters.mockReset().mockReturnValue({
      queryParams: {},
      filterQuery: 'and filtered',
      cohortQuery: '',
      joinSessionQuery: '',
      excludeBounceQuery: '',
    });
  });
  test('chart executes only the selected metric time series', async () => {
    expect(await getPerformanceChart('website', parameters, {})).toEqual({ chart: [] });
    expect(mocks.rawQuery).toHaveBeenCalledTimes(1);
    const sql = mocks.rawQuery.mock.calls[0][0];
    expect(sql).toContain('inp');
    expect(sql).toContain('group by t');
    expect(sql).not.toContain('lcp_p50');
    expect(sql).toContain('and filtered');
  });
  test('stats executes only the summary and preserves empty-result defaults', async () => {
    const stats = await getPerformanceStats('website', parameters, {});
    expect(stats.count).toBe(0);
    expect(stats.lcp).toEqual({ p50: 0, p75: 0, p95: 0 });
    expect(mocks.rawQuery).toHaveBeenCalledTimes(1);
    expect(mocks.rawQuery.mock.calls[0][0]).not.toContain('group by t');
  });
  test('legacy composition preserves the chart and summary shape', async () => {
    const result = await getPerformance('website', parameters, {});
    expect(mocks.rawQuery).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ chart: [], summary: { count: 0 } });
  });
  test('grouped sample count excludes rows without the selected metric', async () => {
    await getPerformanceMetrics('website', parameters, {}, 'url_path');
    const sql = mocks.rawQuery.mock.calls[0][0];
    expect(sql).toContain(
      backend === 'prisma' ? 'count(inp) as count' : 'countIf(inp IS NOT NULL) as count',
    );
    expect(sql).toContain('group by url_path');
  });
  test.each(['chart', 'stats', 'metrics'])(
    '%s applies bounce exclusion with the other supported filters',
    async kind => {
      mocks.parseFilters.mockReturnValue({
        queryParams: { websiteId: 'website', country: ['CN'] },
        filterQuery: 'and dimension_filter and event_property_filter and session_property_filter',
        cohortQuery: 'join selected_cohort',
        joinSessionQuery: 'join filtered_session',
        excludeBounceQuery: 'join excludeBounce',
      });
      const filters = { excludeBounce: true, country: 'eq.CN' };
      if (kind === 'chart') await getPerformanceChart('website', parameters, filters);
      else if (kind === 'stats') await getPerformanceStats('website', parameters, filters);
      else await getPerformanceMetrics('website', parameters, filters, 'url_path');
      const [sql, params] = mocks.rawQuery.mock.calls[0];
      expect(sql).toContain('join excludeBounce');
      expect(sql).toContain('join selected_cohort');
      expect(sql).toContain(
        'dimension_filter and event_property_filter and session_property_filter',
      );
      if (backend === 'prisma') expect(sql).toContain('join filtered_session');
      expect(params).toMatchObject({
        websiteId: 'website',
        country: ['CN'],
        startDate: parameters.startDate,
        endDate: parameters.endDate,
      });
      expect(mocks.parseFilters).toHaveBeenCalledWith(
        expect.objectContaining({ ...filters, websiteId: 'website' }),
        ...(kind === 'metrics' && backend === 'prisma' ? [{ joinSession: false }] : []),
      );
    },
  );
});
