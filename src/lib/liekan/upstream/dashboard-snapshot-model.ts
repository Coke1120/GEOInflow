import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import { endOfDay, startOfDay, subDays } from 'date-fns';
import { pageReportParts } from '../contracts/page-report';
import { LiekanError } from './errors';

export const DASHBOARD_INTERVAL = 5 * 60000;
export const DASHBOARD_SETTLE = 60000;
export const DASHBOARD_FORMAT = 'dashboard-snapshot-v1';

/** Closed five-minute buckets have a one-minute ingestion buffer. */
export function dashboardCutoff(now = Date.now()) {
  return Math.floor((now - DASHBOARD_SETTLE) / DASHBOARD_INTERVAL) * DASHBOARD_INTERVAL;
}

export function dashboardWindow(target: string, parameters: Record<string, any>, now = Date.now()) {
  const timezone = parameters.timezone || 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    throw new LiekanError('时区无效', 400);
  }
  const day = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
  const today = +fromZonedTime(`${day}T00:00:00`, timezone);
  const end = Number(parameters.endAt ?? +new Date(parameters.endDate));
  const start = Number(parameters.startAt ?? +new Date(parameters.startDate));
  const dedicatedToday =
    target === 'feature:page-report' && Boolean(pageReportParts[parameters.resource]?.today);
  const halfOpen = target === 'feature:page-report' && parameters.crawlerMetricsVersion === 1;
  const hot = dedicatedToday || end > today || (!halfOpen && end === today);
  const closed = dashboardCutoff(now);
  const hasClosed = closed - (halfOpen ? 0 : 1) >= start;
  const cutoff =
    hot && !hasClosed
      ? (Math.floor(start / DASHBOARD_INTERVAL) + 1) * DASHBOARD_INTERVAL
      : closed;
  const through = hot ? cutoff : end + (halfOpen ? 0 : 1);
  const effectiveEnd = Math.min(end, cutoff - (halfOpen ? 0 : 1));
  return {
    day: dedicatedToday ? day : '',
    hot,
    through,
    // First-day empty windows wait for the first closed bucket.
    computable: !hot || hasClosed,
    availableAt: cutoff + DASHBOARD_SETTLE,
    nextRefresh: (Math.floor(now / DASHBOARD_INTERVAL) + 1) * DASHBOARD_INTERVAL + DASHBOARD_SETTLE,
    parameters: hot ? { ...parameters, endAt: effectiveEnd } : parameters,
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
