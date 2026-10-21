import { formatInTimeZone } from 'date-fns-tz';
import { z } from 'zod';
import { dataStateSchema } from '../contracts/report';
import { aiSpaceSchema, aiUuidSchema } from './contracts';
import { AiError } from './error';
import { cleanAiPath, sanitizeAiText } from './sanitize';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ratio = z.number().finite().nullable();
const text = z.string().max(200);
const timestamp = z.iso.datetime({ offset: true });
export const aiRangeSchema = z.object({ startAt: timestamp, endAt: timestamp });
const totals = z.object({ pageviews: count, visitors: count, visits: count });
const logTotals = z.object({
  requests: count,
  aiRequests: count,
  errors403: count,
  errors404: count,
  errors5xx: count,
});
const nullableLog = logTotals.nullable();
const errorTotals = z
  .object({ requests: count, errors403: count, errors404: count, errors5xx: count })
  .nullable();
const base = { label: text, state: dataStateSchema };
const top = { total: count, omitted: count, truncated: z.boolean() };
const botRow = z.object({
  name: text,
  botId: z.string().max(80).nullable().optional(),
  vendor: text,
  class: z.enum(['训练', '搜索', '用户触发', '传统搜索', '其他']),
  verification: z.enum([
    'verified_range',
    'verified_dns',
    'verified_edge',
    'range_mismatch',
    'unverified',
  ]),
  requests: count,
  previousRequests: count,
  changePercent: ratio,
});
const pathRow = z.object({
  path: z.string().max(500),
  humanPageviews: count.nullable(),
  previousHumanPageviews: count.nullable(),
  aiRequests: count.nullable(),
  previousAiRequests: count.nullable(),
});
export const aiFactSchema = z.discriminatedUnion('id', [
  z.object({
    ...base,
    id: z.literal('summary'),
    data: z.object({
      current: totals.nullable(),
      previous: totals.nullable(),
      changePercent: z.object({ pageviews: ratio, visitors: ratio, visits: ratio }),
      logs: nullableLog,
      previousLogs: nullableLog,
      scope: z.literal('human browser events and imported server logs'),
    }),
  }),
  z.object({
    ...base,
    id: z.literal('bots'),
    data: z.object({
      ...top,
      requests: count.nullable(),
      previousRequests: count.nullable(),
      changePercent: ratio,
      rows: z.array(botRow).max(20),
      scope: z.enum([
        'AI classes: 训练, 搜索, 用户触发; UA classification with verification states',
        'AI-qualified requests at ingestion; legacy recorded-type fallback; declared UA with separate verification',
      ]),
    }),
  }),
  z.object({
    ...base,
    id: z.literal('log-errors'),
    data: z.object({
      ...top,
      requests: count.nullable(),
      previousRequests: count.nullable(),
      current: errorTotals,
      previous: errorTotals,
      changePercent: ratio,
      paths: z
        .array(
          z.object({
            path: z.string().max(500),
            statusGroup: z.enum(['403', '404', '5xx']),
            requests: count,
          }),
        )
        .max(20),
      samples: z
        .array(
          z.object({
            time: timestamp,
            path: z.string().max(500),
            status: z.number().int().min(100).max(599),
            bot: text,
          }),
        )
        .max(20),
      sampleTotal: count,
      samplesOmitted: count,
      samplesTruncated: z.boolean(),
      sampleMethod: z.literal('latest_by_created_at_desc_id_desc'),
      scope: z.literal(
        'imported logs: HTTP 403, 404 and 500–599; current and previous aggregate counts; paths and latest samples from current period; coverage unverified',
      ),
    }),
  }),
  z.object({
    ...base,
    id: z.literal('ai-referrals'),
    data: z.object({
      visits: count.nullable(),
      pageviews: count.nullable(),
      previousVisits: count.nullable(),
      previousPageviews: count.nullable(),
      changePercent: ratio,
      scope: z.literal('first browser pageview attribution using the approved AI channel catalog'),
    }),
  }),
  z.object({
    ...base,
    id: z.literal('pages'),
    data: z.object({
      ...top,
      rows: z.array(pathRow).max(20),
      scope: z.literal(
        'browser paths and encoded imported AI request paths; union of current and previous periods ranked by current then previous counts; stored forms may differ; query and fragment excluded',
      ),
    }),
  }),
  z.object({
    ...base,
    id: z.literal('goals'),
    data: z.object({
      ...top,
      configured: count,
      invalidDefinitions: count,
      rows: z
        .array(
          z.object({
            name: text,
            type: z.enum(['path', 'event']),
            count,
            previousCount: count,
            convertedVisits: count,
            previousConvertedVisits: count,
            ratePercent: ratio,
            previousRatePercent: ratio,
            changePercent: ratio,
          }),
        )
        .max(20),
      scope: z.literal(
        'configured goal matching events; rates use converted browser visits divided by browser visits',
      ),
    }),
  }),
]);
export const aiFactsContextSchema = z.object({
  protocolVersion: z.literal(1),
  id: aiUuidSchema,
  website: z.object({ id: aiUuidSchema, name: text, domain: z.string().max(253).nullable() }),
  space: aiSpaceSchema,
  websiteEpoch: aiUuidSchema,
  currentRange: aiRangeSchema,
  previousRange: aiRangeSchema,
  timeZone: z.string().max(100),
  generatedAt: timestamp,
  metricVersion: z.literal('liekan-ai-facts-v1'),
  catalogVersion: aiUuidSchema.optional(),
  trafficPolicyVersion: z.string().min(1).max(128).optional(),
  historyRepair: z.object({generation:aiUuidSchema.nullable(),revision:z.string().regex(/^\d+$/)}).optional(),
  promptVersion: z.literal('liekan-ai-prompt-v1'),
  coverage: z.literal('unverified'),
  rangeNotes: z.object({
    originalEndAt: timestamp,
    endClamped: z.boolean(),
    currentDayIncomplete: z.boolean(),
  }),
  sourceStates: z.object({
    human: dataStateSchema,
    logs: dataStateSchema,
    catalog: dataStateSchema,
    goals: dataStateSchema,
    aiReferrals: dataStateSchema,
  }),
  businessProfile: z.object({ state: z.literal('unconfigured'), value: z.null() }),
  metrics: z
    .array(
      z.object({
        key: z.enum(['pageviews', 'visitors', 'visits', 'aiRequests', 'aiReferrals']),
        label: text,
        value: count.nullable(),
        state: dataStateSchema,
        changePercent: ratio,
      }),
    )
    .max(5),
  facts: z.array(aiFactSchema).max(6),
});
export type AiFactsContext = z.infer<typeof aiFactsContextSchema>;
export type AiFact = z.infer<typeof aiFactSchema>;
export type AiRange = z.infer<typeof aiRangeSchema>;

