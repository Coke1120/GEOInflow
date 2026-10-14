import { beforeEach, expect, it, vi } from 'vitest';
import { getQuerySnapshot, withinQuerySnapshot } from './query-snapshot';
const mocks = vi.hoisted(() => ({
  facts: vi.fn(),
  snapshot: vi.fn(),
  execute: vi.fn(),
  query: vi.fn(),
}));
vi.mock('./server', () => ({ reportSnapshot: mocks.snapshot, LiekanError: Error }));
vi.mock('./keywords', () => ({ readKeywordFacts: mocks.facts, validateKeywordRange: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: {}, getRawQueryClient: vi.fn() }));
vi.mock('@/lib/request', () => ({ getQueryFilters: vi.fn() }));
vi.mock('@/queries/sql', () => ({ getWebsiteStats: vi.fn() }));
vi.mock('@/queries/prisma', () => ({ getWebsiteSegment: vi.fn() }));
import { prepareFeatureExport } from './feature-exports';
import Papa from 'papaparse';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockResolvedValue(0);
  mocks.query.mockResolvedValue([]);
  mocks.snapshot.mockImplementation((fn: () => Promise<unknown>) =>
    withinQuerySnapshot({ $executeRawUnsafe: mocks.execute, $queryRawUnsafe: mocks.query }, fn),
  );
  mocks.facts.mockResolvedValue({
    hasGoals: true,
    snapshot: 'fixture',
    readAt: 1000,
    rows: Array.from({ length: 45 }, (_, i) => ({
      engine: 'Google',
      keyword: i === 0 ? '=1+1' : `word${String(i).padStart(2, '0')}`,
      evidence: 'referrer',
      status: 'available',
      sessions: 1,
      bounces: 1,
      conversions: 0,
      id: String(i),
      share: null,
      bounceRate: null,
      conversionRate: null,
    })),
  });
});
it('applies a database statement deadline before reading uncached keyword export evidence', async () => {
  mocks.facts.mockImplementationOnce(async () => {
    await getQuerySnapshot()!.$queryRawUnsafe('FETCH FORWARD 500 FROM fixture_cursor');
    return { rows: [], hasGoals: false, readAt: 1000 };
  });
  const response = await prepareFeatureExport(
    { id: 'site', name: 'fixture', domain: 'fixture.test' },
    { kind: 'source-keywords', format: 'csv', startAt: 0, endAt: 1000 },
    new AbortController().signal,
  );
  await response.text();
  expect(mocks.query).toHaveBeenCalledWith('FETCH FORWARD 500 FROM fixture_cursor');
  expect(mocks.execute).toHaveBeenCalledWith(
    expect.stringMatching(/^SET LOCAL statement_timeout = \d+$/),
  );
  const budget = Number(mocks.execute.mock.calls[0][0].split(' = ')[1]);
  expect(budget).toBeGreaterThan(0);
  expect(budget).toBeLessThanOrEqual(60000);
});
it('uses the keyword population for full CSV instead of the legacy summary path', async () => {
  const response = await prepareFeatureExport(
    { id: 'site', name: 'fixture', domain: 'fixture.test' },
    {
      kind: 'source-keywords',
      format: 'csv',
      startAt: 0,
      endAt: 1000,
      timezone: 'UTC',
      sort: 'keyword',
      direction: 'asc',
    },
    new AbortController().signal,
  );
  const frames = (await response.text())
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));
  expect(frames.at(-1).type).toBe('complete');
  expect(frames.find(f => f.type === 'file').manifest).toMatchObject({
    rows: 45,
    consistency: 'repeatable-read',
    createdAt: '1970-01-01T00:00:01.000Z',
  });
  const csv = Buffer.concat(
    frames.filter(f => f.type === 'chunk').map(f => Buffer.from(f.data, 'base64')),
  ).toString();
  expect(csv).toContain('word44');
  expect(csv).toContain("'=1+1");
  expect(csv).toContain('搜索引擎');
  expect(csv).toContain('统计读取时间');
  expect(csv).toContain('筛选条件');
  expect(mocks.facts).toHaveBeenCalledTimes(1);
  expect(mocks.snapshot).toHaveBeenCalledTimes(1);
});
it('applies the complete same-engine filter before export', async () => {
  const response = await prepareFeatureExport(
    { id: 'site', name: 'fixture', domain: 'fixture.test' },
    { kind: 'source-keywords', format: 'csv', startAt: 0, endAt: 1000, search: 'word44' },
    new AbortController().signal,
  );
  const frames = (await response.text())
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));
  expect(frames.find(f => f.type === 'file').manifest.rows).toBe(1);
});
it('exports the same missing, redirect and unsupported explanations as the page', async () => {
  mocks.facts.mockResolvedValueOnce({
    hasGoals: false,
    snapshot: 'fixture',
    readAt: 1000,
    rows: ['missing', 'redirect', 'unsupported'].map((status, i) => ({
      id: String(i),
      engine: '百度',
      keyword: null,
      evidence: 'none',
      status,
      sessions: 1,
      bounces: 1,
      conversions: 0,
    })),
  });
  const response = await prepareFeatureExport(
    { id: 'site', name: 'fixture', domain: 'fixture.test' },
    { kind: 'source-keywords', format: 'csv', startAt: 0, endAt: 1000, keywordStatusVersion: '2' },
    new AbortController().signal,
  );
  const frames = (await response.text())
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));
  const csv = Buffer.concat(
    frames.filter(f => f.type === 'chunk').map(f => Buffer.from(f.data, 'base64')),
  ).toString();
  expect(frames.find(f => f.type === 'file').manifest.rows).toBe(3);
  expect(csv).toContain('来源未携带搜索词');
  expect(csv).toContain('跳转链接无可用搜索词');
  expect(csv).toContain('来源格式不支持');
});
it('keeps legacy unsupported filters and exports consistent after a status upgrade', async () => {
  mocks.facts.mockResolvedValueOnce({
    hasGoals: false,
    snapshot: 'fixture',
    readAt: 1000,
    rows: ['redirect', 'unsupported'].map((status, i) => ({
      id: String(i),
      engine: '百度',
      keyword: null,
      evidence: 'none',
      status,
      sessions: i + 2,
      bounces: 1,
      conversions: 0,
    })),
  });
  const response = await prepareFeatureExport(
    { id: 'site', name: 'fixture', domain: 'fixture.test' },
    { kind: 'source-keywords', format: 'csv', startAt: 0, endAt: 1000, status: 'unsupported' },
    new AbortController().signal,
  );
  const frames = (await response.text())
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));
  const csv = Buffer.concat(
    frames.filter(f => f.type === 'chunk').map(f => Buffer.from(f.data, 'base64')),
  ).toString();
  expect(frames.find(f => f.type === 'file').manifest.rows).toBe(1);
  expect(csv).toContain('来源格式不支持,百度,无可用关键词,5,100,40,');
  expect(csv).not.toContain('跳转链接无可用搜索词');
});
it('redacts credential-shaped filters in both CSV metadata and the manifest', async () => {
  const response = await prepareFeatureExport(
    { id: 'site', name: 'fixture', domain: 'fixture.test' },
    {
      kind: 'source-keywords',
      format: 'csv',
      startAt: 0,
      endAt: 1000,
      search: '{"token":"synthetic-secret"}',
    },
    new AbortController().signal,
  );
  const frames = (await response.text())
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));
  const csv = Buffer.concat(
    frames.filter(f => f.type === 'chunk').map(f => Buffer.from(f.data, 'base64')),
  ).toString();
  expect(csv).not.toContain('synthetic-secret');
  expect(JSON.stringify(frames.find(f => f.type === 'file').manifest)).not.toContain(
    'synthetic-secret',
  );
});

