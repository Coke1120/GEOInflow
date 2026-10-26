import { beforeEach, describe, expect, test, vi } from 'vitest';
import { applyNativePopulation, populationFromRow } from '@/lib/liekan/upstream/browser-population';
import { getAttribution } from './getAttribution';

const { state, prismaRawQuery, prismaParseFilters, clickhouseRawQuery, clickhouseParseFilters } =
  vi.hoisted(() => ({
    state: { mode: 'prisma' as 'prisma' | 'clickhouse', partial: false },
    prismaRawQuery: vi.fn(),
    prismaParseFilters: vi.fn(),
    clickhouseRawQuery: vi.fn(),
    clickhouseParseFilters: vi.fn(),
  }));

vi.mock('@/lib/liekan/upstream/native-snapshot', () => ({
  nativeSnapshot: (work: () => unknown) => work(),
}));
vi.mock('@/lib/liekan/upstream/browser-population', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/liekan/upstream/browser-population')>();
  return {
    ...actual,
    readBrowserPopulation: async () =>
      actual.populationFromRow(
        {
          resourceKind: 'website',
          eligibleEvents: 10,
          qualifiedEvents: state.partial ? 5 : 10,
          eligiblePV: 10,
          qualifiedPV: state.partial ? 5 : 10,
          qualifiedVisitors: 4,
        },
        { startAt: +parameters.startDate, endAt: +parameters.endDate, timezone: 'UTC' },
      ),
  };
});

vi.mock('@/lib/db', () => ({
  CLICKHOUSE: 'clickhouse',
  PRISMA: 'prisma',
  runQuery: vi.fn((queries: Record<string, () => unknown>) => queries[state.mode]()),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    rawQuery: prismaRawQuery,
    parseFilters: prismaParseFilters,
  },
}));

vi.mock('@/lib/clickhouse', () => ({
  default: {
    rawQuery: clickhouseRawQuery,
    parseFilters: clickhouseParseFilters,
  },
}));

const parseFiltersResult = {
  queryParams: { websiteId: 'website-1' },
  filterQuery: 'and website_event.utm_source = {{utmSource}}',
  joinSessionQuery: 'join session on session.session_id = website_event.session_id',
  cohortQuery: 'join cohort on cohort.session_id = website_event.session_id',
};

const parameters = {
  startDate: new Date('2026-05-18T00:00:00.000Z'),
  endDate: new Date('2026-05-19T00:00:00.000Z'),
  model: 'last-click',
  type: 'path',
  step: '/checkout',
};

beforeEach(() => {
  state.mode = 'prisma';
  state.partial = false;
  prismaRawQuery.mockReset();
  prismaParseFilters.mockReset();
  clickhouseRawQuery.mockReset();
  clickhouseParseFilters.mockReset();

  prismaParseFilters.mockReturnValue(parseFiltersResult);
  clickhouseParseFilters.mockReturnValue(parseFiltersResult);
  prismaRawQuery.mockResolvedValue([{ group_key: 'total', pageviews: 0, visitors: 0, visits: 0 }]);
  clickhouseRawQuery.mockResolvedValue([]);
});

