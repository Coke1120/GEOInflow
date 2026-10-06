import { z } from 'zod';
export const dataStateSchema = z.enum([
  'available',
  'empty',
  'not_connected',
  'unsupported',
  'estimated',
]);
export type DataState = z.infer<typeof dataStateSchema>;
export type Row = Record<string, string | number | null | boolean>;
export interface LiekanReport {
  contractVersion: 1;
  website: { id: string; name: string; domain: string; siteNumber?: number | null };
  range: { startAt: number; endAt: number; timezone: string };
  states: { human: DataState; logs: DataState; catalog: DataState; goals: DataState };
  cards: Array<{
    key: string;
    label: string;
    value: number | string | null;
    unit?: string;
    detail?: string;
    state: DataState;
  }>;
  charts: Record<
    string,
    {
      labels: string[];
      series: Array<{ name: string; values: Array<number | null> }>;
      rows?: Record<string, unknown>[];
      state?: DataState;
    }
  >;
  tables: Record<string, Row[]>;
  insights: string[];
  meta: {
    demo: boolean;
    canManage: boolean;
    latestImportAt: string | null;
    ruleCount: number;
    aiCrawlerEnabled?: boolean;
    logsConfigured?: boolean;
    totalLogs?: number;
    page?: number;
    pageSize?: number;
    nextCursor?: string;
    previousCursor?: string;
  };
}

const chartSchema = z.object({
  labels: z.array(z.string()),
  series: z.array(z.object({ name: z.string(), values: z.array(z.number().nullable()) })),
  rows: z.array(z.record(z.string(), z.unknown())).optional(),
  state: dataStateSchema.optional(),
});
export const chartIds = [
  'd1',
  'd2',
  'd3',
  'a1',
  'a2',
  'a3',
  'a4',
  'b1',
  'ap1',
  'pf1',
  'pf2',
  'h1',
  'h2',
  'h3',
  'g1',
  'g2',
  's1',
  's2',
  'c1',
  'f1',
  'f2',
  'f3',
] as const;
export const liekanReportSchema = z.object({
  contractVersion: z.literal(1),
  website: z.object({
    id: z.uuid(),
    name: z.string(),
    domain: z.string(),
    siteNumber: z.number().int().nullable().optional(),
  }),
  range: z.object({ startAt: z.number(), endAt: z.number(), timezone: z.string() }),
  states: z.object({
    human: dataStateSchema,
    logs: dataStateSchema,
    catalog: dataStateSchema,
    goals: dataStateSchema,
  }),
  cards: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      value: z.union([z.number(), z.string(), z.null()]),
      unit: z.string().optional(),
      detail: z.string().optional(),
      state: dataStateSchema,
    }),
  ),
  charts: z.object(
    Object.fromEntries(chartIds.map(id => [id, chartSchema])) as Record<
      (typeof chartIds)[number],
      typeof chartSchema
    >,
  ),
  tables: z.record(
    z.string(),
    z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
  ),
  insights: z.array(z.string()),
  meta: z.object({
    demo: z.boolean(),
    canManage: z.boolean(),
    latestImportAt: z.string().nullable(),
    ruleCount: z.number().int().nonnegative(),
    aiCrawlerEnabled: z.boolean().optional(),
    logsConfigured: z.boolean().optional(),
    totalLogs: z.number().int().nonnegative().optional(),
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().optional(),
    nextCursor: z.string().optional(),
    previousCursor: z.string().optional(),
  }),
});
