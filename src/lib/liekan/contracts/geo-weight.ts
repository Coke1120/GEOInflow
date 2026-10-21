import { z } from 'zod';
export const geoWeightQuerySchema = z.strictObject({
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string().min(1).max(100),
  view: z.enum(['summary', 'detail']).default('summary'),
});
export const geoWeightExportSchema = z.strictObject({
  asOf: z.string(),
  timezone: z.string(),
  locale: z.enum(['zh-CN', 'en-US']),
  catalogVersion: z.uuid(),
  snapshot: z.string().regex(/^[a-f0-9]{64}$/),
});
export type GeoPurpose = 'search' | 'user' | 'training';
export type GeoWeightState =
  | 'missing'
  | 'unavailable'
  | 'warming_up'
  | 'reference'
  | 'aligned'
  | 'observed_zero';
export type GeoFactors = { paths: number; units: number; days: number; operators: number };
export type GeoReason =
  | 'coverage_missing'
  | 'coverage_partial'
  | 'backlog'
  | 'sampling_unknown'
  | 'host_inferred'
  | 'classification_changed'
  | 'source_changed'
  | 'catalog_fallback'
  | 'identity_incomplete'
  | 'content_inferred'
  | 'content_mixed'
  | 'history_incomplete';
export type GeoExclusion =
  | 'self_check'
  | 'host'
  | 'ambiguous'
  | 'outside_scope'
  | 'history'
  | 'semantics'
  | 'verification'
  | 'response'
  | 'content';
export type GeoWeightPoint = {
  asOf: string;
  startAt: number;
  endAt: number;
  state: GeoWeightState;
  score: number | null;
  level: number | null;
  rawScore: number | null;
  observedDays: number;
  reasons: GeoReason[];
  categories: Array<
    GeoFactors & {
      purpose: GeoPurpose;
      score: number;
      contribution: number;
      weight: number;
      operatorAnchor: number;
    }
  >;
  requests: number;
  accepted: number;
  status200: number;
  status304: number;
  mimeConfirmed: number;
  pathInferred: number;
  exclusions: Partial<Record<GeoExclusion, number>>;
  operators: Array<{ purpose: GeoPurpose; platformId: string; units: number; days: number }>;
  identities: Array<{
    id: string;
    requests: number;
    verified: number;
    accepted: number;
    exclusions: Partial<Record<GeoExclusion, number>>;
  }>;
  forms: Array<{ form: string; requests: number }>;
  catalogVersions: string[];
  classificationVersions: string[];
  sources: string[];
  comparableKey: string | null;
};
export type GeoWeightResponse = {
  websiteId: string;
  hostname: string;
  timezone: string;
  algorithm: string;
  scoreScopeHash: string;
  readCatalogVersion: string;
  readCatalogHash: string;
  catalogState: 'published' | 'fallback';
  directoryCounts: { platforms: number; products: number; identities: number };
  scope: Array<{
    id: string;
    purpose: GeoPurpose;
    platformId: string;
    name: string;
    platform: string;
    documentation: string | null;
    reviewedAt: string | null;
    productForm: string;
  }>;
  canManageCatalog: boolean;
  epoch: number;
  dataRevision: string;
  calculatedAt: string;
  snapshot: string;
  view: 'summary' | 'detail';
  current: GeoWeightPoint;
  previous?: GeoWeightPoint;
  observations?: Array<GeoWeightPoint & { connectPrevious: boolean }>;
  comparison?: { delta: number | null; comparable: boolean; reasons: GeoReason[] };
};

const purpose = z.enum(['search', 'user', 'training']);
const count = z.number().int().nonnegative();
const score = z.number().min(0).max(100);
const exclusion = z.enum([
  'self_check',
  'host',
  'ambiguous',
  'outside_scope',
  'history',
  'semantics',
  'verification',
  'response',
  'content',
]);
const reason = z.enum([
  'coverage_missing',
  'coverage_partial',
  'backlog',
  'sampling_unknown',
  'host_inferred',
  'classification_changed',
  'source_changed',
  'catalog_fallback',
  'identity_incomplete',
  'content_inferred',
  'content_mixed',
  'history_incomplete',
]);
const exclusions = z.partialRecord(exclusion, count);
const geoPointSchema = z.object({
  asOf: z.string(),
  startAt: z.number(),
  endAt: z.number(),
  state: z.enum(['missing', 'unavailable', 'warming_up', 'reference', 'aligned', 'observed_zero']),
  score: score.nullable(),
  rawScore: score.nullable(),
  level: z.number().int().min(0).max(10).nullable(),
  observedDays: count.max(30),
  reasons: z.array(reason),
  categories: z.array(
    z.object({
      purpose,
      paths: count,
      units: count,
      days: count.max(30),
      operators: count,
      score,
      contribution: score,
      weight: z.number(),
      operatorAnchor: count,
    }),
  ),
  requests: count,
  accepted: count,
  status200: count,
  status304: count,
  mimeConfirmed: count,
  pathInferred: count,
  exclusions,
  operators: z.array(z.object({ purpose, platformId: z.string(), units: count, days: count })),
  identities: z.array(
    z.object({ id: z.string(), requests: count, verified: count, accepted: count, exclusions }),
  ),
  forms: z.array(z.object({ form: z.string(), requests: count })),
  catalogVersions: z.array(z.string()),
  classificationVersions: z.array(z.string()),
  sources: z.array(z.string()),
  comparableKey: z.string().nullable(),
});
export const geoWeightResponseSchema = z.object({
  websiteId: z.uuid(),
  hostname: z.string(),
  timezone: z.string(),
  algorithm: z.string(),
  scoreScopeHash: z.string(),
  readCatalogVersion: z.uuid(),
  readCatalogHash: z.string(),
  catalogState: z.enum(['published', 'fallback']),
  directoryCounts: z.object({ platforms: count, products: count, identities: count }),
  scope: z.array(
    z.object({
      id: z.string(),
      purpose,
      platformId: z.string(),
      name: z.string(),
      platform: z.string(),
      documentation: z.string().nullable(),
      reviewedAt: z.string().nullable(),
      productForm: z.string(),
    }),
  ),
  canManageCatalog: z.boolean(),
  epoch: count,
  dataRevision: z.string(),
  calculatedAt: z.string(),
  snapshot: z.string(),
  view: z.enum(['summary', 'detail']),
  current: geoPointSchema,
  previous: geoPointSchema.optional(),
  observations: z.array(geoPointSchema.extend({ connectPrevious: z.boolean() })).optional(),
  comparison: z
    .object({ delta: z.number().nullable(), comparable: z.boolean(), reasons: z.array(reason) })
    .optional(),
});
