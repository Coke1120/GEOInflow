import { beforeAll, describe, expect, test, vi } from 'vitest';
import { analyticsCache } from './liekan/upstream/query-cache';
import { bindCacheRequest, withQueryCacheHeaders } from './liekan/upstream/cache-context';

process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/umami?schema=public';
delete process.env.DATABASE_REPLICA_URL;

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: class PrismaPg {},
}));

vi.mock('@prisma/extension-read-replicas', () => ({
  readReplicas: () => () => ({}),
}));

vi.mock('@/generated/prisma/client', () => ({
  PrismaClient: class PrismaClient {
    $executeRawUnsafe = vi.fn();
    $queryRawUnsafe = vi.fn();
    $transaction = vi.fn();
    $on = vi.fn();
    $extends() {
      return this;
    }
  },
}));

let getRawQueryClient!: typeof import('./prisma').getRawQueryClient;
let prisma!: typeof import('./prisma').default;

beforeAll(async () => {
  ({ getRawQueryClient, default: prisma } = await import('./prisma'));
});

interface RawQueryClient {
  $executeRawUnsafe: (query: string, ...params: any[]) => unknown;
  $queryRawUnsafe: (query: string, ...params: any[]) => unknown;
  $primary?: () => unknown;
  $replica?: () => unknown;
}

function createClient(): RawQueryClient {
  return {
    $executeRawUnsafe: vi.fn(),
    $queryRawUnsafe: vi.fn(),
  };
}

describe('getRawQueryClient', () => {
  test('uses a replica client for read queries when replicas are enabled', () => {
    const replica = createClient();
    const client = {
      ...createClient(),
      $replica: vi.fn(() => replica),
    };

    expect(getRawQueryClient(client, { useReplica: true })).toBe(replica);
  });

  test('keeps read queries on the primary client when replicas are disabled', () => {
    const client = {
      ...createClient(),
      $replica: vi.fn(() => createClient()),
    };

    expect(getRawQueryClient(client, { useReplica: false })).toBe(client);
  });

  test('uses the primary client for raw writes when available', () => {
    const primary = createClient();
    const client = {
      ...createClient(),
      $primary: vi.fn(() => primary),
      $replica: vi.fn(() => createClient()),
    };

    expect(getRawQueryClient(client, { useReplica: true, write: true })).toBe(primary);
  });

  test('falls back to the current client for raw writes without a primary helper', () => {
    const client = createClient();

    expect(getRawQueryClient(client, { write: true })).toBe(client);
  });
});

test('native aggregates use the request timezone when SQL parameters omit it', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(+new Date('2026-10-05T01:00:00Z'));
  const read = vi.spyOn(analyticsCache, 'read').mockResolvedValue({
    value: [{ count: 1 }],
    generatedAt: Date.now(),
    expiresAt: Date.now() + 30000,
    status: 'hit',
    tier: 'memory',
  });
  try {
    for (const timezone of ['UTC', 'America/Los_Angeles']) {
      await withQueryCacheHeaders(async () => {
        bindCacheRequest(
          new Request('http://localhost/api/websites/site/heatmaps'),
          { user: { id: 'actor' } },
          { timezone },
        );
        await prisma.rawQuery(
          'select count(*) from website_event where website_id={{websiteId}}',
          {
            websiteId: 'site',
            endDate: new Date('2026-10-04T20:00:00Z'),
          },
          'getHeatmap',
        );
        return Response.json({ ok: true });
      });
    }
    expect(read.mock.calls.map(call => call[1])).toEqual([300000, 30000]);
    expect(read.mock.calls[0][0]).not.toEqual(read.mock.calls[1][0]);
  } finally {
    read.mockRestore();
    clock.mockRestore();
  }
});

