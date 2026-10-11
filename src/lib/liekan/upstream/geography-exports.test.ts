import { beforeEach, expect, test, vi } from 'vitest';
import Papa from 'papaparse';
const mocks = vi.hoisted(() => ({ facts: vi.fn(), snapshot: vi.fn(fn => fn()) }));
vi.mock('./analytics', () => ({ getHumanFacts: mocks.facts }));
vi.mock('./server', () => ({
  reportSnapshot: mocks.snapshot,
  LiekanError: class extends Error {
    constructor(
      message,
      public status = 400,
    ) {
      super(message);
    }
  },
}));
vi.mock('@/lib/prisma', () => ({ default: {}, getRawQueryClient: vi.fn() }));
vi.mock('@/lib/request', () => ({ getQueryFilters: vi.fn() }));
vi.mock('@/queries/sql', () => ({ getWebsiteStats: vi.fn() }));
vi.mock('@/queries/prisma', () => ({ getWebsiteSegment: vi.fn() }));
import { prepareFeatureExport } from './feature-exports';
const website = { id: 'fixture', name: 'fixture', domain: 'fixture.test' };
const input = { kind: 'geography', format: 'csv', startAt: 0, endAt: 1000, timezone: 'UTC' };
beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CLICKHOUSE_URL;
  mocks.facts.mockResolvedValue({
    totals: { visits: 47 },
    goals: [],
    geo: [
      {
        country: 'CN',
        region: 'CN-SN',
        city: "Xi'an",
        sessions: 2,
        duration: 10,
        bounces: 1,
        conversions: 0,
      },
      {
        country: 'CN',
        region: 'CN-61',
        city: '西安',
        sessions: 1,
        duration: 40,
        bounces: 0,
        conversions: 0,
      },
      ...Array.from({ length: 44 }, (_, i) => ({
        country: 'CN',
        region: 'CN-GD',
        city: i === 0 ? '=1+1' : `Unlisted ${i}`,
        sessions: 1,
        duration: 0,
        bounces: 1,
        conversions: 0,
      })),
    ],
  });
});
async function read(body = input) {
  const response = await prepareFeatureExport(website, body, new AbortController().signal);
  const frames = (await response.text())
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));
  expect(frames.at(-1).type).toBe('complete');
  const csv = Buffer.concat(
    frames.filter(frame => frame.type === 'chunk').map(frame => Buffer.from(frame.data, 'base64')),
  ).toString();
  return {
    csv,
    rows: Papa.parse(csv, { header: true }).data,
    file: frames.find(frame => frame.type === 'file'),
  };
}
test('exports the complete merged city population with six visible metrics and safe cells', async () => {
  const { csv, rows, file } = await read();
  expect(rows).toHaveLength(45);
  expect(file.manifest).toMatchObject({ rows: 45, consistency: 'repeatable-read' });
  expect(Object.keys(rows[0])).toEqual([
    '城市',
    '会话',
    '占比(%)',
    '平均时长(秒)',
    '跳出率(%)',
    '转化率(%)',
  ]);
  expect(rows[0]).toMatchObject({ 城市: '西安', 会话: '3', '平均时长(秒)': '20' });
  expect(csv).toContain("'=1+1");
  expect(csv).toContain('Unlisted 43');
  expect(mocks.snapshot).toHaveBeenCalledTimes(1);
  expect(mocks.facts).toHaveBeenCalledWith(
    'fixture',
    new Date(0),
    new Date(1000),
    'UTC',
    ['geo', 'goals'],
    { rows: 100000, bytes: 50 * 1024 * 1024 },
  );
});
test('uses the same full search and sort selection as the geography table', async () => {
  const { rows } = await read({
    ...input,
    search: 'Xian',
    geoSort: 'duration',
    direction: 'asc',
  } as any);
  expect(rows).toHaveLength(1);
  expect(rows[0]['城市']).toBe('西安');
});
test('validates capability, dates, timezone and cancellation before reading geography', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(prepareFeatureExport(website, input, controller.signal)).rejects.toMatchObject({
    status: 499,
  });
  await expect(
    prepareFeatureExport(website, { ...input, timezone: 'invalid' }, new AbortController().signal),
  ).rejects.toThrow('时区');
  process.env.CLICKHOUSE_URL = 'http://fixture.test';
  await expect(
    prepareFeatureExport(website, input, new AbortController().signal),
  ).rejects.toMatchObject({ status: 501 });
  expect(mocks.facts).not.toHaveBeenCalled();
});

test('redacts raw addresses and credential-shaped geography values and search metadata', async () => {
  mocks.facts.mockResolvedValue({
    totals: { visits: 2 },
    goals: [],
    geo: [
      { country: 'CN', city: '192.0.2.1', sessions: 1, duration: 0, bounces: 1, conversions: 0 },
      {
        country: 'CN',
        city: '{"token":"synthetic-secret"}',
        sessions: 1,
        duration: 0,
        bounces: 1,
        conversions: 0,
      },
    ],
  });
  const { csv } = await read();
  expect(csv).toContain('[已脱敏]');
  expect(csv).not.toContain('192.0.2.1');
  expect(csv).not.toContain('synthetic-secret');
  const { file } = await read({ ...input, search: '{"token":"synthetic-secret"}' } as any);
  expect(JSON.stringify(file.manifest)).not.toContain('synthetic-secret');
});