describe('getAttribution postgres branch', () => {
  test('reads referrer, paid ads, utm columns and totals in one database statement', async () => {
    await getAttribution('website-1', parameters, {});

    expect(prismaRawQuery).toHaveBeenCalledTimes(1);
    expect(clickhouseRawQuery).not.toHaveBeenCalled();

    const queries = prismaRawQuery.mock.calls.map(c => c[0] as string);
    expect(queries.some(q => q.includes('we.referrer_domain'))).toBe(true);
    expect(queries.some(q => q.includes("then 'Google Ads'"))).toBe(true);
    expect(queries.some(q => q.includes('we.utm_source'))).toBe(true);
    expect(queries.some(q => q.includes('we.utm_medium'))).toBe(true);
    expect(queries.some(q => q.includes('we.utm_campaign'))).toBe(true);
    expect(queries.some(q => q.includes('we.utm_content'))).toBe(true);
    expect(queries.some(q => q.includes('we.utm_term'))).toBe(true);
  });

  test('withholds attribution visitor totals without losing countable pageviews in a partial window', async () => {
    state.partial = true;
    const population = populationFromRow(
      {
        resourceKind: 'website',
        eligibleEvents: 10,
        qualifiedEvents: 5,
        eligiblePV: 10,
        qualifiedPV: 5,
        qualifiedVisitors: 4,
      },
      { startAt: +parameters.startDate, endAt: +parameters.endDate, timezone: 'UTC' },
    );
    prismaRawQuery.mockImplementation(async (_sql: string, _params: unknown, name: string) =>
      applyNativePopulation(
        [
          { group_key: 'referrer', name: 'source', value: 4 },
          { group_key: 'total', pageviews: 10, visitors: 8, visits: 9 },
        ],
        name,
        population,
      ),
    );
    const result = await getAttribution('website-1', parameters, {});
    expect(result.total).toMatchObject({ pageviews: 10, visitors: null, visits: null });
    expect(result.referrer).toEqual([{ name: 'source', value: null }]);
  });

  test('type=path selects url_path column and uses the step param', async () => {
    await getAttribution('website-1', parameters, {});

    // eventType / column derive from `type`; column is embedded in the SQL string
    const eventQueryCall = prismaRawQuery.mock.calls.find(c =>
      (c[0] as string).includes('conversion_events AS MATERIALIZED'),
    );
    expect(eventQueryCall?.[0]).toContain('website_event.url_path = {{step}}');
    expect(prismaParseFilters).toHaveBeenCalledWith(
      expect.objectContaining({ websiteId: 'website-1', eventType: 1 }),
    );
  });

  test('type=event selects event_name column and customEvent event type', async () => {
    await getAttribution('website-1', { ...parameters, type: 'event' }, {});

    const eventQueryCall = prismaRawQuery.mock.calls.find(c =>
      (c[0] as string).includes('conversion_events AS MATERIALIZED'),
    );
    expect(eventQueryCall?.[0]).toContain('website_event.event_name = {{step}}');
    expect(prismaParseFilters).toHaveBeenCalledWith(expect.objectContaining({ eventType: 2 }));
  });

  test('first-click model uses min(created_at) with no upper-bound clause', async () => {
    await getAttribution('website-1', { ...parameters, model: 'first-click' }, {});

    const referrerQuery = prismaRawQuery.mock.calls
      .map(c => c[0] as string)
      .find(q => q.includes('we.referrer_domain') && q.includes('model AS'));
    expect(referrerQuery).toContain('min(we.created_at) created_at');
    expect(referrerQuery).not.toContain('and we.created_at < e.max_dt');
  });

  test('last-click model uses max(created_at) bounded by e.max_dt', async () => {
    await getAttribution('website-1', { ...parameters, model: 'last-click' }, {});

    const referrerQuery = prismaRawQuery.mock.calls
      .map(c => c[0] as string)
      .find(q => q.includes('we.referrer_domain') && q.includes('model AS'));
    expect(referrerQuery).toContain('max(we.created_at) created_at');
    expect(referrerQuery).toContain('and we.created_at < e.max_dt');
  });

  test('returns the shaped attribution result object', async () => {
    prismaRawQuery.mockResolvedValueOnce([
      { group_key: 'referrer', name: 'a', value: 1 },
      { group_key: 'paidAds', name: 'Google Ads', value: 2 },
      { group_key: 'utm_source', name: 's', value: 3 },
      { group_key: 'utm_medium', name: 'm', value: 4 },
      { group_key: 'utm_campaign', name: 'c', value: 5 },
      { group_key: 'utm_content', name: 'ct', value: 6 },
      { group_key: 'utm_term', name: 't', value: 7 },
      { group_key: 'total', pageviews: 10, visitors: 8, visits: 9 },
    ]);

    const result = await getAttribution('website-1', parameters, {});

    expect(result.referrer).toEqual([{ name: 'a', value: 1 }]);
    expect(result.paidAds).toEqual([{ name: 'Google Ads', value: 2 }]);
    expect(result.utm_source).toEqual([{ name: 's', value: 3 }]);
    expect(result.total).toEqual({ pageviews: 10, visitors: 8, visits: 9 });
  });
});

describe('getAttribution clickhouse branch', () => {
  beforeEach(() => {
    state.mode = 'clickhouse';
  });

  test('runs eight rawQuery calls with clickhouse-typed params', async () => {
    await getAttribution('website-1', parameters, {});

    expect(clickhouseRawQuery).toHaveBeenCalledTimes(8);
    expect(prismaRawQuery).not.toHaveBeenCalled();

    const queries = clickhouseRawQuery.mock.calls.map(c => c[0] as string);
    expect(queries.some(q => q.includes('where website_id = {websiteId:UUID}'))).toBe(true);
    expect(
      queries.some(q =>
        q.includes('created_at between {startDate:DateTime64} and {endDate:DateTime64}'),
      ),
    ).toBe(true);
    // paid ads use multiIf in clickhouse rather than a CASE expression
    expect(queries.some(q => q.includes("multiIf(gclid != '', 'Google Ads'"))).toBe(true);
  });

  test('type=path uses url_path with {step:String} and pageView event type', async () => {
    await getAttribution('website-1', parameters, {});

    const eventQuery = clickhouseRawQuery.mock.calls
      .map(c => c[0] as string)
      .find(q => q.includes('WITH events AS'));
    expect(eventQuery).toContain('url_path = {step:String}');
    expect(clickhouseParseFilters).toHaveBeenCalledWith(expect.objectContaining({ eventType: 1 }));
  });

  test('first-click model uses min(created_at) with no upper bound', async () => {
    await getAttribution('website-1', { ...parameters, model: 'first-click' }, {});

    const referrerQuery = clickhouseRawQuery.mock.calls
      .map(c => c[0] as string)
      .find(q => q.includes('we.referrer_domain') && q.includes('model AS'));
    expect(referrerQuery).toContain('min(we.created_at) created_at');
    expect(referrerQuery).not.toContain('where we.created_at < e.max_dt');
  });
});
