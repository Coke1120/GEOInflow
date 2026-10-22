import { TRAFFIC_POLICY_VERSION } from './traffic-query';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  execute: vi.fn(),
  cache: vi.fn(),
  settings: vi.fn(),
  key: vi.fn(),
}));
vi.mock('./server', async () => ({
  query: mocks.query,
  reportSnapshot: (work: () => unknown) => work(),
}));
vi.mock('./query-snapshot', () => ({
  getQuerySnapshot: () => ({ $executeRawUnsafe: mocks.execute }),
}));
vi.mock('./query-cache', () => ({
  analyticsCache: { read: mocks.cache },
  analyticsCacheKey: mocks.key,
  websiteCacheTag: (id: string) => id,
}));
vi.mock('../store', () => ({ getSettings: mocks.settings }));
vi.mock('./analytics', () => ({
  humanVisitsSql: () => 'WITH visits AS (SELECT * FROM website_event), converted AS (SELECT 1)',
  visitMetrics: 'count(*) AS sessions',
  convertedJoin: '',
}));
import { keywordReport, readKeywordFacts, readKeywordPage } from './keywords';
import { parseReportQuery } from '../contracts/query';
const website = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '隔离测试',
  domain: 'fixture.test',
};
const params = { resource: 'human/keywords', startAt: 0, endAt: 1000, timezone: 'UTC' };
const p = (input = {}) => parseReportQuery({ ...params, ...input }).data!;
const raw = {
  referrer: 'www.google.com',
  referrerPath: '/search',
  referrerQuery: '?q=word',
  sessions: 1,
  bounces: 1,
  conversions: 0,
};
const settings = { isDemo: false, aiCrawlerEnabled: false } as any;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.key.mockImplementation((_key: string, p: unknown) => JSON.stringify(p));
  delete process.env.CLICKHOUSE_URL;
  mocks.execute.mockResolvedValue(undefined);
  mocks.query.mockImplementation(async (sql: string) =>
    sql.startsWith('FETCH') ? [] : [{ present: true }],
  );
  mocks.settings.mockResolvedValue(settings);
});
it('batches raw evidence in one snapshot and closes the cursor after completion', async () => {
  mocks.query
    .mockResolvedValueOnce(Array.from({ length: 500 }, () => raw))
    .mockResolvedValueOnce([{ ...raw, referrerQuery: '?q=person%40example.test' }])
    .mockResolvedValueOnce([{ present: true }]);
  const result = await readKeywordFacts(website.id, p());
  expect(result.rows).toHaveLength(2);
  expect(result.rows.reduce((n, r) => n + r.sessions, 0)).toBe(501);
  expect(JSON.stringify(result)).not.toContain('person');
  expect(mocks.execute.mock.calls[0]).toEqual([
    expect.stringMatching(/^DECLARE keyword_[a-f0-9]+ NO SCROLL CURSOR FOR/),
    website.id,
    new Date(0),
    new Date(1000),
    'UTC',
  ]);
  expect(mocks.execute.mock.calls.at(-1)[0]).toMatch(/^CLOSE keyword_/);
  expect(mocks.execute.mock.calls[0][0]).toContain(
    'website_event AS NOT MATERIALIZED (SELECT * FROM liekan_geographic_website_event)',
  );
});
it('closes on cancellation and rejects unsupported storage before database work', async () => {
  const signal = new AbortController();
  signal.abort();
  await expect(readKeywordFacts(website.id, p(), signal.signal)).rejects.toMatchObject({
    status: 499,
  });
  expect(mocks.execute).not.toHaveBeenCalled();
  process.env.CLICKHOUSE_URL = 'http://fixture.test';
  await expect(readKeywordFacts(website.id, p())).rejects.toMatchObject({ status: 501 });
  delete process.env.CLICKHOUSE_URL;
});
it('rejects evidence over the bounded candidate limit and still releases the cursor', async () => {
  mocks.query.mockResolvedValue(Array.from({ length: 500 }, () => raw));
  await expect(readKeywordFacts(website.id, p())).rejects.toMatchObject({ status: 413 });
  expect(mocks.execute.mock.calls.at(-1)[0]).toMatch(/^CLOSE keyword_/);
});
it('keeps the same snapshot across recomputation and input order, and changes it with metrics or goals', async () => {
  const second = { ...raw, referrerQuery: '?q=other' };
  const load = async (rows: (typeof raw)[], hasGoals = true) => {
    mocks.query.mockResolvedValueOnce(rows).mockResolvedValueOnce([{ present: hasGoals }]);
    return readKeywordFacts(website.id, p());
  };
  const first = await load([raw, second]);
  const same = await load([second, raw]);
  expect(same.snapshot).toBe(first.snapshot);
  expect(
    keywordReport(website, p({ page: 2, keywordSnapshot: first.snapshot }), same, settings).meta
      .keywordReset,
  ).toBe(false);
  expect((await load([{ ...raw, sessions: 2 }, second])).snapshot).not.toBe(first.snapshot);
  expect((await load([raw, second], false)).snapshot).not.toBe(first.snapshot);
});
it('excludes nonsearch evidence from the keyword capacity budget', async () => {
  const unrelated = Array.from({ length: 500 }, () => ({ ...raw, referrer: 'other.test' }));
  for (let i = 0; i < 201; i++) mocks.query.mockResolvedValueOnce(unrelated);
  mocks.query.mockResolvedValueOnce([raw]).mockResolvedValueOnce([{ present: true }]);
  expect((await readKeywordFacts(website.id, p())).rows).toHaveLength(1);
});
it('projects new statuses for legacy pages before filtering and pagination without inventing a term', () => {
  const rows = ['redirect', 'unsupported'].map((status, i) => ({
    id: JSON.stringify(['百度', null, 'none', status]),
    engine: '百度' as const,
    keyword: null,
    evidence: 'none' as const,
    status: status as 'redirect' | 'unsupported',
    sessions: i + 2,
    bounces: 1,
    conversions: 1,
    share: null,
    bounceRate: null,
    conversionRate: null,
  }));
  const facts = { rows, hasGoals: true, snapshot: 'fixture', readAt: 1 };
  const legacy = keywordReport(website, p({ status: 'unsupported' }), facts, settings);
  expect(legacy.tables.keywordBody).toHaveLength(1);
  expect(legacy.tables.keywordBody[0]).toMatchObject({
    keyword: null,
    status: 'unsupported',
    sessions: 5,
    share: 100,
    bounceRate: 40,
    conversionRate: 40,
  });
  expect(legacy.meta.tablePages.keywordBody.total).toBe(1);
  const modern = keywordReport(website, p({ keywordStatusVersion: '2' }), facts, settings);
  expect(modern.tables.keywordBody).toHaveLength(2);
  expect(modern.tables.keywordBody.some(row => row.status === 'redirect')).toBe(true);
  expect(modern.cards.map(card => card.value)).toEqual(legacy.cards.map(card => card.value));
  expect(facts.rows[0].status).toBe('redirect');
});
it('filters and sorts before slicing, resets a changed snapshot and reuses the base cache across filters/pages', async () => {
  const rows = Array.from({ length: 45 }, (_, i) => ({
    id: String(i).padStart(2, '0'),
    engine: 'Google' as const,
    keyword: `word${String(i).padStart(2, '0')}`,
    evidence: 'referrer' as const,
    status: 'available' as const,
    sessions: 1,
    bounces: 1,
    conversions: 0,
    share: null,
    bounceRate: null,
    conversionRate: null,
  }));
  const facts = {
    rows,
    snapshot: '11111111-1111-4111-8111-111111111111',
    readAt: 10,
    hasGoals: false,
  };
  const report = keywordReport(
    website,
    p({ page: 2, sort: 'keyword', direction: 'asc' }),
    facts,
    settings,
  );
  expect(report.tables.keywordBody[0].keyword).toBe('word20');
  expect(report.tables.keywordBody).toHaveLength(20);
  expect(
    keywordReport(website, p({ search: 'word44', page: 3 }), facts, settings).tables.keywordBody,
  ).toHaveLength(1);
  expect(
    keywordReport(
      website,
      p({ page: 2, keywordSnapshot: '22222222-2222-4222-8222-222222222222' }),
      facts,
      settings,
    ).meta,
  ).toMatchObject({ keywordReset: true, tablePages: { keywordBody: { page: 1 } } });
  mocks.cache.mockResolvedValue({
    value: { facts, settings },
    generatedAt: 10,
    expiresAt: 30010,
    status: 'hit',
  });
  await readKeywordPage(website, p(), 30000, false);
  await readKeywordPage(website, p({ page: 2, engine: 'Google', search: 'word' }), 30000, false);
  expect(mocks.cache.mock.calls[0][0]).toBe(mocks.cache.mock.calls[1][0]);
  expect(mocks.key).toHaveBeenCalledWith(
    `source-keywords-v4-${TRAFFIC_POLICY_VERSION}`,
    expect.any(Array),
  );
});
