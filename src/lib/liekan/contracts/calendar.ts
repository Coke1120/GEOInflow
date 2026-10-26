import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { format } from 'date-fns';

export const CALENDAR_POLICY_VERSION = 'account-calendar-v1';

function shiftDate(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Local calendar boundaries remain valid on 23-hour and 25-hour days. */
function calendarBoundary(day: string, timezone: string) {
  const candidate = +fromZonedTime(`${day}T00:00:00`, timezone);
  if (
    formatInTimeZone(candidate, timezone, 'yyyy-MM-dd') === day &&
    formatInTimeZone(candidate - 1, timezone, 'yyyy-MM-dd') < day
  )
    return candidate;
  // Some zones advance their clocks at midnight. Locate the first valid instant of that date.
  let low = candidate - 36 * 3600000,
    high = candidate + 36 * 3600000;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (formatInTimeZone(mid, timezone, 'yyyy-MM-dd') < day) low = mid;
    else high = mid;
  }
  return high;
}

export function calendarDateRange(day: string, timezone: string) {
  const startAt = calendarBoundary(day, timezone);
  const nextAt = calendarBoundary(shiftDate(day, 1), timezone);
  return { startAt, endAt: nextAt - 1 };
}

export function calendarDayRange(now: number, timezone: string) {
  return calendarDateRange(formatInTimeZone(now, timezone, 'yyyy-MM-dd'), timezone);
}

/** Convert picker wall dates, including calendars whose midnight is skipped. */
export function calendarDateTimeToUtc(date: Date, timezone: string) {
  return format(date, 'HH:mm:ss.SSS') === '00:00:00.000'
    ? calendarDateRange(format(date, 'yyyy-MM-dd'), timezone).startAt
    : +fromZonedTime(date, timezone);
}

export function shiftCalendarRange(startAt: number, endAt: number, days: number, timezone: string) {
  const shift = (at: number) => {
    const day = shiftDate(formatInTimeZone(at, timezone, 'yyyy-MM-dd'), days);
    const time = formatInTimeZone(at, timezone, 'HH:mm:ss.SSS');
    if (at === startAt && at === calendarDayRange(at, timezone).startAt)
      return calendarDateRange(day, timezone).startAt;
    return time === '00:00:00.000'
      ? calendarDateRange(day, timezone).startAt
      : time === '23:59:59.999'
        ? calendarDateRange(day, timezone).endAt
        : +fromZonedTime(`${day}T${time}`, timezone);
  };
  return { startAt: shift(startAt), endAt: shift(endAt) };
}

export function calendarDayCount(startAt: number, endAt: number, timezone: string) {
  const day = (at: number) =>
    +new Date(`${formatInTimeZone(at, timezone, 'yyyy-MM-dd')}T00:00:00Z`);
  return Math.max(1, Math.round((day(endAt) - day(startAt)) / 86400000) + 1);
}
