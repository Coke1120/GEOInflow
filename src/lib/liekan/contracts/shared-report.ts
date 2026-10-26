import { z } from 'zod';
import { readFeatureDateRange } from '../upstream/date-range';
import { featureDateRange } from './analysis';
import {
  ACCOUNT_DEFAULT_TIMEZONE,
  isAccountDateRange,
  validateTimezone,
} from './account-preferences';
import { calendarDayRange, shiftCalendarRange } from './calendar';
import { pageReportParts } from './page-report';
import { reportQuery } from './query';
import { liekanReportSchema, type LiekanReport } from './report';

export const sharedReportParts = {
  cards: [
    ...pageReportParts['human/overview'].cards,
    'AI 蜘蛛请求',
    ...pageReportParts['human/geo'].cards,
  ],
  charts: ['d1', 'd2', 'd3', 'h1', 'h2', 'h3', 'g1', 'g2'],
  tables: ['envGrid', 'cityBody'],
  human: ['sources', 'environment', 'heatmap', 'newVisitors', 'geo', 'goals'],
  logs: ['summary', 'catalog', 'latest', 'bots', 'pages'],
  insights: true,
} as const;

export const sharedReportQuery = reportQuery
  .pick({ startAt: true, endAt: true, timezone: true, chartPeriod: true, refresh: true })
  .strict();

export const sharedReportSchema = liekanReportSchema.extend({
  charts: liekanReportSchema.shape.charts.pick({
    d1: true,
    d2: true,
    d3: true,
    h1: true,
    h2: true,
    h3: true,
    g1: true,
    g2: true,
  }),
  tables: z.object({
    envGrid: z.array(
      z.object({ category: z.string(), name: z.string(), share: z.number().nullable() }),
    ),
    cityBody: z.array(
      z.object({
        city: z.string(),
        sessions: z.number().nullable(),
        share: z.number().nullable(),
        duration: z.number().nullable(),
        bounceRate: z.number().nullable(),
        conversionRate: z.number().nullable(),
      }),
    ),
  }),
  capabilities: z.object({ goals: z.boolean() }),
});
export type SharedReport = LiekanReport & { capabilities: { goals: boolean } };

export type SharedChartPeriod = 'today' | '24h' | '7d' | '30d';
export type SharedDateRange = {
  startAt: number;
  endAt: number;
  timezone: string;
  unit: string;
  chartPeriod?: SharedChartPeriod;
};

export function sharedTimezone(parameters: Record<string, any> = {}) {
  const timezone = parameters.timezone ?? parameters.range?.timezone;
  return validateTimezone(timezone) ? timezone : ACCOUNT_DEFAULT_TIMEZONE;
}

/** Zero is Today; one retains the historical rolling 24-hour share preset. */
export function sharedDateRange(
  days = 30,
  now = Date.now(),
  timezone = ACCOUNT_DEFAULT_TIMEZONE,
): SharedDateRange {
  if (days === 1) {
    const endAt = Math.floor(now / 60000) * 60000;
    return { startAt: endAt - 86400000, endAt, timezone, unit: 'hour', chartPeriod: '24h' };
  }
  const today = calendarDayRange(now, timezone);
  const startAt =
    days === 0
      ? today.startAt
      : shiftCalendarRange(today.startAt, today.endAt, 1 - days, timezone).startAt;
  return {
    startAt,
    endAt: today.endAt,
    timezone,
    unit: days === 0 ? 'hour' : 'day',
    chartPeriod: days === 0 ? 'today' : days <= 7 ? '7d' : '30d',
  };
}

export function sharedChartPeriod(
  range: Pick<SharedDateRange, 'startAt' | 'endAt' | 'chartPeriod'>,
): SharedChartPeriod {
  return (
    range.chartPeriod ||
    (range.endAt - range.startAt <= 86400000
      ? '24h'
      : range.endAt - range.startAt <= 7 * 86400000
        ? '7d'
        : '30d')
  );
}

/** Saved share identity is independent of anonymous browser and account preferences. */
export function resolveSharedDateRange(
  parameters: Record<string, any> = {},
  now = Date.now(),
  date?: string,
): SharedDateRange {
  const timezone = sharedTimezone(parameters);
  const value = date || (typeof parameters.range === 'string' ? parameters.range : parameters.date);
  if (value === '0day' || value === 'today') return sharedDateRange(0, now, timezone);
  if (value === '24hour' || value === '24h') return sharedDateRange(1, now, timezone);
  if (isAccountDateRange(value)) {
    const parsed = readFeatureDateRange(value, '', 0, timezone, 'zh-CN', now).dateRange;
    return {
      ...featureDateRange(parsed, timezone),
      timezone,
      unit: parsed.unit || 'day',
    };
  }
  const fixed =
    typeof parameters.range === 'object' && parameters.range ? parameters.range : parameters;
  if (
    Number.isFinite(fixed.startAt) &&
    Number.isFinite(fixed.endAt) &&
    fixed.startAt <= fixed.endAt
  )
    return { startAt: fixed.startAt, endAt: fixed.endAt, timezone, unit: fixed.unit || 'day' };
  return sharedDateRange(30, now, timezone);
}
