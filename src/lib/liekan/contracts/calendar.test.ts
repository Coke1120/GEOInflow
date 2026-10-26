import { describe, expect, it } from 'vitest';
import { formatInTimeZone } from 'date-fns-tz';
import { calendarDayCount, calendarDayRange, shiftCalendarRange } from './calendar';
import { featureDateRange } from './analysis';
import { readFeatureDateRange } from '../upstream/date-range';
import { getCompareDate } from '@/lib/date';

describe('Today uses account calendar boundaries', () => {
  it.each([
    ['Asia/Shanghai', '2026-10-25T07:12:00Z', '2026-10-24T16:00:00Z', 24],
    ['Asia/Tokyo', '2026-10-25T07:12:00Z', '2026-10-24T15:00:00Z', 24],
    ['Asia/Kolkata', '2026-10-25T07:12:00Z', '2026-10-24T18:30:00Z', 24],
    ['Asia/Kathmandu', '2026-10-25T07:12:00Z', '2026-10-24T18:15:00Z', 24],
    ['America/New_York', '2026-03-08T16:00:00Z', '2026-03-08T05:00:00Z', 23],
    ['America/New_York', '2026-11-01T16:00:00Z', '2026-11-01T04:00:00Z', 25],
    ['America/Santiago', '2026-09-06T12:00:00Z', '2026-09-06T04:00:00Z', 23],
    ['America/Havana', '2026-03-08T12:00:00Z', '2026-03-08T05:00:00Z', 23],
    ['America/Havana', '2026-11-01T12:00:00Z', '2026-11-01T04:00:00Z', 25],
  ])('%s matches the actual date picker on %s', (timezone, at, start, hours) => {
    const range = calendarDayRange(Date.parse(at), timezone);
    expect(range.startAt).toBe(Date.parse(start));
    expect(range.endAt + 1 - range.startAt).toBe(hours * 3600000);
    expect(calendarDayCount(range.startAt, range.endAt, timezone)).toBe(1);
    const picked = featureDateRange(
      readFeatureDateRange('0day', '', 0, timezone, 'en-US', Date.parse(at)).dateRange,
      timezone,
    );
    expect({ startAt: picked.startAt, endAt: picked.endAt }).toEqual(range);
    expect(calendarDayRange(Date.parse(at) + 10000, timezone)).toEqual(range);
  });
  it('moves to the new local date across month and year boundaries', () => {
    const before = calendarDayRange(Date.parse('2026-12-31T15:59:59Z'), 'Asia/Shanghai');
    const after = calendarDayRange(Date.parse('2026-12-31T16:00:00Z'), 'Asia/Shanghai');
    expect(after.startAt).toBe(before.endAt + 1);
    expect(formatInTimeZone(after.startAt, 'Asia/Shanghai', 'yyyy-MM-dd')).toBe('2027-01-01');
  });
  it('compares the same local day across a DST change', () => {
    const range = calendarDayRange(Date.parse('2026-03-08T16:00Z'), 'America/New_York');
    const shifted = shiftCalendarRange(range.startAt, range.endAt, -7, 'America/New_York');
    expect(shifted).toEqual(calendarDayRange(Date.parse('2026-03-01T16:00Z'), 'America/New_York'));
  });
  it('compares Today with yesterday without dropping the final minute', () => {
    const picked = readFeatureDateRange(
      '0day',
      '',
      0,
      'Asia/Shanghai',
      'en-US',
      Date.parse('2026-10-25T09:00Z'),
    ).dateRange;
    const previous = getCompareDate('prev', picked.startDate, picked.endDate, true);
    const range = featureDateRange({ ...picked, ...previous }, 'Asia/Shanghai');
    expect(range.startAt).toBe(Date.parse('2026-10-23T16:00Z'));
    expect(range.endAt).toBe(Date.parse('2026-10-24T15:59:59.999Z'));
  });
  it('keeps an explicit legacy 24-hour selection rolling', () => {
    const read = Date.parse('2026-10-25T07:12Z');
    const old = featureDateRange(
      readFeatureDateRange('24hour', '', 0, 'Asia/Shanghai', 'en-US', read).dateRange,
      'Asia/Shanghai',
    );
    expect(old.startAt).toBeLessThan(calendarDayRange(read, 'Asia/Shanghai').startAt);
  });
});

it.each(['2026-03-08T16:00Z', '2026-11-01T16:00Z'])(
  'compares native Today across DST at %s',
  at => {
    const timezone = 'America/New_York';
    const day = calendarDayRange(Date.parse(at), timezone);
    const before = getCompareDate('prev', new Date(day.startAt), new Date(day.endAt), timezone);
    expect(+before.startDate).toBe(
      shiftCalendarRange(day.startAt, day.endAt, -1, timezone).startAt,
    );
    expect(+before.endDate).toBe(day.startAt - 1);
  },
);

it('uses a full local day for Today year-over-year comparison', () => {
  const day = calendarDayRange(Date.parse('2026-03-08T16:00Z'), 'America/New_York');
  const comparison = getCompareDate(
    'yoy',
    new Date(day.startAt),
    new Date(day.endAt),
    'America/New_York',
  );
  expect(+comparison.startDate).toBe(Date.parse('2025-03-08T05:00Z'));
  expect(+comparison.endDate).toBe(Date.parse('2025-03-09T04:59:59.999Z'));
});
