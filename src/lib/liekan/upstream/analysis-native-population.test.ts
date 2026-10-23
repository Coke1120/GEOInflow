import { beforeEach, expect, it, vi } from 'vitest';
import { getWebsiteStats } from '@/queries/sql/getWebsiteStats';
import { getSessionMetrics } from '@/queries/sql/sessions/getSessionMetrics';
import { populationFromRow } from './browser-population';

const state = vi.hoisted(() => ({
  snapshot: false,
  probeOnly: false,
  population: undefined as any,
  totals: vi.fn(),
  metrics: vi.fn(),
  readPopulation: vi.fn(),
  note: vi.fn(),
  raw: vi.fn(),
  snapshotCalls: 0,
}));
vi.mock('@/lib/db', () => ({
  PRISMA: 'prisma',
  CLICKHOUSE: 'clickhouse',
  runQuery: (queries: any) => queries.prisma(),
}));
vi.mock('@/lib/clickhouse', () => ({ default: {} }));
vi.mock('@/lib/prisma', () => ({
  default: {
    rawQuery: state.raw,
    parseFilters: () => ({ queryParams: {}, filterQuery: '' }),
    getTimestampDiffSQL: () => '0',
  },
}));
vi.mock('./analysis-rollups', () => ({
  readAnalysisVisitTotals: state.totals,
  readAnalysisVisitMetrics: state.metrics,
}));
vi.mock('./cache-context', () => ({
  currentCacheContext: () => ({ probeOnly: state.probeOnly }),
  noteBrowserPopulation: state.note,
}));
vi.mock('./native-snapshot', () => ({
  nativeSnapshot: async (load: () => unknown) => {
    expect(state.snapshot).toBe(false);
    state.snapshot = true;
    state.snapshotCalls++;
    try {
      return await load();
    } finally {
      state.snapshot = false;
    }
  },
}));
vi.mock('./browser-population', async importOriginal => ({
  ...(await importOriginal<object>()),
  readBrowserPopulation: state.readPopulation,
}));
const site = '97137013-0b7b-4a6e-94ca-d7f9e1300301';
const filters = {
  startDate: new Date('2026-10-01T00:00Z'),
  endDate: new Date('2026-10-02T00:00Z'),
  timezone: 'Asia/Shanghai',
  hostname: 'eq.example.test',
};
const totals = { pageviews: 7, visitors: 2, visits: 3, bounces: 1, totaltime: 42 };
function population(eligibleEvents: number, qualifiedEvents: number) {
  return populationFromRow(
    {
      resourceKind: 'website',
      eligibleEvents,
      qualifiedEvents,
      eligiblePV: eligibleEvents,
      qualifiedPV: qualifiedEvents,
      qualifiedVisitors: qualifiedEvents ? 2 : 0,
      identityVersions: ['browser-source-v1'],
      governanceRevision: '12',
    },
    { startAt: +filters.startDate, endAt: +filters.endDate, timezone: filters.timezone },
  );
}
beforeEach(() => {
  state.snapshot = false;
  state.snapshotCalls = 0;
  state.probeOnly = false;
  state.population = population(7, 7);
  state.note.mockReset();
  state.raw.mockReset().mockResolvedValue([{ ...totals }]);
  state.totals.mockReset().mockImplementation(async () => {
    expect(state.snapshot).toBe(true);
    return { ...totals };
  });
  state.metrics.mockReset().mockImplementation(async () => {
    expect(state.snapshot).toBe(true);
    return [{ x: 'Firefox', y: 2 }];
  });
  state.readPopulation.mockReset().mockImplementation(async () => {
    expect(state.snapshot).toBe(true);
    await Promise.resolve();
    return state.population;
  });
});
it.each([
  ['complete', 7, 7, false],
  ['partial', 7, 5, true],
  ['unavailable', 7, 0, true],
  ['empty', 0, 0, false],
] as const)('preserves %s identity availability within the same reporting snapshot', async (status, eligible, qualified, missing) => {
  state.population = population(eligible, qualified);
  const result = await getWebsiteStats(site, filters);
  expect(result).toEqual({
    ...totals,
    ...(missing ? { visitors: null, visits: null, bounces: null, totaltime: null } : {}),
    population: state.population,
  });
  expect(result.population.identity.status).toBe(status);
  expect(await getSessionMetrics(site, { type: 'browser', limit: 1, offset: 3 }, filters)).toEqual([
    { x: 'Firefox', y: missing ? null : 2 },
  ]);
  expect(state.snapshotCalls).toBe(2);
  expect(state.snapshot).toBe(false);
  expect(state.readPopulation.mock.calls).toEqual([
    [site, filters.startDate, filters.endDate, filters.timezone],
    [site, filters.startDate, filters.endDate, filters.timezone],
  ]);
  expect(state.note.mock.calls).toEqual([[site, state.population], [site, state.population]]);
  expect(state.raw).not.toHaveBeenCalled();
});
it('keeps a filtered metric and paginated distribution on whole-window population metadata', async () => {
  state.population = population(10, 3);
  await getWebsiteStats(site, filters);
  await getSessionMetrics(site, { type: 'browser', limit: 1, offset: 3 }, filters);
  expect(state.metrics).toHaveBeenCalledWith(expect.objectContaining({
    filters: { hostname: 'eq.example.test' }, type: 'browser', limit: 1, offset: 3,
  }));
  expect(state.readPopulation).toHaveBeenCalledTimes(2);
  expect(state.readPopulation.mock.calls.every(call => call.length === 4)).toBe(true);
  expect(state.note.mock.calls.every(([, value]) => value.identity.eligibleEvents === 10)).toBe(true);
});
it('uses the original exact query when the complete acceleration contract is unavailable', async () => {
  state.totals.mockResolvedValue(null);
  expect(await getWebsiteStats(site, filters)).toEqual(totals);
  expect(state.readPopulation).not.toHaveBeenCalled();
  expect(state.raw).toHaveBeenCalledTimes(1);
});
it('keeps cache-only probes away from acceleration and population computation', async () => {
  state.probeOnly = true;
  expect(await getWebsiteStats(site, filters)).toEqual(totals);
  expect(state.snapshotCalls).toBe(0);
  expect(state.totals).not.toHaveBeenCalled();
  expect(state.readPopulation).not.toHaveBeenCalled();
  expect(state.raw).toHaveBeenCalledTimes(1);
});
