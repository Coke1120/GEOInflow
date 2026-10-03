import { beforeEach, describe, expect, test, vi } from 'vitest';
import { getRevenueChart } from './getRevenueChart';
import { getRevenueMetrics } from './getRevenueMetrics';
import { getRevenueStats } from './getRevenueStats';

const mocks = vi.hoisted(() => ({
  backend: 'prisma',
  rawQuery: vi.fn(),
  parseFilters: vi.fn(() => ({
    queryParams: {},
    filterQuery: '',
    dateQuery: 'and selected_date_range',
    cohortQuery: '',
    joinSessionQuery: '',
    excludeBounceQuery: '',
  })),
}));
vi.mock('@/lib/db', () => ({
  PRISMA: 'prisma',
  CLICKHOUSE: 'clickhouse',
  runQuery: (queries: Record<string, () => unknown>) => queries[mocks.backend](),
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
  currency: 'CNY',
};
const kinds = ['chart', 'stats', 'country', 'region', 'referrer', 'channel'] as const;

async function query(kind: (typeof kinds)[number], filters: Record<string, any>) {
  if (kind === 'chart') return getRevenueChart('website', parameters, filters);
  if (kind === 'stats') return getRevenueStats('website', parameters, filters);
  return getRevenueMetrics('website', parameters, filters, kind);
}

describe.each(['prisma', 'clickhouse'])('%s revenue filters', backend => {
  beforeEach(() => {
    mocks.backend = backend;
    mocks.rawQuery
      .mockReset()
      .mockResolvedValue([{ sum: '110.0000', count: 2, unique_count: 2, total_sessions: 2 }]);
    mocks.parseFilters.mockReset().mockReturnValue({
      queryParams: { websiteId: 'website', ...parameters },
      filterQuery: '',
      dateQuery: 'and selected_date_range',
      cohortQuery: '',
      joinSessionQuery: '',
      excludeBounceQuery: '',
    });
  });

  test.each(kinds)('%s applies bounce exclusion to the eligible sessions', async kind => {
    mocks.parseFilters.mockReturnValue({
      queryParams: { websiteId: 'website', ...parameters, country: ['CN'] },
      filterQuery: 'and dimension_filter and event_property_filter and session_property_filter',
      dateQuery: 'and selected_date_range',
      cohortQuery: 'join selected_cohort',
      joinSessionQuery: 'join filtered_session',
      excludeBounceQuery: 'join excludeBounce',
    });
    const filters = { excludeBounce: true, country: 'eq.CN' };
    await query(kind, filters);
    const [sql, params] = mocks.rawQuery.mock.calls[0];
    const eligibleSessions = sql.slice(
      sql.indexOf('filtered_sessions as'),
      sql.indexOf('filtered_revenue as') > 0
        ? sql.indexOf('filtered_revenue as')
        : sql.indexOf('events as'),
    );
    expect(eligibleSessions).toContain('join excludeBounce');
    expect(eligibleSessions).toContain('join selected_cohort');
    expect(eligibleSessions).toContain('and selected_date_range');
    expect(eligibleSessions).toContain(
      'dimension_filter and event_property_filter and session_property_filter',
    );
    if (backend === 'prisma') expect(eligibleSessions).toContain('join filtered_session');
    expect(params).toMatchObject({ websiteId: 'website', ...parameters, country: ['CN'] });
    expect(mocks.parseFilters).toHaveBeenCalledWith({
      ...filters,
      websiteId: 'website',
      startDate: parameters.startDate,
      endDate: parameters.endDate,
      currency: 'CNY',
    });
  });

  test('unfiltered stats preserve the native response and monetary total', async () => {
    expect(await getRevenueStats('website', parameters, {})).toEqual({
      sum: '110.0000',
      count: 2,
      unique_count: 2,
      total_sessions: 2,
      average: 55,
      arpu: 55,
    });
    expect(mocks.rawQuery.mock.calls[0][0]).not.toContain('excludeBounce');
  });

  test.each(['referrer', 'channel'] as const)(
    '%s selects one complete first event when timestamps tie',
    async kind => {
      await query(kind, {});
      const sql = mocks.rawQuery.mock.calls[0][0];
      expect(sql.match(/first_events as/g)).toHaveLength(1);
      if (backend === 'prisma') {
        expect(sql).toContain('distinct on (website_id, session_id)');
        expect(sql).toContain('order by website_id, session_id, created_at, event_id');
      } else {
        expect(sql).toContain('argMin(');
        expect(sql).toContain(
          'tuple(referrer_domain, url_query, utm_medium, utm_source, hostname)',
        );
        expect(sql).toContain('tuple(created_at, event_id)');
        expect(sql).toContain('sum(events.value)');
        expect(sql).not.toContain('sum(revenue.value)');
      }
      expect(sql).toContain('join first_events');
      expect(sql).not.toContain('min(created_at)');
    },
  );
});
