import { z } from 'zod';

export const HISTORY_REPAIR_CAMPAIGN = 'traffic-quality-repair-20261022-v1';
export const HISTORY_REPAIR_ENGINE = 'history-repair-v1.1';
export const HISTORY_REPAIR_QUEUE = 'liekan-history-repair';
export const historyRepairStatuses = [
  'unscanned',
  'scanning',
  'preparing',
  'ready',
  'queued',
  'running',
  'validating',
  'completed',
  'completed_limited',
  'unchanged',
  'unidentifiable',
  'empty',
  'paused',
  'failed',
  'cancelled',
  'rolled_back',
  'expired',
  'invalidated',
] as const;
export type HistoryRepairStatus = (typeof historyRepairStatuses)[number];
export const historyRepairStatusSchema = z.enum(historyRepairStatuses);
const uuid = z.uuid().toLowerCase();
const actionId = uuid;
export const historyRepairScanSchema = z.strictObject({
  actionId,
  timezone: z.string().min(1).max(80).default('UTC'),
  locale: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
});
export const historyRepairPreviewSchema = z.strictObject({
  actionId,
  runId: uuid,
  expectedRevision: z.number().int().positive(),
});
export const historyRepairConfirmSchema = z.strictObject({
  actionId,
  runId: uuid,
  expectedRevision: z.number().int().positive(),
  generation: uuid,
  previewDigest: z.string().regex(/^[a-f0-9]{64}$/),
  partialConfirmed: z.boolean().default(false),
});
export const historyRepairActionSchema = z.strictObject({
  actionId,
  runId: uuid,
  expectedRevision: z.number().int().positive(),
  action: z.enum(['pause', 'resume', 'cancel', 'retry', 'rollback', 'reactivate']),
});
export const historyRepairNoticeSchema = z.strictObject({
  campaignId: z.literal(HISTORY_REPAIR_CAMPAIGN).default(HISTORY_REPAIR_CAMPAIGN),
  action: z.enum(['dismiss', 'read']),
});
export const historyRepairQuerySchema = z.strictObject({
  view: z.enum(['status', 'preview', 'days', 'actions']).default('status'),
  generation: uuid.optional(),
  page: z.coerce.number().int().min(1).max(10000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(50),
  cursor: z.string().max(2048).optional(),
});
export const historyRepairEvidenceRecordSchema = z.union([
  z.strictObject({ eventId: uuid, requestUserAgent: z.string().min(1).max(2048) }),
  z.strictObject({ clientEventId: uuid, requestUserAgent: z.string().min(1).max(2048) }),
]);
export const historyRepairEvidenceSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('append'),
    actionId,
    runId: uuid,
    uploadId: uuid,
    expectedRevision: z.number().int().positive(),
    sequence: z.number().int().min(0).max(1000000),
    source: z.string().trim().min(1).max(500),
    records: z.array(historyRepairEvidenceRecordSchema).min(1).max(1000),
  }),
  z
    .strictObject({
      action: z.literal('finalize'),
      actionId,
      runId: uuid,
      uploadId: uuid,
      expectedRevision: z.number().int().positive(),
      chunks: z.number().int().min(1).max(1000001),
      rows: z.number().int().positive().max(1000000000),
      manifest: z
        .array(z.string().regex(/^[a-f0-9]{64}$/))
        .min(1)
        .max(1000001)
        .optional(),
      manifestDigest: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    })
    .refine(value => (value.manifest !== undefined) !== (value.manifestDigest !== undefined), {
      message: 'Provide one ordered manifest or manifest digest',
    }),
  z.strictObject({
    action: z.literal('discard'),
    actionId,
    runId: uuid,
    uploadId: uuid,
    expectedRevision: z.number().int().positive(),
  }),
]);
export type HistoryRepairEvidenceInput = z.infer<typeof historyRepairEvidenceSchema>;
export interface HistoryRepairCounts {
  events: string;
  logs: string;
  processed: string;
  changedEvents: string;
  changedLogs: string;
  browserEvidence: string;
  logEvidence: string;
  missingQuality: string;
  conflicts: string;
  undatedEvents: string;
  beforePV: string;
  afterPV: string;
  beforeUV: string;
  afterUV: string;
}
export interface HistoryRepairDay {
  date: string;
  beforePV: string;
  afterPV: string;
  beforeUV: string;
  afterUV: string;
  eventRows: string;
  logRows: string;
  changedEvents: string;
  changedLogs: string;
  coverage: 'complete' | 'partial' | 'missing';
}
export interface HistoryRepairLogImpact {
  categories: {
    category:
      | 'all'
      | 'training'
      | 'search'
      | 'user'
      | 'traditional_search'
      | 'workbench'
      | 'personal_agent'
      | 'other'
      | 'unknown';
    beforeRequests: string;
    afterRequests: string;
  }[];
  beforeIdentities: string;
  afterIdentities: string;
  beforeAiPages: string;
  afterAiPages: string;
}
export interface HistoryRepairPreview {
  generation: string;
  revision: number;
  digest: string;
  complete: boolean;
  counts: HistoryRepairCounts;
  logImpact: HistoryRepairLogImpact;
  sourceUploads?: string[];
  browserCoverage: number | null;
  logCoverage: number | null;
  partial: boolean;
  limitations: string[];
  excludedBatches: string[];
  timezone: string;
  policy: { mode: 'standard' | 'strict' | 'raw'; allowedHostnames: string[]; revision: string };
  rulepack: {
    engine: string;
    matcher: string;
    detector: string;
    botCheckDisabled: boolean;
    catalogVersion: string;
    rulesRevision: number;
    hash: string;
  };
}
export interface HistoryRepairRun {
  id: string;
  websiteId: string;
  campaignId: string;
  status: HistoryRepairStatus;
  revision: number;
  inputRevision: number;
  generation: string;
  activeGeneration: string | null;
  previousGeneration: string | null;
  progress: number;
  phase: string;
  counts: HistoryRepairCounts;
  frozenAt: string | null;
  scopeId: string | null;
  scopeChanged: boolean;
  errorCode: string | null;
  updatedAt: string;
  completedAt: string | null;
  preview: HistoryRepairPreview | null;
}
export interface HistoryRepairWebsite {
  id: string;
  name: string;
  domain: string;
  eligible: boolean;
  hasData: boolean;
  status: HistoryRepairStatus;
  run: HistoryRepairRun | null;
}
export interface HistoryRepairList {
  campaignId: string;
  engineVersion: string;
  supported: boolean;
  dismissed: boolean;
  unreadCompletion: boolean;
  hasEligibleData?: boolean;
  nextCursor?: string | null;
  websites: HistoryRepairWebsite[];
}
export interface HistoryRepairDetail {
  campaignId: string;
  eligible: boolean;
  hasData: boolean;
  run: HistoryRepairRun | null;
  selectedGeneration?: {
    id: string;
    preview: HistoryRepairPreview | null;
    timezone: string;
    rulepackHash: string;
    catalogVersion: string;
  };
  uploads?: {
    id: string;
    source: string;
    finalized: boolean;
    discarded: boolean;
    rows: string;
    accepted: string;
    rejected: string;
    chunks: number;
    errors: { sequence: number; row: number; code: string }[];
    moreErrors: boolean;
  }[];
  days?: {
    items: HistoryRepairDay[];
    page: number;
    pageSize: number;
    total: string;
    nextCursor: string | null;
  };
  actions?: {
    items: HistoryRepairAudit[];
    page: number;
    pageSize: number;
    total: string;
    nextCursor: string | null;
  };
}
export interface HistoryRepairAudit {
  id: string;
  action: string;
  actorId: string | null;
  generation: string | null;
  createdAt: string;
  details: Record<string, unknown>;
}
export interface HistoryRepairEvidenceResult {
  uploadId: string;
  sequence?: number;
  hash?: string;
  revision: number;
  accepted: number;
  rejected: number;
  finalized: boolean;
  discarded: boolean;
  errors: { row: number; code: string }[];
}

