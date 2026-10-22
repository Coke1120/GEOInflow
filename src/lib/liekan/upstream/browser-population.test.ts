import { describe, expect, it } from 'vitest';
import { applyNativePopulation, populationFromRow } from './browser-population';
const range = { startAt: 0, endAt: 1000, timezone: 'UTC' };
const population = (overrides = {}) =>
  populationFromRow(
    {
      resourceKind: 'website',
      eligibleEvents: 4,
      qualifiedEvents: 4,
      eligiblePV: 3,
      qualifiedPV: 3,
      qualifiedVisitors: 2,
      ...overrides,
    },
    range,
  );
describe('browser identity availability', () => {
  it('retains complete totals and a separately deduplicated reliable subset', () => {
    const meta = population();
    expect(meta.identity).toMatchObject({ status: 'complete', coverage: 1, qualifiedVisitors: 2 });
    expect(
      applyNativePopulation(
        [{ pageviews: 3, visitors: 2, visits: 2, bounces: 1, totaltime: 5 }],
        'getWebsiteStats',
        meta,
      )[0],
    ).toMatchObject({ pageviews: 3, visitors: 2, visits: 2 });
  });
  it('keeps PV while withholding whole-window identities with even one missing custom event', () => {
    const meta = population({ qualifiedEvents: 3 });
    expect(meta.identity).toMatchObject({ status: 'partial', coverage: 1 });
    expect(
      applyNativePopulation(
        [{ pageviews: 3, visitors: 2, visits: 2, bounces: 1, totaltime: 5 }],
        'getWebsiteStats',
        meta,
      )[0],
    ).toMatchObject({ pageviews: 3, visitors: null, visits: null, bounces: null, totaltime: null });
    expect(applyNativePopulation([{ x: 'CN', y: 2 }], 'getSessionMetrics', meta)[0].y).toBeNull();
    expect(applyNativePopulation([{ x: '/', y: 3 }], 'getPageviewStats', meta)[0].y).toBe(3);
  });
  it('distinguishes unavailable identities and empty windows', () => {
    expect(
      population({ qualifiedEvents: 0, qualifiedPV: 0, qualifiedVisitors: 0 }).identity,
    ).toMatchObject({ status: 'unavailable', coverage: 0 });
    expect(
      population({
        eligibleEvents: 0,
        qualifiedEvents: 0,
        eligiblePV: 0,
        qualifiedPV: 0,
        qualifiedVisitors: 0,
      }).identity,
    ).toMatchObject({ status: 'empty', coverage: null });
  });
});

it('reports current-epoch processing independently of confirmed exclusion boundaries', () => {
  const processing = { computedAt: new Date(2000), nextWindow: new Date(1000), errorCode: null };
  const expected = {
    state: 'observed',
    computedAt: new Date(2000).toISOString(),
    nextWindow: new Date(1000).toISOString(),
    errorCode: null,
  };
  expect(
    population({ governanceWatermark: null, governanceProcessing: processing })
      .governanceProcessing,
  ).toEqual(expected);
  expect(
    population({ governanceWatermark: new Date(500), governanceProcessing: processing })
      .governanceProcessing,
  ).toEqual(expected);
  expect(population({ governanceProcessing: null }).governanceProcessing).toEqual({
    state: 'unknown',
    computedAt: null,
    nextWindow: null,
    errorCode: null,
  });
});

it('keeps inclusive and half-open window cache entries separate on one executor', async () => {
  const { readBrowserPopulation } = await import('./browser-population');
  const calls: string[] = [];
  const tx = {
    $queryRawUnsafe: async (sql: string) => {
      calls.push(sql);
      return [
        {
          eligibleEvents: sql.includes('BETWEEN') ? 2 : 1,
          qualifiedEvents: 1,
          eligiblePV: sql.includes('BETWEEN') ? 2 : 1,
          qualifiedPV: 1,
          qualifiedVisitors: 1,
        },
      ];
    },
  };
  const inclusive = await readBrowserPopulation('site', new Date(0), new Date(1000), 'UTC', tx);
  const halfOpen = await readBrowserPopulation('site', new Date(0), new Date(1000), 'UTC', tx, {
    halfOpen: true,
  });
  const cached = await readBrowserPopulation('site', new Date(0), new Date(1000), 'UTC', tx, {
    halfOpen: true,
  });
  expect(inclusive.identity.status).toBe('partial');
  expect(halfOpen.identity.status).toBe('complete');
  expect(cached).toBe(halfOpen);
  expect(calls).toHaveLength(2);
  expect(calls[1]).toContain('e.created_at < $3::timestamptz');
});
