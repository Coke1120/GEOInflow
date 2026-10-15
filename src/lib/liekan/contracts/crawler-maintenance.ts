import { z } from 'zod';

const timestamp = z.iso.datetime();
const nullableTime = timestamp.nullable();
const hash = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .nullable();
export const rangeSourceHealthSchema = z.object({
  id: z.string(),
  url: z.url(),
  names: z.array(z.string()),
  crawlerIds: z.array(z.string()),
  reviewedAt: z.iso.date(),
  version: hash,
  candidateVersion: hash,
  observedAt: nullableTime,
  lastAttemptAt: nullableTime,
  lastSuccessAt: nullableTime,
  nextCheckAt: nullableTime,
  consecutiveFailures: z.number().int().nonnegative(),
  errorCode: z.string().nullable(),
  status: z.enum(['missing', 'stale', 'review_required', 'warning', 'update_failed', 'healthy']),
  reviewOverdue: z.boolean(),
});
export const documentSourceHealthSchema = z.object({
  id: z.string(),
  url: z.url(),
  label: z.string(),
  names: z.array(z.string()),
  reviewedAt: z.iso.date(),
  currentHash: hash,
  baselineHash: hash,
  lastAttemptAt: nullableTime,
  lastSuccessAt: nullableTime,
  nextCheckAt: nullableTime,
  consecutiveFailures: z.number().int().nonnegative(),
  errorCode: z.string().nullable(),
  status: z.enum(['missing', 'review_required', 'warning', 'update_failed', 'healthy']),
  reviewOverdue: z.boolean(),
});
export const crawlerSourcesResponseSchema = z.object({
  catalogVersion: z.string(),
  checkedAt: timestamp,
  ipSources: z.array(rangeSourceHealthSchema),
  documents: z.array(documentSourceHealthSchema),
});
export const crawlerRecognitionResponseSchema = z.object({
  mode: z.enum(['official', 'disabled', 'legacy']),
  classificationVersion: z.string(),
  rulesRevision: z.number().int().nonnegative(),
  enabledIds: z.array(z.string()),
});
export const crawlerCandidatesResponseSchema = z.object({
  state: z.enum(['ready', 'unavailable']),
  windowStart: timestamp,
  windowEnd: timestamp,
  scannedRows: z.number().int().nonnegative().max(100000),
  scanLimit: z.literal(100000),
  partial: z.boolean(),
  scannedStart: nullableTime,
  scannedEnd: nullableTime,
  items: z
    .array(
      z.object({
        token: z.string().min(3).max(48),
        count: z.number().int().positive(),
        firstSeen: timestamp,
        lastSeen: timestamp,
      }),
    )
    .max(100),
});
export type RangeSourceHealth = z.infer<typeof rangeSourceHealthSchema>;
export type DocumentSourceHealth = z.infer<typeof documentSourceHealthSchema>;
export type CrawlerSourcesResponse = z.infer<typeof crawlerSourcesResponseSchema>;
export type CrawlerRecognitionResponse = z.infer<typeof crawlerRecognitionResponseSchema>;
export type CrawlerCandidatesResponse = z.infer<typeof crawlerCandidatesResponseSchema>;
