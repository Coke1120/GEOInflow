import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import { endOfDay, startOfDay, subDays } from 'date-fns';
import { pageReportParts } from '../contracts/page-report';
import { LiekanError } from './errors';
import { readFeatureDateRange } from './date-range';
import { featureDateRange } from '../contracts/analysis';
import { calendarDayRange } from '../contracts/calendar';

export const DASHBOARD_INTERVAL = 30000;
export const DASHBOARD_SETTLE = 0;
export const DASHBOARD_FORMAT = 'dashboard-snapshot-v3';
export const dashboardInterval = (target: string) =>
  [
    'native:heatmaps',
    'native:retention',
    'native:journeys',
    'native:funnels/stats',
    'native:attribution',
    'feature:journeys',
    'feature:analytics',
  ].includes(target)
    ? 300000
    : DASHBOARD_INTERVAL;

/** Read current facts through a completed short window; late data retains its correction fence. */
export function dashboardCutoff(now = Date.now(), interval = DASHBOARD_INTERVAL) {
  return Math.floor((now - DASHBOARD_SETTLE) / interval) * interval;
}

/** Reuse a live PostgreSQL monthly retention selection within its captured closed window. */
export function canonicalDashboardParameters(
  target: string,
  parameters: Record<string, any>,
  now = Date.now(),
) {
  if (target !== 'native:retention') return parameters;
  const { startAt, endAt, timezone = 'UTC' } = parameters;
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) return parameters;
  const month = formatInTimeZone(now, timezone, 'yyyy-MM');
  const monthStart = +fromZonedTime(`${month}-01T00:00:00`, timezone);
  const next = new Date(`${month}-01T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const monthEnd = +fromZonedTime(`${next.toISOString().slice(0, 10)}T00:00:00`, timezone) - 1;
  const closedEnd = dashboardCutoff(now, dashboardInterval(target)) - 1;
  if (startAt !== monthStart || closedEnd < monthStart || endAt < closedEnd || endAt > monthEnd)
    return parameters;
  return endAt === closedEnd ? parameters : { ...parameters, endAt: closedEnd };
}

export function dashboardWindow(
  target: string,
  parameters: Record<string, any>,
  now = Date.now(),
  live = true,
  minimumThrough = 0,
) {
  const timezone = parameters.timezone || 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    throw new LiekanError('时区无效', 400);
  }
  const day = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
  const today = calendarDayRange(now, timezone).startAt;
  const end = Number(parameters.endAt ?? +new Date(parameters.endDate));
  const start = Number(parameters.startAt ?? +new Date(parameters.startDate));
  const dedicatedToday =
    target === 'feature:page-report' && Boolean(pageReportParts[parameters.resource]?.today);
  const halfOpen = target === 'feature:page-report' && parameters.crawlerMetricsVersion === 1;
  const interval = live ? dashboardInterval(target) : 300000;
  const closed = dashboardCutoff(now, interval);
  const fixedRetention = target === 'native:retention' && end < closed;
  const hot = !fixedRetention && (dedicatedToday || end > today || (!halfOpen && end === today));
  const hasClosed = closed - (halfOpen ? 0 : 1) >= start;
  const proposed = hot && !hasClosed ? (Math.floor(start / interval) + 1) * interval : closed;
  const cutoff = hot ? Math.max(proposed, minimumThrough) : proposed;
  const through = hot
    ? cutoff
    : fixedRetention
      ? Math.max(end + 1, minimumThrough)
      : end + (halfOpen ? 0 : 1);
  const effectiveEnd = Math.min(end, cutoff - (halfOpen ? 0 : 1));
  return {
    day: dedicatedToday ? day : '',
    hot,
    through,
    // First-day empty windows wait for the first closed bucket.
    computable: !hot || hasClosed,
    availableAt: cutoff + DASHBOARD_SETTLE,
    nextRefresh: (Math.floor(now / interval) + 1) * interval + DASHBOARD_SETTLE,
    parameters:
      hot && target !== 'feature:page-report' ? { ...parameters, endAt: effectiveEnd } : parameters,
    // Entry attribution, comparison periods and six-month trends can depend on earlier facts.
    dependencyEnd: hot
      ? Math.max(effectiveEnd + (halfOpen ? 0 : 1), dedicatedToday ? cutoff : 0)
      : end + (halfOpen ? 0 : 1),
  };
}

export function defaultDashboardRange(timezone: string, now = Date.now()) {
  const local = toZonedTime(new Date(now), timezone);
  return {
    startAt: +fromZonedTime(startOfDay(subDays(local, 29)), timezone),
    endAt: +fromZonedTime(endOfDay(local), timezone),
  };
}

/** Match the existing date picker, including hour boundaries and inclusive natural days. */
export function dashboardWarmRanges(timezone: string, now = Date.now()) {
  return [
    ...['0day', '7day', '30day'].map(value => {
      const { dateRange } = readFeatureDateRange(value, '', 0, timezone, 'zh-CN', now);
      const { startAt, endAt } = featureDateRange(dateRange, timezone);
      return { startAt, endAt };
    }),
  ];
}