const decimalCount = z.string().regex(/^\d+$/);
export const historyRepairCountsSchema = z.strictObject({
  events: decimalCount,
  logs: decimalCount,
  processed: decimalCount,
  changedEvents: decimalCount,
  changedLogs: decimalCount,
  browserEvidence: decimalCount,
  logEvidence: decimalCount,
  missingQuality: decimalCount,
  conflicts: decimalCount,
  undatedEvents: decimalCount,
  beforePV: decimalCount,
  afterPV: decimalCount,
  beforeUV: decimalCount,
  afterUV: decimalCount,
});
export const historyRepairDaySchema = z.strictObject({
  date: z.string(),
  beforePV: decimalCount,
  afterPV: decimalCount,
  beforeUV: decimalCount,
  afterUV: decimalCount,
  eventRows: decimalCount,
  logRows: decimalCount,
  changedEvents: decimalCount,
  changedLogs: decimalCount,
  coverage: z.enum(['complete', 'partial', 'missing']),
});
export const historyRepairPublicPolicySchema = z.strictObject({
  mode: z.enum(['standard', 'strict', 'raw']),
  allowedHostnames: z.array(z.string()),
  revision: decimalCount,
});
export const historyRepairPublicRulepackSchema = z.strictObject({
  engine: z.string(),
  matcher: z.string(),
  detector: z.string(),
  botCheckDisabled: z.boolean(),
  catalogVersion: z.string(),
  rulesRevision: z.number().int(),
  hash: z.string(),
});
export const historyRepairLogImpactSchema = z.strictObject({
  categories: z.array(
    z.strictObject({
      category: z.enum([
        'all',
        'training',
        'search',
        'user',
        'traditional_search',
        'workbench',
        'personal_agent',
        'other',
        'unknown',
      ]),
      beforeRequests: decimalCount,
      afterRequests: decimalCount,
    }),
  ),
  beforeIdentities: decimalCount,
  afterIdentities: decimalCount,
  beforeAiPages: decimalCount,
  afterAiPages: decimalCount,
});
export const historyRepairResultPreviewSchema = z.strictObject({
  generation: z.uuid(),
  revision: z.number().int().positive(),
  digest: z.string(),
  complete: z.boolean(),
  counts: historyRepairCountsSchema,
  logImpact: historyRepairLogImpactSchema,
  sourceUploads: z.array(z.uuid()).optional(),
  browserCoverage: z.number().nullable(),
  logCoverage: z.number().nullable(),
  partial: z.boolean(),
  limitations: z.array(z.string()),
  excludedBatches: z.array(z.uuid()),
  timezone: z.string(),
  policy: historyRepairPublicPolicySchema,
  rulepack: historyRepairPublicRulepackSchema,
});
export const historyRepairRunSchema = z.strictObject({
  id: z.uuid(),
  websiteId: z.uuid(),
  campaignId: z.string(),
  status: historyRepairStatusSchema,
  revision: z.number().int().positive(),
  inputRevision: z.number().int().nonnegative(),
  generation: z.uuid(),
  activeGeneration: z.uuid().nullable(),
  previousGeneration: z.uuid().nullable(),
  progress: z.number().int().min(0).max(100),
  phase: z.string(),
  counts: historyRepairCountsSchema,
  frozenAt: z.string().nullable(),
  scopeId: z.uuid().nullable(),
  scopeChanged: z.boolean(),
  errorCode: z.string().nullable(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  preview: historyRepairResultPreviewSchema.nullable(),
});
export const historyRepairWebsiteSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  domain: z.string(),
  eligible: z.boolean(),
  hasData: z.boolean(),
  status: historyRepairStatusSchema,
  run: historyRepairRunSchema.nullable(),
});
export const historyRepairListSchema = z.strictObject({
  campaignId: z.string(),
  engineVersion: z.string(),
  supported: z.boolean(),
  dismissed: z.boolean(),
  unreadCompletion: z.boolean(),
  hasEligibleData: z.boolean().optional(),
  websites: z.array(historyRepairWebsiteSchema),
  nextCursor: z.string().nullable().optional(),
});
const auditDetail = z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]);
export const historyRepairAuditSchema = z.strictObject({
  id: z.uuid(),
  action: z.string(),
  actorId: z.uuid().nullable(),
  generation: z.uuid().nullable(),
  createdAt: z.string(),
  details: z.record(z.string(), auditDetail),
});
export const historyRepairDetailSchema = z.strictObject({
  campaignId: z.string(),
  eligible: z.boolean(),
  hasData: z.boolean(),
  run: historyRepairRunSchema.nullable(),
  selectedGeneration: z
    .strictObject({
      id: z.uuid(),
      preview: historyRepairResultPreviewSchema.nullable(),
      timezone: z.string(),
      rulepackHash: z.string(),
      catalogVersion: z.string(),
    })
    .optional(),
  uploads: z
    .array(
      z.strictObject({
        id: z.uuid(),
        source: z.string(),
        finalized: z.boolean(),
        discarded: z.boolean(),
        rows: decimalCount,
        accepted: decimalCount,
        rejected: decimalCount,
        chunks: z.number().int(),
        errors: z.array(
          z.strictObject({
            sequence: z.number().int().nonnegative(),
            row: z.number().int().positive(),
            code: z.string(),
          }),
        ),
        moreErrors: z.boolean(),
      }),
    )
    .optional(),
  days: z
    .strictObject({
      items: z.array(historyRepairDaySchema),
      page: z.number().int(),
      pageSize: z.number().int(),
      total: decimalCount,
      nextCursor: z.string().nullable(),
    })
    .optional(),
  actions: z
    .strictObject({
      items: z.array(historyRepairAuditSchema),
      page: z.number().int(),
      pageSize: z.number().int(),
      total: decimalCount,
      nextCursor: z.string().nullable(),
    })
    .optional(),
});
export const historyRepairEvidenceResultSchema = z.strictObject({
  uploadId: z.uuid(),
  sequence: z.number().int().optional(),
  hash: z.string().optional(),
  revision: z.number().int().positive(),
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  finalized: z.boolean(),
  discarded: z.boolean(),
  errors: z.array(z.strictObject({ row: z.number().int().positive(), code: z.string() })),
});
export const historyRepairNoticeResultSchema = z.strictObject({
  campaignId: z.string(),
  dismissed: z.boolean(),
  read: z.boolean(),
});
