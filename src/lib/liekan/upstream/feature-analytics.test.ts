const identityFixture = vi.hoisted(() => ({ status: 'complete' }));
vi.mock('./native-snapshot', () => ({ nativeSnapshot: (work: () => unknown) => work() }));
vi.mock('./browser-population', async importOriginal => {
  const actual = await importOriginal<typeof import('./browser-population')>();
  return {
    ...actual,
    readBrowserPopulation: async (_id: string, start: Date, end: Date, timezone: string) =>
      actual.populationFromRow(
        {
          resourceKind: 'website',
          eligibleEvents: 5,
          qualifiedEvents:
            identityFixture.status === 'complete'
              ? 5
              : identityFixture.status === 'partial'
                ? 2
                : 0,
          eligiblePV: 5,
          qualifiedPV: 5,
          qualifiedVisitors: 2,
        },
        { startAt: +start, endAt: +end, timezone },
      ),
  };
});
import { Decimal } from '@prisma/client/runtime/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { featureAnalytics, featureJourney } from './feature-analytics';
import { classifyEntrySource } from './analytics';
import { classifyEntrySource as originalClassifier } from '../contracts/sources';

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
  identityFixture.status = 'complete';
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
  it('keeps realtime generated direct labels separate from same-named supplied referrers', async () => {
    vi.mocked(classifyEntrySource).mockImplementation(originalClassifier);
    mocks.rawQuery.mockImplementation(async sql =>
      sql.includes('SELECT DISTINCT session_id AS id,referrer_domain AS referrer')
        ? [
            { id: 'one', referrer: null },
            { id: 'two', referrer: '直接访问' },
            { id: 'two', referrer: '直接访问' },
          ]
        : sql.includes('AS active')
          ? [{ active: 2, views: 2, events: 0 }]
          : [],
    );
    const data = await featureAnalytics(websiteId, { ...common, kind: 'realtime' });
    expect(data).toMatchObject({
      totals: { active: 2, ai: 0 },
      sources: [
        { name: '直接访问', sourceLabel: 'direct', value: 1 },
        { name: '直接访问', value: 1 },
      ],
    });
    expect(data.sources[1]).not.toHaveProperty('sourceLabel');
  });
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

describe('explicit journey endpoints', () => {
  it('observes a repeated starting node only after the initial node', async () => {
    mocks.rawQuery.mockImplementation(async (sql: string) =>
      sql.includes('SELECT COUNT(DISTINCT session_id) AS visitors FROM eligible')
        ? [{ visitors: 0n }]
        : [],
    );
    await featureJourney(websiteId, {
      ...common,
      type: 'pages',
      steps: 3,
      startStep: '/loop',
      endStep: '/loop',
    });
    const [sql, params] = mocks.rawQuery.mock.calls[0];
    expect(sql).toContain('MIN(o.rn) FILTER(WHERE o.rn>s.start_rn AND o.node={{endStep}})');
    expect(params).toMatchObject({ startStep: '/loop', endStep: '/loop' });
  });

  it.each([2, 3, 4])('requires the terminal node to fit within %i steps', async steps => {
    mocks.rawQuery.mockImplementation(async (sql: string) =>
      sql.includes('SELECT COUNT(DISTINCT session_id) AS visitors FROM eligible')
        ? [{ visitors: 0n }]
        : [],
    );
    await featureJourney(websiteId, {
      ...common,
      type: 'pages',
      steps,
      startStep: '/a',
      endStep: '/d',
    });
    const [sql, params] = mocks.rawQuery.mock.calls[0];
    expect(sql).toContain('b.end_rn<=b.start_rn+{{steps}}::int-1');
    expect(sql).toContain('o.rn BETWEEN b.start_rn AND b.end_rn');
    expect(params).toMatchObject({ steps, startStep: '/a', endStep: '/d' });
  });
});

it.each(['partial', 'unavailable'])(
  'withholds %s session associations while retaining observed event counts',
  async status => {
    identityFixture.status = status;
    const sessionId = '22222222-2222-4222-8222-222222222222';
    const totals = {
      views: 2,
      events: 1,
      seconds: 30,
      count: 3,
      firstAt: '2026-01-01',
      lastAt: '2026-01-02',
      entryPath: '/private-entry',
      exitPath: '/private-exit',
      referrerDomain: 'source.test',
    };
    const rows = [{ sessionId, eventId: 'fallback-event', urlPath: '/private-entry' }];
    mocks.rawQuery.mockImplementation(async sql =>
      sql.includes('AS "entryPath"') ? [totals] : rows,
    );
    const unavailable = await featureAnalytics(websiteId, {
      ...common,
      kind: 'session',
      sessionId,
    });
    expect(unavailable).toMatchObject({
      rows: [],
      more: false,
      totals: {
        views: 2,
        events: 1,
        count: null,
        seconds: null,
        firstAt: null,
        lastAt: null,
        entryPath: null,
        exitPath: null,
        referrerDomain: null,
      },
      population: { identity: { status } },
    });
    expect(JSON.stringify(unavailable)).not.toContain(sessionId);
    identityFixture.status = 'complete';
    const complete = await featureAnalytics(websiteId, { ...common, kind: 'session', sessionId });
    expect(complete).toMatchObject({ rows, totals, more: false });
  },
);