test('equivalent native SQL bindings share a key across worker and HTTP metadata', async () => {
  const read = vi
    .spyOn(analyticsCache, 'read')
    .mockResolvedValue({
      value: [{ count: 1 }],
      generatedAt: Date.now(),
      expiresAt: Date.now() + 30000,
      status: 'hit',
      tier: 'memory',
    });
  try {
    await withQueryCacheHeaders(async () => {
      bindCacheRequest(
        new Request('http://localhost/api/websites/site/stats'),
        { user: { id: 'actor' } },
        { timezone: 'UTC' },
      );
      const parameters = { websiteId: 'site', startDate: new Date(1000), endDate: new Date(2000) };
      const sql =
        'select count(*) from website_event where website_id={{websiteId::uuid}} and created_at between {{startDate}} and {{endDate}}';
      await prisma.rawQuery(sql, parameters, 'getWebsiteStats');
      await prisma.rawQuery(
        sql,
        { ...parameters, compare: 'prev', startAt: 1000, endAt: 2000, currency: 'USD' },
        'getWebsiteStats',
      );
      await prisma.rawQuery(sql, { ...parameters, endDate: new Date(3000) }, 'getWebsiteStats');
      return Response.json({ ok: true });
    });
    expect(read.mock.calls[0][0]).toEqual(read.mock.calls[1][0]);
    expect(read.mock.calls[0][0]).not.toEqual(read.mock.calls[2][0]);
  } finally {
    read.mockRestore();
  }
});

describe('getDateSQL timezone formatting', () => {
  test('formats UTC (default) buckets with an explicit zone and a Z marker', () => {
    // Never rely on the DB session's ambient timezone.
    expect(prisma.getDateSQL('website_event.created_at', 'hour')).toBe(
      `to_char(date_trunc('hour', website_event.created_at at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:00:00"Z"')`,
    );
    expect(prisma.getDateSQL('website_event.created_at', 'hour', 'UTC')).toBe(
      `to_char(date_trunc('hour', website_event.created_at at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:00:00"Z"')`,
    );
  });

  test('formats non-UTC buckets with the same explicit Z marker, not a bare timestamp', () => {
    // Bare timestamps get misparsed as local-to-the-runtime, not the source zone.
    expect(prisma.getDateSQL('website_event.created_at', 'hour', 'Asia/Tehran')).toBe(
      `to_char(date_trunc('hour', website_event.created_at at time zone 'Asia/Tehran'), 'YYYY-MM-DD"T"HH24:00:00"Z"')`,
    );
  });
});

