import { z } from 'zod';

export const catalogIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(80);
const text = z.string().max(4000);
const label = z.string().trim().min(1).max(160);
const date = z.iso.date();
const timestamp = z.iso.datetime({ offset: true });
const revision = z.string().regex(/^[1-9]\d{0,18}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
/** DNS resolution is additionally checked by the network boundary before any fetch. */
export function isPublicCatalogHost(host: string) {
  return (
    host.length <= 253 &&
    host.includes('.') &&
    !/^\d+(?:\.\d+)*$/.test(host) &&
    !/[\[\]:%]/.test(host) &&
    !/(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(host) &&
    host.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))
  );
}
export const catalogUrlSchema = z
  .string()
  .max(2048)
  .refine(value => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.hash &&
        (!url.port || url.port === '443') &&
        isPublicCatalogHost(url.hostname)
      );
    } catch {
      return false;
    }
  }, 'A public HTTPS URL without credentials or fragment is required');
const host = z
  .string()
  .max(253)
  .refine(isPublicCatalogHost, 'A public lowercase hostname is required');
const ids = z.array(catalogIdSchema).max(500);
const urls = z.array(catalogUrlSchema).max(30);
const source = z.object({ label, url: catalogUrlSchema }).strict();
export const productFormSchema = z.enum([
  'general',
  'workbench',
  'personal_agent',
  'infrastructure',
  'unknown',
]);
const metadata = z
  .object({
    id: catalogIdSchema,
    name: label,
    vendor: label,
    aliases: z.array(label).max(30),
    purposes: z
      .array(
        z.enum([
          '训练',
          'AI 搜索',
          '用户触发',
          '传统搜索',
          '广告',
          'SEO 工具',
          '研究数据',
          '链接预览',
          '通用抓取',
        ]),
      )
      .max(12),
    kind: z.enum(['crawler', 'control']),
    evidence: z.enum(['operator', 'observed', 'pending', 'inactive']),
    summary: text,
    ua: z.string().max(1000).optional(),
    token: z.string().max(160),
    robotsToken: z.string().max(160).optional(),
    feeds: z.array(source).max(30),
    verification: text,
    robots: text,
    advice: text,
    sources: z.array(source).max(30),
    reviewedAt: date,
  })
  .strict();
export const catalogIdentitySchema = z
  .object({
    id: catalogIdSchema,
    name: label,
    platformId: catalogIdSchema,
    vendor: label,
    type: z.enum(['training', 'search', 'user', 'traditional_search', 'other']),
    kind: z.enum(['http_crawler', 'robots_purpose', 'signed_agent']),
    uaSelector: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9 _.-]*$/)
      .nullable(),
    family: catalogIdSchema,
    parentId: catalogIdSchema.nullable(),
    aiEligible: z.boolean(),
    status: z.enum(['active', 'pending', 'inactive']),
    control: z.object({ remote: z.boolean(), nginx: z.boolean() }).strict(),
    robotsToken: z.string().trim().min(1).max(160).nullable(),
    metadata,
    purpose: z.enum(['training', 'search', 'user', 'multi', 'other', 'unknown']),
    productForm: productFormSchema,
    productIds: ids,
  })
  .strict();
export const catalogPlatformSchema = z
  .object({
    id: catalogIdSchema,
    name: label,
    operator: label,
    region: z.enum(['domestic', 'global']),
    website: catalogUrlSchema,
    documentationUrls: urls,
  })
  .strict();
export const catalogProductSchema = z
  .object({
    id: catalogIdSchema,
    platformId: catalogIdSchema,
    name: label,
    aliases: z.array(label).max(30),
    form: productFormSchema,
    supportStatus: z.enum(['confirmed', 'pending', 'unsupported', 'inactive']),
    website: catalogUrlSchema,
    documentationUrls: urls,
    identityIds: ids,
    tags: z.array(label).max(30),
    notes: text,
  })
  .strict();
export const catalogReferralSchema = z
  .object({
    id: catalogIdSchema,
    platformId: catalogIdSchema,
    productId: catalogIdSchema.nullable(),
    host,
    includeSubdomains: z.boolean(),
    aliases: z.array(label).max(30),
    kind: z.enum(['ai', 'mixed', 'documentation']),
    enabled: z.boolean(),
    documentationUrls: urls,
  })
  .strict();
export const catalogRangeSourceSchema = z
  .object({
    enabled: z.boolean().optional(),
    id: catalogIdSchema,
    url: catalogUrlSchema,
    names: z.array(label).min(1).max(100),
    crawlerIds: ids.min(1),
    parserVersion: z.enum(['prefixes-v1', 'amazon-code-json-v1', 'manual-reviewed-v1']),
    reviewedAt: date,
  })
  .strict();
export const catalogVerificationMethodSchema = z
  .object({
    enabled: z.boolean().optional(),
    id: catalogIdSchema,
    crawlerIds: ids.min(1),
    method: z.enum(['dns', 'signature', 'edge']),
    documentationUrl: catalogUrlSchema,
    hostSuffixes: z.array(host).max(20).optional(),
    signatureAgent: catalogUrlSchema.optional(),
    keyDirectory: catalogUrlSchema.optional(),
    detectionIds: z
      .array(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER))
      .max(100)
      .optional(),
    provider: label.optional(),
  })
  .strict();
