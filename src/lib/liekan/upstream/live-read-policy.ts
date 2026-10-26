import { calendarDayRange } from '../contracts/calendar';

export const isRealtimeRead = (key: readonly unknown[]) =>
  key[0] === 'realtime' ||
  // useData places its controlled label and clock after the nine feature scope fields.
  (key[0] === 'liekan-feature' &&
    (key[9] === 'realtime-rich' || key[9] === 'realtime-series') &&
    typeof key[10] === 'number');

export function liveClockChanged(
  key: readonly any[],
  clock: { now: number; conditions: string } | undefined,
  now = Date.now(),
) {
  const report = key[0] === 'liekan' && key.length >= 15;
  if (
    !clock ||
    (!report && !['websites:stats', 'websites:pageviews', 'websites:metrics'].includes(key[0]))
  )
    return false;
  const date = String(clock.conditions || '').split('|')[0];
  if (date.startsWith('range:')) return false;
  const range = key.find(
    value => value && typeof value === 'object' && Number.isFinite(value.endAt),
  );
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: (report ? key[6] : range?.timezone) || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      ...(date.endsWith('hour') || (!date && !report)
        ? ({ hour: '2-digit', hourCycle: 'h23' } as const)
        : {}),
    });
    return formatter.format(clock.now) !== formatter.format(now);
  } catch {
    return false;
  }
}

/** Live reads keep the existing page generation, identity and authorization controls. */
export function liveReadInterval(key: readonly any[], now = Date.now()): number | false {
  if (isRealtimeRead(key)) return 10000;
  if (key[0] === 'websites:active') return 60000;
  const report = key[0] === 'liekan' && key.length >= 15;
  if (report && ['logs', 'human/keywords'].includes(key[3])) return false;
  if (report && ['overview', 'conversions'].includes(key[3])) return 30000;
  const range = report
    ? { startAt: key[4], endAt: key[5], timezone: key[6] }
    : ['websites:stats', 'websites:pageviews', 'websites:metrics'].includes(key[0])
      ? key.find(value => value && typeof value === 'object' && Number.isFinite(value.endAt))
      : undefined;
  if (!range) return false;
  try {
    const timezone = range.timezone || 'UTC';
    const today = calendarDayRange(now, timezone).startAt;
    const calendar =
      report && typeof key[15] === 'string' && key[15].endsWith(',"calendar-v2"]')
        ? key[15]
        : undefined;
    const halfOpen = calendar && JSON.parse(calendar)[1] === 1;
    return range.startAt <= now && (range.endAt > today || (!halfOpen && range.endAt === today))
      ? 30000
      : false;
  } catch {
    return false;
  }
}
