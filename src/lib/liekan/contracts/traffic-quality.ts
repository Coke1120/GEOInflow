import { z } from 'zod';

export const trafficPolicySchema = z.strictObject({
  mode: z.enum(['standard', 'strict', 'raw']),
  allowedHostnames: z.array(z.string().trim().min(1).max(253)).max(100),
  expectedRevision: z
    .string()
    .regex(/^\d{1,19}$/)
    .optional(),
});
export type TrafficPolicy = z.infer<typeof trafficPolicySchema>;
export const savedTrafficPolicySchema = trafficPolicySchema
  .omit({ expectedRevision: true })
  .extend({
    revision: z.string(),
    ruleVersion: z.string(),
  });
export const qualityRangeSchema = z.object({
  startAt: z.coerce.number().int().nonnegative().optional(),
  endAt: z.coerce.number().int().nonnegative().optional(),
  timezone: z.string().max(100).optional(),
  classification: z.enum(['browser', 'automated', 'suspected', 'unknown']).optional(),
  source: z.enum(['browser', 'authenticated_server', 'legacy_override']).optional(),
  hostname: z.string().max(253).optional(),
  page: z.coerce.number().int().min(1).max(10000).optional(),
  cursor: z.string().max(2048).optional(),
});
export const qualityTotalsSchema = z.object({
  rawPV: z.number(),
  includedPV: z.number(),
  excludedPV: z.number(),
  rawUV: z.number(),
  includedUV: z.number(),
  fullyExcludedUV: z.number(),
  missingVerdictPV: z.number(),
});
export const trafficPreviewSchema = z.strictObject({
  policy: trafficPolicySchema,
  range: qualityRangeSchema.omit({ page: true, cursor: true }),
});
export const trafficPreviewResultSchema = z.object({
  policy: savedTrafficPolicySchema,
  proposed: trafficPolicySchema,
  current: qualityTotalsSchema,
  preview: qualityTotalsSchema,
  range: z.object({ startAt: z.number(), endAt: z.number(), timezone: z.string() }),
});
export const trafficAuditSchema = z.object({
  available: z.boolean(),
  reason: z.string().optional(),
  policy: savedTrafficPolicySchema.optional(),
  range: z.object({ startAt: z.number(), endAt: z.number(), timezone: z.string() }).optional(),
  totals: qualityTotalsSchema.optional(),
  domainAudit: z
    .object({
      expectedHostname: z.string().nullable(),
      hosts: z.array(
        z.object({ hostname: z.string().nullable(), events: z.number(), pageviews: z.number() }),
      ),
    })
    .optional(),
  summary: z
    .array(
      z.object({
        classification: z.string(),
        events: z.number(),
        visitors: z.number(),
        pageviews: z.number(),
        missing_verdict: z.number(),
        included: z.number(),
      }),
    )
    .optional(),
  rows: z
    .array(
      z.object({
        eventId: z.string(),
        createdAt: z.string(),
        path: z.string().nullable(),
        hostname: z.string().nullable(),
        normalizedHostname: z.string().nullable(),
        classification: z.string(),
        source: z.string().nullable(),
        reasons: z.array(z.string()),
        ruleVersion: z.string().nullable(),
        rangeStatus: z.string().nullable(),
        rangeVersion: z.string().nullable(),
        included: z.boolean(),
      }),
    )
    .optional(),
  page: z.number().optional(),
  pageSize: z.number().optional(),
  nextCursor: z.string().nullable().optional(),
  history: z
    .array(
      z.object({
        id: z.string(),
        actorId: z.string(),
        createdAt: z.string(),
        before: savedTrafficPolicySchema,
        after: savedTrafficPolicySchema,
      }),
    )
    .optional(),
  diagnostics: z
    .object({
      startedAt: z.string().nullable(),
      retainedFrom: z.string(),
      coverage: z.enum(['missing', 'partial', 'complete']),
      observedFrom: z.number().nullable(),
      observedUntil: z.number().nullable(),
      bucketStartAt: z.number(),
      bucketEndAt: z.number(),
      written: z.number().nullable(),
      withUuid: z.number().nullable(),
      duplicate: z.number().nullable(),
      duplicateFraction: z.number().nullable(),
      uuidCoverage: z.number().nullable(),
    })
    .optional(),
});
export type TrafficAudit = z.infer<typeof trafficAuditSchema>;
export type TrafficPreview = z.infer<typeof trafficPreviewResultSchema>;

export const browserRiskReportSchema = z.object({
  available: z.boolean(),
  reason: z.string().optional(),
  mode: z.literal('observe').optional(),
  ruleVersion: z.string().optional(),
  state: z
    .object({
      startedAt: z.string(),
      computedAt: z.string().nullable(),
      nextWindow: z.string(),
      errorCode: z.string().nullable(),
      ruleVersion: z.string(),
    })
    .nullable()
    .optional(),
  coverage: z
    .object({
      windows: z.number(),
      partialWindows: z.number(),
      firstWindow: z.string().nullable(),
      lastWindow: z.string().nullable(),
    })
    .optional(),
  findings: z
    .array(
      z.object({
        sessionId: z.string(),
        visitId: z.string(),
        windowEnd: z.string(),
        computedAt: z.string(),
        reasons: z.array(z.string()),
        features: z.object({
          pageviews: z.number(),
          durationMs: z.number(),
          peakMinute: z.number(),
          medianGapMs: z.number().nullable(),
          relativeMad: z.number().nullable(),
          timingConcentration: z.number().nullable(),
          repeatFraction: z.number(),
        }),
      }),
    )
    .optional(),
  impact: z
    .object({
      includedPV: z.number(),
      includedUV: z.number(),
      flaggedPV: z.number(),
      fullyExcludedUV: z.number(),
    })
    .optional(),
  timeBasis: z.literal('server-received').optional(),
  range: z.object({ startAt: z.number(), endAt: z.number() }).optional(),
  retentionDays: z.number().optional(),
});
export type BrowserRiskReport = z.infer<typeof browserRiskReportSchema>;
