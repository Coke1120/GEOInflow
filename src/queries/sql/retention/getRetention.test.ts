import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRetention } from './getRetention';
const mocks = vi.hoisted(() => ({ backend: 'prisma', rawQuery: vi.fn(), parseFilters: vi.fn() }));
vi.mock('@/lib/db', () => ({
  PRISMA: 'prisma',
  CLICKHOUSE: 'clickhouse',
  runQuery: (queries: any) => queries[mocks.backend](),
}));
function adapter() {
  return {
    rawQuery: mocks.rawQuery,
    parseFilters: mocks.parseFilters,
    getDateSQL: () => 'bucket',
    getDayDiffQuery: () => 'day_number',
    getCastColumnQuery: () => 'visitors',
  };
}
vi.mock('@/lib/prisma', () => ({ default: adapter() }));
vi.mock('@/lib/clickhouse', () => ({ default: adapter() }));

describe.each(['prisma', 'clickhouse'])('%s retention cohort scope', backend => {
  beforeEach(() => {
    mocks.backend = backend;
    mocks.rawQuery.mockReset().mockResolvedValue([]);
    mocks.parseFilters.mockReturnValue({
      filterQuery: 'AND filtered',
      cohortQuery: '',
      joinSessionQuery: '',
      excludeBounceQuery:
        'JOIN non_bouncing_visits ON website_event.visit_id=non_bouncing_visits.visit_id',
      queryParams: { websiteId: 'site' },
    });
  });
  it('selects cohort visitors from non-bouncing visits and observes their subsequent activity', async () => {
    await getRetention(
      'site',
      { startDate: new Date(1000), endDate: new Date(2000) },
      { excludeBounce: true },
    );
    const [sql] = mocks.rawQuery.mock.calls[0];
    expect(sql.split('user_activities AS')[0]).toContain('JOIN non_bouncing_visits');
    expect(sql.split('user_activities AS')[1]).toContain('join cohort_items');
    expect(sql.split('user_activities AS')[1]).not.toContain('JOIN non_bouncing_visits');
  });
});
