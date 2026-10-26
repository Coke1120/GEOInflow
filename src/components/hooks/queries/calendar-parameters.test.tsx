import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { toZonedTime } from 'date-fns-tz';
import { useAnalyticsQuery } from './useAnalyticsQuery';
import { useWebsiteValuesQuery } from './useWebsiteValuesQuery';

const h = vi.hoisted(() => ({
  dates: {
    startAt: 0,
    endAt: 1,
    timezone: 'Asia/Shanghai',
    unit: 'day',
    datesAreLocal: true,
    displayStartAt: undefined as number | undefined,
    displayEndAt: undefined as number | undefined,
  },
  get: vi.fn(async (..._args: any[]) => []),
}));
vi.mock('../useDateParameters', () => ({ useDateParameters: () => h.dates }));
vi.mock('../useApi', () => ({
  useApi: () => ({ get: h.get, useQuery: (options: any) => options }),
}));
vi.mock('../useFilterParameters', () => ({ useFilterParameters: () => ({}) }));
vi.mock('../useModified', () => ({ useModified: () => ({ modified: 0 }) }));
vi.mock('../useLocale', () => ({ useLocale: () => ({ locale: 'en-US' }) }));
vi.mock('../useCountryNames', () => ({ useCountryNames: () => ({ countryNames: {} }) }));
vi.mock('../useRegionNames', () => ({ useRegionNames: () => ({ regionNames: {} }) }));
beforeEach(() => {
  vi.clearAllMocks();
  h.dates.timezone = 'Asia/Shanghai';
  h.dates.datesAreLocal = true;
  h.dates.displayStartAt = undefined;
  h.dates.displayEndAt = undefined;
});

it.each(['Asia/Shanghai', 'America/New_York'])(
  'uses pinned %s bounds for date overrides and lookup queries',
  async timezone => {
    h.dates.timezone = timezone;
    const start = Date.parse('2026-10-01T16:00Z'),
      end = start + 3600000;
    const dates = { startDate: toZonedTime(start, timezone), endDate: toZonedTime(end, timezone) };
    const query = renderHook(() => useAnalyticsQuery('goals', { websiteId: 'site', ...dates }))
      .result.current as any;
    await query.queryFn({});
    expect(h.get.mock.calls.at(-1)[1]).toMatchObject({ startAt: start, endAt: end, timezone });
    expect(h.get.mock.calls.at(-1)[1]).not.toHaveProperty('datesAreLocal');
    const values = renderHook(() =>
      useWebsiteValuesQuery({ websiteId: 'site', type: 'path', ...dates }),
    ).result.current as any;
    await values.queryFn({});
    expect(h.get.mock.calls.at(-1)[1]).toMatchObject({ startAt: start, endAt: end });
  },
);
it('retains explicit private custom epochs', async () => {
  h.dates.datesAreLocal = false;
  const start = Date.parse('2026-10-01T16:00Z'),
    end = start + 3600000;
  const query = renderHook(() =>
    useAnalyticsQuery('goals', {
      websiteId: 'site',
      startDate: new Date(start),
      endDate: new Date(end),
    }),
  ).result.current as any;
  await query.queryFn({});
  expect(h.get.mock.calls.at(-1)[1]).toMatchObject({ startAt: start, endAt: end });
});
it('uses the first valid instant when a picker date has a skipped midnight', async () => {
  h.dates.timezone = 'America/Santiago';
  const query = renderHook(() =>
    useAnalyticsQuery('goals', { websiteId: 'site', startDate: new Date(2026, 8, 6, 0, 0, 0, 0) }),
  ).result.current as any;
  await query.queryFn({});
  expect(h.get.mock.calls.at(-1)[1].startAt).toBe(Date.parse('2026-09-06T04:00Z'));
});

it('retains the second repeated hour of a saved public custom range', async () => {
  h.dates.timezone = 'America/New_York';
  const start = Date.parse('2026-11-01T06:30Z'),
    end = Date.parse('2026-11-01T07:00Z');
  const dates = {
    startDate: toZonedTime(start, h.dates.timezone),
    endDate: toZonedTime(end, h.dates.timezone),
  };
  Object.assign(h.dates, {
    startAt: start,
    endAt: end,
    displayStartAt: +dates.startDate,
    displayEndAt: +dates.endDate,
  });
  const q = renderHook(() => useAnalyticsQuery('goals', { websiteId: 'site', ...dates })).result
    .current as any;
  await q.queryFn({});
  expect(h.get.mock.calls.at(-1)[1]).toMatchObject({ startAt: start, endAt: end });
  const values = renderHook(() =>
    useWebsiteValuesQuery({ websiteId: 'site', type: 'path', ...dates }),
  ).result.current as any;
  await values.queryFn({});
  expect(h.get.mock.calls.at(-1)[1]).toMatchObject({ startAt: start, endAt: end });
});
