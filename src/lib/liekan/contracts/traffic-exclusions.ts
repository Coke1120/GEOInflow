import { z } from 'zod';
const revision = z.string().regex(/^\d{1,19}$/);
export const trafficExclusionActionSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('preview'),
    expectedRevision: revision,
    windowEnd: z.iso.datetime(),
    visits: z
      .array(z.strictObject({ sessionId: z.uuid(), visitId: z.uuid() }))
      .min(1)
      .max(100),
  }),
  z.strictObject({
    action: z.literal('confirm'),
    expectedRevision: revision,
    previewId: z.uuid(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.strictObject({
    action: z.literal('revoke'),
    expectedRevision: revision,
    collectionId: z.uuid(),
  }),
]);
export const trafficExclusionResultSchema = z.object({
  action: z.enum(['preview', 'confirm', 'revoke']),
  id: z.uuid(),
  revision,
  digest: z.string().optional(),
  expiresAt: z.string().optional(),
  evidence: z
    .object({
      events: z.number(),
      pageviews: z.number(),
      coverage: z.literal('observed'),
      behaviorVersion: z.string(),
      windowComputedAt: z.string(),
      visits: z.array(z.object({ sessionId: z.string(), visitId: z.string() })),
    })
    .optional(),
});
export type TrafficExclusionResult = z.infer<typeof trafficExclusionResultSchema>;
export const trafficGovernanceSchema = z.object({
  revision,
  epoch: revision,
  nextWindow: z.string().nullable(),
  computedAt: z.string().nullable(),
  errorCode: z.string().nullable(),
  nextCursor: z.string().nullable().optional(),
  collections: z.array(
    z.object({
      id: z.string(),
      state: z.enum(['active', 'revoked']),
      epoch: revision,
      windowEnd: z.string(),
      createdAt: z.string(),
      confirmedAt: z.string().nullable(),
      revokedAt: z.string().nullable(),
      digest: z.string(),
      events: z.number(),
      evidence: z.object({
        events: z.number(),
        pageviews: z.number(),
        coverage: z.string(),
        behaviorVersion: z.string(),
      }),
    }),
  ),
});
