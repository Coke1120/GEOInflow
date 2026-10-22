import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  read: vi.fn(),
  authorize: vi.fn(),
  query: vi.fn(),
  referrals: vi.fn(),
}));
vi.mock('../upstream/query-cache', () => ({
  analyticsCache: { read: h.read },
  analyticsCacheKey: (_kind: string, value: unknown) => JSON.stringify(value),
  websiteCacheTag: (id: string) => `website:${id}`,
}));
vi.mock('../upstream/crawler-access', () => ({
  authorizeCrawler: h.authorize,
  crawlerTransaction: (work: any) => work({ query: h.query }),
}));
vi.mock('../upstream/analytics', () => ({ crawlerReferralRows: h.referrals }));

import { crawlerAnalysis } from './analysis';
import { withQueryCacheHeaders } from '../upstream/cache-context';

beforeEach(() => {
  h.authorize.mockResolvedValue({ canDraft: true, canControl: true });
  h.query.mockResolvedValue([{ epoch: 1, data_revision: 0 }]);
  h.read.mockResolvedValue({
    value: { bots: [], criticalPaths: [] },
    generatedAt: 1000,
    expiresAt: 31000,
    status: 'hit',
    tier: 'memory',
  });
});

it('reports the actual cached crawler snapshot time through the request boundary', async () => {
  const response = await withQueryCacheHeaders(async () =>
    Response.json(
      await crawlerAnalysis({ id: 'actor', role: 'admin' }, 'site', {
        startAt: 1,
        endAt: 1000,
        timezone: 'UTC',
      }),
    ),
  );
  expect(response.headers.get('x-liekan-generated-at')).toBe('1000');
  expect(response.headers.get('x-liekan-expires-at')).toBe('31000');
  expect(response.headers.get('x-liekan-cache')).toBe('hit');
  expect(h.authorize).toHaveBeenCalledTimes(2);
});

it('replays cached current and previous identity metadata without reading a new population', async () => {
  const { populationFromRow } = await import('../upstream/browser-population');
  const population = populationFromRow(
    { eligibleEvents: 2, qualifiedEvents: 1, eligiblePV: 2, qualifiedPV: 1, qualifiedVisitors: 1 },
    { startAt: 1, endAt: 1000, timezone: 'UTC', endExclusive: true },
  );
  const previous = {
    ...population,
    range: { ...population.range, startAt: 0, endAt: 1 },
    identity: {
      ...population.identity,
      status: 'empty' as const,
      eligibleEvents: 0,
      eligiblePV: 0,
      qualifiedPV: 0,
      qualifiedVisitors: 0,
      coverage: null,
    },
  };
  h.read.mockResolvedValue({
    value: { population, previous: { population: previous }, platforms: [{ visits: null }] },
    generatedAt: 1000,
    expiresAt: 31000,
    status: 'hit',
    tier: 'memory',
  });
  const response = await withQueryCacheHeaders(async () =>
    Response.json(await crawlerAnalysis({ id: 'actor', role: 'admin' }, 'site', population.range)),
  );
  expect(
    JSON.parse(response.headers.get('X-Liekan-Population')!).populations.map(
      row => row.identity.status,
    ),
  ).toEqual(['partial', 'empty']);
  expect((await response.json()).population).toEqual(population);
  expect(
    h.query.mock.calls.every(([sql]) => !sql.includes('WITH population AS MATERIALIZED')),
  ).toBe(true);
});

it.each([
  ['unavailable', 'complete'],
  ['partial', 'complete'],
  ['complete', 'unavailable'],
  ['complete', 'partial'],
  ['complete', 'complete'],
])(
  'gates entry-attributed goals independently for %s current and %s previous identities',
  async (current, previous) => {
    const range = { startAt: 2000, endAt: 3000, timezone: 'UTC' };
    h.query.mockImplementation(async (sql: string, _websiteId: string, start: Date) => {
      if (sql.includes('WITH population AS MATERIALIZED')) {
        const status = +start === range.startAt ? current : previous;
        const qualified = status === 'complete' ? 2 : status === 'partial' ? 1 : 0;
        return [
          {
            resourceKind: 'website',
            eligibleEvents: 2,
            qualifiedEvents: qualified,
            eligiblePV: 2,
            qualifiedPV: qualified,
            qualifiedVisitors: qualified ? 1 : 0,
          },
        ];
      }
      if (sql.includes('AS connected')) return [{ connected: true }];
      if (sql.includes('SELECT count(*)::int AS count FROM report')) return [{ count: 1 }];
      if (sql.includes('SELECT count(*)::int AS count')) return [{ count: 0 }];
      return [];
    });
    // The entry query can return attributed counts for a collided fallback key. The
    // consumer must use the full window's identity evidence before publishing them.
    h.referrals.mockResolvedValue([
      {
        referrer: 'chatgpt.com',
        path: '/ai-entry',
        hostname: 'example.com',
        visits: 1,
        conversions: 1,
        goalEvents: 2,
      },
    ]);
    h.read.mockImplementation(async (_key, _ttl, _tags, load) => ({
      value: await load(),
      generatedAt: 1000,
      expiresAt: 31000,
      status: 'miss',
      tier: 'memory',
    }));
    const report = await crawlerAnalysis({ id: 'actor', role: 'admin' }, 'site', range);
    for (const [period, status] of [
      [report, current],
      [report.previous, previous],
    ] as const) {
      const complete = status === 'complete';
      expect(period.population.identity.status).toBe(status);
      expect(period.platforms.find(row => row.platformId === 'openai')).toMatchObject({
        visits: complete ? 1 : null,
        conversions: complete ? 1 : null,
        goalEvents: complete ? 2 : null,
        landingPages: [
          {
            path: '/ai-entry',
            visits: complete ? 1 : null,
            conversions: complete ? 1 : null,
            goalEvents: complete ? 2 : null,
          },
        ],
      });
    }
  },
);
