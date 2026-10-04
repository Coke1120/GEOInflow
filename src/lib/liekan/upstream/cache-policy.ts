import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export function statisticsCacheTtl(end: number | Date, timezone = 'UTC', now = Date.now()) {
  const today = +fromZonedTime(
    `${formatInTimeZone(now, timezone, 'yyyy-MM-dd')}T00:00:00`,
    timezone,
  );
  return +end < today ? 300000 : 30000;
}