export function normalizeAiRange(
  input: { startAt: string; endAt: string; timezone: string },
  asOf: Date,
) {
  const parsed = aiRangeSchema.safeParse(input);
  const start = Date.parse(input.startAt),
    originalEnd = Date.parse(input.endAt),
    now = asOf.getTime();
  try {
    new Intl.DateTimeFormat('en', { timeZone: input.timezone }).format();
  } catch {
    throw new AiError('invalid_request', '统计时区无效');
  }
  if (
    !parsed.success ||
    !Number.isFinite(now) ||
    start > originalEnd ||
    start > now ||
    originalEnd - start + 1 > 90 * 86400000
  )
    throw new AiError('invalid_request', '统计范围无效，上限 90 天');
  const end = Math.min(originalEnd, now),
    duration = end - start + 1;
  if (start - duration < -8640000000000000) throw new AiError('invalid_request', '统计范围无效');
  return {
    currentRange: { startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString() },
    previousRange: {
      startAt: new Date(start - duration).toISOString(),
      endAt: new Date(start - 1).toISOString(),
    },
    rangeNotes: {
      originalEndAt: new Date(originalEnd).toISOString(),
      endClamped: originalEnd > now,
      currentDayIncomplete:
        formatInTimeZone(new Date(end), input.timezone, 'yyyy-MM-dd') ===
        formatInTimeZone(asOf, input.timezone, 'yyyy-MM-dd'),
    },
  };
}
/** The declared schemas project every nested object onto the outbound allowlist. */
export function sanitizeAiFactsContext(input: unknown): AiFactsContext {
  const context = aiFactsContextSchema.parse(input);
  context.website.name = sanitizeAiText(context.website.name);
  const domain = context.website.domain;
  context.website.domain =
    domain && /^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/i.test(domain) ? domain.toLowerCase() : null;
  for (const metric of context.metrics) metric.label = sanitizeAiText(metric.label);
  for (const fact of context.facts) {
    fact.label = sanitizeAiText(fact.label);
    if (fact.id === 'bots')
      for (const row of fact.data.rows) {
        row.name = sanitizeAiText(row.name);
        row.vendor = sanitizeAiText(row.vendor);
      }
    if (fact.id === 'pages') for (const row of fact.data.rows) row.path = cleanAiPath(row.path);
    if (fact.id === 'log-errors') {
      for (const row of fact.data.paths) row.path = cleanAiPath(row.path);
      for (const row of fact.data.samples) {
        row.path = cleanAiPath(row.path);
        row.bot = sanitizeAiText(row.bot);
      }
    }
    if (fact.id === 'goals') for (const row of fact.data.rows) row.name = sanitizeAiText(row.name);
  }
  return aiFactsContextSchema.parse(context);
}