export const catalogPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    identities: z.array(catalogIdentitySchema).min(1).max(500),
    platforms: z.array(catalogPlatformSchema).min(1).max(200),
    products: z.array(catalogProductSchema).max(500),
    referrals: z.array(catalogReferralSchema).max(500),
    rangeSources: z.array(catalogRangeSourceSchema).max(200),
    rangeBaselines: z.record(
      catalogIdSchema,
      z
        .object({
          source: catalogUrlSchema,
          observedAt: timestamp,
          publishedAt: timestamp.nullable(),
          prefixes: z.array(z.string().max(64)).min(1).max(5000),
        })
        .strict(),
    ),
    verificationMethods: z.array(catalogVerificationMethodSchema).max(200),
  })
  .strict();
export type CatalogPayload = z.infer<typeof catalogPayloadSchema>;
export type CatalogIdentity = z.infer<typeof catalogIdentitySchema>;
export type CatalogPlatform = z.infer<typeof catalogPlatformSchema>;
export type CatalogProduct = z.infer<typeof catalogProductSchema>;
export type CatalogReferral = z.infer<typeof catalogReferralSchema>;
export type CatalogVerificationMethod = z.infer<typeof catalogVerificationMethodSchema>;
export const publishedCatalogSchema = z
  .object({
    version: z.uuid(),
    revision,
    contentHash: hash,
    publishedAt: timestamp,
    payload: catalogPayloadSchema,
    state: z.enum(['published', 'fallback']),
  })
  .strict();
export type PublishedCatalog = z.infer<typeof publishedCatalogSchema>;
const sample = z
  .object({ userAgent: z.string().min(1).max(1000), expectedId: catalogIdSchema.nullable() })
  .strict();
export const registryPreviewSchema = z
  .object({
    hash,
    currentRevision: revision,
    draftRevision: revision,
    contentHash: hash,
    changes: z
      .array(
        z
          .object({ section: label, id: label, kind: z.enum(['added', 'changed', 'disabled']) })
          .strict(),
      )
      .max(5000),
    counts: z
      .object({ added: z.number().int(), changed: z.number().int(), disabled: z.number().int() })
      .strict(),
    conflicts: z.array(text).max(5000),
    samples: z
      .array(sample.extend({ matchedId: catalogIdSchema.nullable(), passed: z.boolean() }))
      .max(100),
  })
  .strict();
export type RegistryPreview = z.infer<typeof registryPreviewSchema>;
export const registryDraftSchema = z
  .object({
    id: z.uuid(),
    title: label,
    revision,
    baseVersion: z.uuid(),
    baseRevision: revision,
    status: z.enum(['draft', 'published']),
    payload: catalogPayloadSchema,
    conflicts: z.array(text).max(5000),
    preview: registryPreviewSchema.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();
export type RegistryDraft = z.infer<typeof registryDraftSchema>;
export const registryVersionSummarySchema = z
  .object({
    version: z.uuid(),
    revision,
    contentHash: hash,
    publishedAt: timestamp,
    actorId: z.uuid().nullable(),
    action: z.enum(['seed', 'publish', 'rollback']),
  })
  .strict();
export type RegistryVersionSummary = z.infer<typeof registryVersionSummarySchema>;
export const crawlerRegistryResponseSchema = z
  .object({
    current: publishedCatalogSchema,
    drafts: z.array(registryDraftSchema).max(50),
    history: z.array(registryVersionSummarySchema).max(100),
  })
  .strict();
export type CrawlerRegistryResponse = z.infer<typeof crawlerRegistryResponseSchema>;
const operationId = z.uuid();
const draft = { operationId, draftId: z.uuid(), expectedDraftRevision: revision };
export const crawlerRegistryCommandSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('createDraft'),
      operationId,
      sourceVersion: z.uuid().optional(),
      title: label.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('rollbackDraft'),
      operationId,
      sourceVersion: z.uuid(),
      title: label.optional(),
    })
    .strict(),
  z.object({ action: z.literal('updateDraft'), ...draft, payload: catalogPayloadSchema }).strict(),
  z
    .object({
      action: z.literal('preview'),
      ...draft,
      samples: z.array(sample).max(100).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('publish'),
      ...draft,
      expectedCurrentRevision: revision,
      previewHash: hash,
    })
    .strict(),
]);
export type CrawlerRegistryCommand = z.infer<typeof crawlerRegistryCommandSchema>;
export const crawlerRegistryCommandResponseSchema = z
  .object({
    action: z.enum(['createDraft', 'rollbackDraft', 'updateDraft', 'preview', 'publish']),
    draft: registryDraftSchema.optional(),
    preview: registryPreviewSchema.optional(),
    current: publishedCatalogSchema.optional(),
  })
  .strict();
export type CrawlerRegistryCommandResponse = z.infer<typeof crawlerRegistryCommandResponseSchema>;
