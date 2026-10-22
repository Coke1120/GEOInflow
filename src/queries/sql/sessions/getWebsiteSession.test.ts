import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getWebsiteSession } from './getWebsiteSession';
import { getSessionActivity } from './getSessionActivity';
import { getSessionData } from './getSessionData';
import { populationFromRow } from '@/lib/liekan/upstream/browser-population';
const mocks = vi.hoisted(() => ({ rows: vi.fn(), population: vi.fn() }));
vi.mock('@/lib/db', () => ({
  PRISMA: 'prisma',
  CLICKHOUSE: 'clickhouse',
  runQuery: (queries: any) => queries.prisma(),
}));
vi.mock('@/lib/clickhouse', () => ({ default: {} }));
vi.mock('@/lib/prisma', () => ({
  default: { rawQuery: mocks.rows, getTimestampDiffSQL: () => 'duration' },
}));
vi.mock('@/lib/liekan/upstream/native-snapshot', () => ({
  nativeSnapshot: (work: () => unknown) => work(),
}));
vi.mock('@/lib/liekan/upstream/browser-population', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/liekan/upstream/browser-population')>()),
  readBrowserPopulation: mocks.population,
}));
const firstAt = new Date(1000),
  lastAt = new Date(2000);
beforeEach(() => {
  mocks.rows
    .mockReset()
    .mockResolvedValue([
      { id: 'session', firstAt, lastAt, visits: 2, totaltime: 3, views: 4, events: 1 },
    ]);
  mocks.population.mockReset();
});
describe('native session detail availability', () => {
  it('withholds identity metrics across the observed session resource window while retaining event measures', async () => {
    const population = populationFromRow(
      {
        resourceKind: 'website',
        eligibleEvents: 4,
        qualifiedEvents: 2,
        eligiblePV: 4,
        qualifiedPV: 2,
        qualifiedVisitors: 1,
      },
      { startAt: 1000, endAt: 2000, timezone: 'UTC' },
    );
    mocks.population.mockResolvedValue(population);
    expect(await getWebsiteSession('site', 'session')).toMatchObject({
      visits: null,
      totaltime: null,
      views: 4,
      events: 1,
      population,
    });
    expect(mocks.population).toHaveBeenCalledWith('site', firstAt, lastAt, 'UTC');
  });
  it('retains complete details and absent sessions', async () => {
    mocks.population.mockResolvedValue(
      populationFromRow(
        {
          resourceKind: 'website',
          eligibleEvents: 4,
          qualifiedEvents: 4,
          eligiblePV: 4,
          qualifiedPV: 4,
          qualifiedVisitors: 1,
        },
        { startAt: 1000, endAt: 2000, timezone: 'UTC' },
      ),
    );
    expect(await getWebsiteSession('site', 'session')).toMatchObject({
      visits: 2,
      totaltime: 3,
      views: 4,
    });
    mocks.rows.mockResolvedValue([]);
    expect(await getWebsiteSession('site', 'missing')).toBeUndefined();
  });
});

it('withholds activity and properties for unreliable associations while preserving known custom numeric values', async () => {
  const population = populationFromRow(
    { eligibleEvents: 4, qualifiedEvents: 2, eligiblePV: 4, qualifiedPV: 2, qualifiedVisitors: 1 },
    { startAt: 1000, endAt: 2000, timezone: 'UTC' },
  );
  mocks.population.mockResolvedValue(population);
  expect(
    await getSessionActivity('site', ['session'], { startDate: firstAt, endDate: lastAt }),
  ).toEqual([]);
  expect(mocks.rows).not.toHaveBeenCalled();
  expect(await getSessionData('site', 'session')).toEqual([]);
  expect(mocks.rows).toHaveBeenCalledTimes(1);
  mocks.rows.mockReset().mockResolvedValue([{ visits: 2, numberValue: 23.5 }]);
  mocks.population.mockResolvedValue({
    ...population,
    identity: { ...population.identity, status: 'complete' },
  });
  expect(
    await getSessionActivity('site', ['session'], { startDate: firstAt, endDate: lastAt }),
  ).toEqual([{ visits: 2, numberValue: 23.5 }]);
  mocks.rows
    .mockReset()
    .mockResolvedValueOnce([{ firstAt, lastAt }])
    .mockResolvedValueOnce([{ dataKey: 'visits', numberValue: 23.5 }]);
  expect(await getSessionData('site', 'session')).toEqual([
    { dataKey: 'visits', numberValue: 23.5 },
  ]);
});
