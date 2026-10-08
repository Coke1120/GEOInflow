import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

const DAY_MS = 86400000;
// 预计今日按已流逝进度折算；凌晨至少按 10 分钟进度，避免刚开日时数值爆炸。
const MIN_PROJECTED_MS = 600000;

/** Exact [today 00:00, tomorrow 00:00) window in the site timezone. */
export function websiteDayWindow(timezone: string, now = Date.now()) {
  const day = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
  const startAt = +fromZonedTime(`${day}T00:00:00`, timezone);
  return { startAt, endAt: startAt + DAY_MS, timezone };
}

/** End-of-day projection: measured value divided by elapsed day progress. */
export function projectToday(
  value: number | null | undefined,
  timezone: string,
  now = Date.now(),
): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const { startAt } = websiteDayWindow(timezone, now);
  const progress = Math.min(DAY_MS, Math.max(MIN_PROJECTED_MS, now - startAt)) / DAY_MS;
  return Math.round(value / progress);
}

/** 1 = projected today above yesterday, -1 = below, 0 = flat or unknown. */
export function projectTrend(
  estimate: number | null,
  yesterday: number | null | undefined,
): -1 | 0 | 1 {
  if (estimate == null || yesterday == null || !Number.isFinite(yesterday)) return 0;
  return estimate > yesterday ? 1 : estimate < yesterday ? -1 : 0;
}
