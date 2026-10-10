// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { readKeywordPage } from './keywords';
import { analyticsCache, encodeAnalyticsResult } from './query-cache';
import { installAnalyticsRuntime } from './analytics-runtime';
import { AnalyticsRedis } from './analytics-redis';
import { getQuerySnapshot } from './query-snapshot';
import { parseReportQuery } from '../contracts/query';

vi.mock('./analytics-hot', () => ({
  rememberAnalyticsHot: async () => {},
  reserveWorkerComputation: async () => true,
}));
vi.mock('./server', () => ({
  query: (sql: string) => getQuerySnapshot()!.$queryRawUnsafe(sql),
  reportSnapshot: (work: () => unknown) => work(),
}));
vi.mock('../store', () => ({
  getSettings: async () => ({ isDemo: false, aiCrawlerEnabled: false }),
}));
vi.mock('./analytics', () => ({
  humanVisitsSql: () => 'WITH visits AS (SELECT 1), converted AS (SELECT 1)',
  visitMetrics: 'count(*) AS sessions',
  convertedJoin: '',
}));

it('keeps high-cardinality uncached pagination stable and resets only when the population changes', async () => {
  const id = '50000000-0000-4000-8000-000000000001';
  const raw = Array.from({ length: 10000 }, (_, i) => ({
    referrer: 'www.google.com',
    referrerPath: '/search',
    referrerQuery: '?q=word' + String(i).padStart(5, '0'),
    sessions: 1,
    bounces: 1,
    conversions: 0,
  }));
  let cursor = 0,
    computations = 0,
    hasGoals = false;
  const primary = () => ({
    $transaction: async (work: (tx: any) => unknown) =>
      work({
        $executeRawUnsafe: async (sql: string) => {
          if (sql.startsWith('DECLARE')) {
            cursor = 0;
            computations++;
          }
          return 0;
        },
        $queryRawUnsafe: async (sql: string) => {
          if (sql.startsWith('FETCH')) {
            const batch = raw.slice(cursor, cursor + 500);
            cursor += 500;
            return batch;
          }
          if (sql.includes('SELECT EXISTS')) return [{ present: hasGoals }];
          if (sql.includes('FROM liekan_analytics_revision'))
            return [{ type: 'website', id, revision: '0' }];
          if (sql.includes('FROM liekan_log_state')) return [{ id, data: '0', policy: '0' }];
          return [];
        },
      }),
  });
  vi.stubEnv('DATABASE_URL', 'postgresql://fixture:fixture@localhost/fixture');
  analyticsCache.clear();
  installAnalyticsRuntime(analyticsCache, primary, new AnalyticsRedis(''));
  const spy = vi.spyOn(analyticsCache, 'read');
  const website = { id, name: '隔离测试', domain: 'fixture.test' };
  const p = (more = {}) =>
    parseReportQuery({
      resource: 'human/keywords',
      startAt: 0,
      endAt: 1000,
      timezone: 'UTC',
      sort: 'keyword',
      direction: 'asc',
      ...more,
    }).data!;
  try {
    const first = await readKeywordPage(website, p(), 30000, false);
    expect(encodeAnalyticsResult((await spy.mock.results[0].value).value).length).toBeGreaterThan(
      2 * 1024 * 1024,
    );
    raw.reverse();
    const second = await readKeywordPage(
      website,
      p({ page: 2, keywordSnapshot: first.value.meta.keywordSnapshot }),
      30000,
      false,
    );
    expect(computations).toBe(2);
    expect(second.value.meta.keywordSnapshot).toBe(first.value.meta.keywordSnapshot);
    expect(second.value.meta.keywordReset).toBe(false);
    expect(second.value.meta.tablePages.keywordBody.page).toBe(2);
    expect(second.value.tables.keywordBody[0].keyword).toBe('word00020');
    raw[0].bounces = 0;
    const metrics = await readKeywordPage(
      website,
      p({ page: 2, keywordSnapshot: second.value.meta.keywordSnapshot }),
      30000,
      false,
    );
    expect(metrics.value.meta.keywordReset).toBe(true);
    hasGoals = true;
    const goals = await readKeywordPage(
      website,
      p({ page: 2, keywordSnapshot: metrics.value.meta.keywordSnapshot }),
      30000,
      false,
    );
    expect(goals.value.meta.keywordReset).toBe(true);
  } finally {
    spy.mockRestore();
    analyticsCache.clear();
    vi.unstubAllEnvs();
  }
});
