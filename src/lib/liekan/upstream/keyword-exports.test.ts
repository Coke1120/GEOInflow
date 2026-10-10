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
