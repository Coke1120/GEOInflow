import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { startOfDay, subDays } from 'date-fns';
import { observationQuerySchema } from '../contracts/traffic-evidence';
import { LiekanError } from '../upstream/errors';
export function parseObservationQuery(value: unknown, now = Date.now()) {
  const parsed = observationQuerySchema.safeParse(value);
  if (!parsed.success) throw new LiekanError('统计条件无效', 400);
  const p = parsed.data;
  try {
    new Intl.DateTimeFormat('en', { timeZone: p.timezone });
  } catch {
    throw new LiekanError('时区无效', 400);
  }
  const endAt =
    p.endAt ??
    fromZonedTime(startOfDay(toZonedTime(new Date(now), p.timezone)), p.timezone).getTime();
  const startAt =
    p.startAt ??
    fromZonedTime(subDays(toZonedTime(new Date(endAt), p.timezone), 7), p.timezone).getTime();
  if (startAt >= endAt || endAt > now || startAt < now - 30 * 86400000)
    throw new LiekanError('观察窗口需要在最近 30 天内', 400);
  return { ...p, startAt, endAt };
}
