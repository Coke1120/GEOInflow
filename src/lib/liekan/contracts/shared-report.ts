import { z } from 'zod';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
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
  .pick({ startAt: true, endAt: true, timezone: true, chartPeriod: true })
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
        sessions: z.number(),
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

export function sharedDateRange(days = 30, now = Date.now()) {
  const timezone = 'Asia/Shanghai';
  const endAt =
    days === 1
      ? Math.floor(now / 60000) * 60000
      : +fromZonedTime(`${formatInTimeZone(now, timezone, 'yyyy-MM-dd')}T23:59:59.999`, timezone);
  const startAt =
    days === 1
      ? endAt - 86400000
      : +fromZonedTime(
          `${formatInTimeZone(now - (days - 1) * 86400000, timezone, 'yyyy-MM-dd')}T00:00:00`,
          timezone,
        );
  return { startAt, endAt, timezone, unit: days === 1 ? 'hour' : 'day' };
}
