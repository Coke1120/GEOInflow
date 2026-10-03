import { Decimal } from '@prisma/client/runtime/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { featureAnalytics } from './feature-analytics';

const mocks = vi.hoisted(() => ({ rawQuery: vi.fn(), getQueryFilters: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: {
    rawQuery: mocks.rawQuery,
    parseFilters: (filters: any) => ({
      filterQuery: '',
      joinSessionQuery: '',
      cohortQuery: '',
      excludeBounceQuery: '',
      queryParams: {
        websiteId: filters.websiteId,
        startDate: new Date(1000),
        endDate: new Date(2000),
      },
    }),
    getDateSQL: (column: string) => `to_char(${column},'YYYY-MM-DD')`,
  },
}));
vi.mock('@/lib/request', () => ({ getQueryFilters: mocks.getQueryFilters }));
vi.mock('@/queries/prisma', () => ({ getWebsiteSegment: vi.fn(), getReport: vi.fn() }));
vi.mock('@/permissions', () => ({ canViewReport: vi.fn() }));
vi.mock('./server', () => ({ LiekanError: class extends Error {} }));
vi.mock('./analytics', () => ({ classifyEntrySource: vi.fn() }));
vi.mock('@/queries/sql/heatmap/getHeatmap', () => ({ getRelationalHeatmapFilterContext: vi.fn() }));

const websiteId = '11111111-1111-4111-8111-111111111111';
const common = { startAt: 1000, endAt: 2000, timezone: 'UTC' };
const association = {
  attributionStep: 'purchase',
  attributionModel: 'first-click',
  attributionType: 'event',
  attributionSource: 'google.com',
};

beforeEach(() => {
  delete process.env.CLICKHOUSE_URL;
  mocks.getQueryFilters.mockImplementation((input: any) => input);
  mocks.rawQuery.mockReset().mockResolvedValue([{ count: 0n, visitors: 0n, attributed: 0n }]);
});

describe('composed analytics membership', () => {
  it('uses unique CTE names and independent parameters for nested attribution', async () => {
    await featureAnalytics(websiteId, {
      ...common,
      ...association,
      kind: 'attribution',
      model: 'last-click',
      type: 'path',
      step: '/paid',
    });
    const [sql, params] = mocks.rawQuery.mock.calls[0];
    const names = [...sql.matchAll(/\b([a-z_]+)\s+AS\s*\(/gi)].map(match => match[1]);
    expect(new Set(names).size).toBe(names.length);
    expect(sql).toContain('selected AS');
    expect(Object.values(params)).toContain('purchase');
    expect(Object.values(params)).toContain('/paid');
    expect(Object.values(params)).toContain('google.com');
  });

  it('applies retention membership before attribution association without undefined CTEs', async () => {
    await featureAnalytics(websiteId, {
      ...common,
      ...association,
      kind: 'sessions',
      retentionDate: '1970-01-01',
      retentionDay: 1,
    });
    const [sql] = mocks.rawQuery.mock.calls[0];
    const names = [...sql.matchAll(/\b([a-z_]+)\s+AS\s*\(/gi)].map(match => match[1]);
    expect(new Set(names).size).toBe(names.length);
    expect(sql).toContain('cohort_events AS');
    expect(sql).toContain('returned');
    expect(sql).not.toMatch(/FROM base_selected\b/);
  });
});

describe('native numeric response normalization', () => {
  it('preserves the exact decimal representation of transaction amounts', async () => {
    mocks.rawQuery.mockImplementation(async (sql: string) =>
      sql.includes('SELECT COUNT(*) AS count FROM transactions')
        ? [{ count: 1n }]
        : [{ amount: new Decimal('9007199254740993.01'), currency: 'USD' }],
    );
    const data = await featureAnalytics(websiteId, { ...common, kind: 'revenue', currency: 'USD' });
    expect(data).toMatchObject({ rows: [{ amount: '9007199254740993.01', currency: 'USD' }] });
  });
  it('normalizes decimals before JSON serialization while preserving dates, text and null', async () => {
    mocks.rawQuery.mockImplementation(async (sql: string) =>
      sql.includes('COUNT(DISTINCT session_id) AS count')
        ? [{ count: 1n }]
        : [
            {
              id: websiteId,
              seconds: new Decimal('12.75'),
              firstAt: new Date(1000),
              lastAt: null,
              urlPath: '/12.75',
              views: 3n,
              referrerDomain: '0012.75',
            },
          ],
    );
    const data = await featureAnalytics(websiteId, { ...common, kind: 'sessions' });
    expect(data).toMatchObject({
      count: 1,
      rows: [
        {
          seconds: 12.75,
          views: 3,
          firstAt: '1970-01-01T00:00:01.000Z',
          lastAt: null,
          urlPath: '/12.75',
          referrerDomain: '0012.75',
        },
      ],
    });
  });
});