describe('getDateStringSQL timezone formatting', () => {
  test('formats non-UTC second-precision values with an explicit Z marker', () => {
    expect(prisma.getDateStringSQL('event_data.date_value', 'second', 'Asia/Tehran')).toBe(
      `to_char(event_data.date_value at time zone 'Asia/Tehran', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
    );
  });

  test('defaults to explicit UTC formatting regardless of unit when no timezone is given', () => {
    expect(prisma.getDateStringSQL('event_data.date_value')).toBe(
      `to_char(event_data.date_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
    );
  });
});

describe('getDateWeeklySQL timezone formatting', () => {
  test('falls back to UTC instead of producing invalid SQL when no timezone is given', () => {
    // Regression test: this used to interpolate `undefined` straight into `at time zone`.
    expect(prisma.getDateWeeklySQL('website_event.created_at')).toBe(
      `concat(extract(dow from (website_event.created_at at time zone 'UTC')), ':', to_char((website_event.created_at at time zone 'UTC'), 'HH24'))`,
    );
  });

  test('uses the given timezone when one is provided', () => {
    expect(prisma.getDateWeeklySQL('website_event.created_at', 'Asia/Tehran')).toBe(
      `concat(extract(dow from (website_event.created_at at time zone 'Asia/Tehran')), ':', to_char((website_event.created_at at time zone 'Asia/Tehran'), 'HH24'))`,
    );
  });
});

describe('pagedRawQuery default ordering', () => {
  function mockQueries(count = '4') {
    const queryRaw = vi.mocked((prisma.client as any).$queryRawUnsafe);
    queryRaw.mockClear();
    queryRaw.mockImplementation(async (sql: string) =>
      sql.includes('count(*) as num') ? [{ num: count }] : [{ id: 1 }],
    );
    return queryRaw;
  }

  test.each([undefined, 5])(
    'applies trusted default order only to the page query with cap %s',
    async maxResults => {
      const queryRaw = mockQueries('5');
      const result = await prisma.pagedRawQuery(
        'select * from thing',
        {},
        { page: 2, pageSize: 2, maxResults },
        'test',
        'max(created_at) desc, session_id',
      );

      expect(queryRaw).toHaveBeenCalledTimes(2);
      expect(queryRaw.mock.calls[0][0]).not.toContain('order by max(created_at) desc');
      expect(queryRaw.mock.calls[1][0]).toContain('order by max(created_at) desc, session_id');
      expect(queryRaw.mock.calls[1][0]).toContain('limit 2 offset 2');
      expect(result).toEqual({
        data: [{ id: 1 }],
        count: 5,
        page: 2,
        pageSize: 2,
        isCapped: !!maxResults,
        orderBy: undefined,
      });
    },
  );

  test('keeps explicit ordering and legacy no-order behavior', async () => {
    const queryRaw = mockQueries();
    const result = await prisma.pagedRawQuery(
      'select * from thing',
      {},
      { page: 1, pageSize: 2, orderBy: 'name', sortDescending: true },
      undefined,
      'max(created_at) desc, session_id',
    );
    expect(queryRaw.mock.calls[1][0]).toContain('order by name desc');
    expect(queryRaw.mock.calls[1][0]).not.toContain('order by max(created_at) desc, session_id');
    expect(result.orderBy).toBe('name');
    queryRaw.mockClear();
    await prisma.pagedRawQuery('select * from thing', {}, { page: 1, pageSize: 2 });
    expect(queryRaw.mock.calls[1][0]).not.toMatch(/order by/);
  });
});

describe('Liekan breakdown drill filters', () => {
  test('matches null and empty dimensions as a mandatory drill condition', () => {
    const parsed = prisma.parseFilters({
      country: 'eq.CN',
      path: 'eq./home',
      match: 'any',
      drill_country: 'empty.',
    });
    expect(parsed.filterQuery).toContain("and (session.country is null or session.country = '')");
    expect(parsed.filterQuery).toContain(' or ');
    expect(parsed.joinSessionQuery).toContain('inner join session');
    expect(parsed.filterQuery).not.toContain('ANY({{drill_country}})');
  });
  test('retains normal literal filtering and normalized country drill values', () => {
    const literal = prisma.parseFilters({ country: 'empty.' });
    expect(literal.filterQuery).toContain('else upper(session.country) end = ANY({{country}})');
    expect(literal.queryParams).toMatchObject({ country: ['EMPTY.'] });
    const drill = prisma.parseFilters({ drill_country: 'eq.CN' });
    expect(drill.queryParams).toMatchObject({ drill_country: ['CN', 'TW', 'TWN'] });
  });
  test.each(['eq', 'neq'])('filters the normalized Taiwan province with %s', operator => {
    const parsed = prisma.parseFilters({ region: `${operator}.CN-71` });
    expect(parsed.queryParams).toMatchObject({ region: ['CN-71'] });
    expect(parsed.filterQuery).toContain("upper(session.country) in ('TW', 'TWN')");
    expect(parsed.filterQuery).toContain("then 'CN-71' else session.region end");
    expect(parsed.filterQuery).toContain(
      operator === 'eq' ? '= ANY({{region}})' : '!= ALL({{region}})',
    );
  });
  test('normalizes legacy province drills and keeps mainland filters separate', () => {
    const parsed = prisma.parseFilters({ drill_region: 'eq.TW-TPE', region: 'eq.CN-SH' });
    expect(parsed.queryParams).toMatchObject({ drill_region: ['CN-71'], region: ['CN-SH'] });
    expect(parsed.filterQuery).toContain('= ANY({{drill_region}})');
  });
  test.each([
    ['c', 'CN-TPE', 'or', 'ilike'],
    ['dnc', 'CN-TPE', 'and', 'not ilike'],
    ['re', '^CN-TPE$', 'or', '~*'],
    ['nre', '^CN-TPE$', 'and', '!~*'],
  ])('keeps saved province %s filters compatible', (operator, value, join, comparison) => {
    const parsed = prisma.parseFilters({ region: `${operator}.${value}` });
    expect(parsed.filterQuery).toContain(` ${join} coalesce(session.region, `);
    expect(parsed.filterQuery).toContain(` ${comparison} {{region}})`);
    expect(parsed.filterQuery).toContain("then 'CN-71'");
  });
});