it('localizes keyword display and metadata while retaining raw terms, conditions and privacy protections', async () => {
  const facts = {
    hasGoals: false,
    readAt: 1000,
    rows: [
      { id: 'known', keyword: '来源未携带搜索词', status: 'available', evidence: 'referrer' },
      { id: 'missing', keyword: null, status: 'missing', evidence: 'none' },
      { id: 'formula', keyword: '=1+1', status: 'available', evidence: 'utm' },
    ].map(row => ({ ...row, engine: '百度', sessions: 1, bounces: 0, conversions: 0 })),
  };
  mocks.facts.mockResolvedValue(facts);
  const input = {
    kind: 'source-keywords',
    format: 'csv',
    startAt: 0,
    endAt: 1000,
    keywordStatusVersion: '2',
    engine: '百度',
  };
  const read = async (locale?: string) => {
    const response = await prepareFeatureExport(
      { id: 'site', name: '客户原名', domain: 'fixture.test' },
      { ...input, ...(locale ? { locale } : {}) },
      new AbortController().signal,
    );
    const frames = (await response.text())
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    expect(frames.at(-1).type).toBe('complete');
    return {
      csv: Buffer.concat(
        frames.filter(f => f.type === 'chunk').map(f => Buffer.from(f.data, 'base64')),
      ).toString(),
      manifest: frames.find(f => f.type === 'file').manifest,
    };
  };
  const omitted = await read();
  expect((await read('zh-CN')).csv).toBe(omitted.csv);
  const english = await read('en-US');
  expect(english.csv).toContain('Statistics read at,1970-01-01T00:00:01.000Z');
  const rows = Papa.parse(english.csv.split('\r\n\r\n')[1], { header: true }).data as Record<
    string,
    string
  >[];
  expect(rows).toHaveLength(3);
  expect(rows.map(row => row['Keyword / status'])).toContain('来源未携带搜索词');
  expect(rows.map(row => row['Keyword / status'])).toContain('Source has no search term');
  expect(rows.map(row => row['Keyword / status'])).toContain("'=1+1");
  expect(rows.every(row => row['Search engine'] === 'Baidu')).toBe(true);
  expect(english.manifest.conditions).toEqual(omitted.manifest.conditions);
  expect(english.manifest.website.name).toBe('客户原名');
  expect(facts.rows[0].keyword).toBe('来源未携带搜索词');
});
