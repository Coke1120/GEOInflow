import { z } from 'zod';
export const workflowWriteSchema = z
  .strictObject({
    requestId: z.uuid(),
    expectedWorkflowRevision: z.number().int().nonnegative(),
    occurrenceVersion: z.number().int().positive(),
    factVersion: z.string().regex(/^[a-f0-9]{64}$/),
    action: z.enum(['view', 'snooze', 'resume', 'comment']),
    hours: z.union([z.literal(1), z.literal(24), z.literal(168)]).optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .refine(p => p.action !== 'snooze' || p.hours !== undefined)
  .refine(p => p.action !== 'comment' || !!p.note);
export const contextWriteSchema = z.strictObject({
  requestId: z.uuid(),
  title: z.string().trim().min(1).max(120),
  note: z.string().trim().max(1000),
  occurredAt: z.iso.datetime({ offset: true }),
});
export const contextVoidSchema = z.strictObject({
  requestId: z.uuid(),
  reason: z.string().trim().min(1).max(1000),
});
export const contextQuerySchema = z.strictObject({
  startAt: z.coerce.number().int().nonnegative(),
  endAt: z.coerce.number().int().nonnegative(),
  page: z.coerce.number().int().min(1).max(5000).default(1),
  actionPage: z.coerce.number().int().min(1).max(5000).default(1),
  history: z.enum(['current', 'all']).default('current'),
  referenceSource: z.enum(['policy', 'check', 'catalog']).optional(),
  referenceId: z.string().min(1).max(128).optional(),
  findingKey: z.string().min(1).max(128).optional(),
});

const json = z.record(z.string(), z.unknown());
export const workflowResponseSchema = z.object({
  finding: z.looseObject({
    key: z.string(),
    state: z.enum(['active', 'resolved', 'ignored']),
    grade: z.string(),
    facts: json,
  }),
  epoch: z.number().int(),
  classificationVersion: z.string().nullable(),
  workflowRevision: z.number().int(),
  occurrenceVersion: z.number().int(),
  factVersion: z.string(),
  state: z.enum(['pending', 'viewed', 'snoozed']),
  snoozedUntil: z.string().nullable(),
  pending: z.boolean(),
});
export const contextCreateResponseSchema = contextWriteSchema.extend({
  id: z.uuid(),
  source: z.literal('manual'),
});
export const contextVoidResponseSchema = z.object({
  id: z.uuid(),
  voided: z.literal(true),
  reason: z.string(),
});
export const contextResponseSchema = z.object({
  rows: z.array(
    z.object({
      id: z.string(),
      source: z.enum(['manual', 'policy', 'check', 'catalog']),
      title: z.string(),
      note: z.string(),
      occurred_at: z.string(),
      created_at: z.string(),
      voided_at: z.string().nullable(),
      void_reason: z.string().nullable(),
      actor: z.string().nullable(),
      epoch: z.number().int().nullable(),
    }),
  ),
  actions: z.array(
    z.object({
      request_id: z.uuid(),
      action: z.string(),
      note: z.string().nullable(),
      actor_id: z.uuid().nullable(),
      occurred_at: z.string(),
      before_state: json.nullable(),
      after_state: json,
    }),
  ),
  evidence: z
    .object({ id: z.string(), source: z.enum(['policy', 'check', 'catalog']), record: json })
    .nullable(),
  workflow: workflowResponseSchema.nullable(),
  canDraft: z.boolean(),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.literal(20),
  actionTotal: z.number().int(),
  actionPage: z.number().int(),
  conditions: contextQuerySchema,
});
