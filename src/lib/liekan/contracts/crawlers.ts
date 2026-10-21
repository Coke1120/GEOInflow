import { z } from 'zod';

import { crawlerControllableBotIds } from '../crawlers/registry';

export {
  type CrawlerBotId,
  type CrawlerHttpBotId,
  type CrawlerPlatformId,
  type CrawlerType,
  crawlerBotIds,
  crawlerControllableBotIds,
  crawlerHttpBotIds,
  crawlerPlatformIds,
  crawlerRobotsBotIds,
} from '../crawlers/registry';

import type { CrawlerBotId, CrawlerPlatformId, CrawlerType } from '../crawlers/registry';

export type CrawlerIdentity = 'declared_ua' | 'verified_dns' | 'verified_edge' | 'verified_range' | 'range_mismatch' | 'unverified';
export const CRAWLER_MAX_LOCAL_DRAFTS = 20;

export function crawlerHasControlCharacters(value: string) {
  return Array.from(value).some(character => {
    const code = character.codePointAt(0);
    return code < 32 || (code >= 127 && code <= 159);
  });
}

// Preserve the supplied bytes, case, percent encoding and trailing slash.
export const crawlerPathSchema = z.strictObject({
  value: z
    .string()
    .min(1)
    .max(512)
    .startsWith('/')
    .refine(
      value => !crawlerHasControlCharacters(value) && !/[\s"'\\;?#]/u.test(value),
      'Unsafe path character',
    )
    .refine(value => !/%(?![0-9a-f]{2})/i.test(value), 'Invalid percent encoding')
    .refine(value => !/[\ud800-\udfff]/u.test(value), 'Invalid path encoding'),
  match: z.enum(['exact', 'prefix']),
});
export type CrawlerPath = z.infer<typeof crawlerPathSchema>;

const policyFields = {
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine(value => !crawlerHasControlCharacters(value), 'Invalid policy name'),
  botIds: z
    .array(z.enum(crawlerControllableBotIds))
    .min(1)
    .max(10)
    .refine(values => new Set(values).size === values.length, 'Duplicate crawler'),
  paths: z
    .array(crawlerPathSchema)
    .min(1)
    .max(10)
    .refine(
      values => new Set(values.map(value => JSON.stringify(value))).size === values.length,
      'Duplicate path',
    ),
  action: z.enum(['observe', 'block']),
  expectedAccess: z.enum(['allow', 'block']),
};
export const crawlerPolicyInputSchema = z.strictObject(policyFields);
export const crawlerPolicyCreateSchema = crawlerPolicyInputSchema;
export const crawlerPolicyUpdateSchema = z.strictObject({
  ...policyFields,
  version: z.number().int().positive().max(1_000_000_000),
});
export type CrawlerPolicyInput = z.infer<typeof crawlerPolicyInputSchema>;
export const crawlerConnectionInputSchema = z.strictObject({
  zoneId: z.string().regex(/^[a-f0-9]{32}$/i),
  token: z
    .string()
    .min(1)
    .max(512)
    .refine(value => !crawlerHasControlCharacters(value) && !/\s/u.test(value), 'Invalid token'),
});
export const crawlerPreviewInputSchema = z
  .strictObject({
    operation: z.enum(['deploy', 'stop', 'rollback', 'cleanup']),
    targetVersion: z.number().int().positive().max(1_000_000_000).optional(),
  })
  .refine(
    value => (value.operation === 'rollback' ? value.targetVersion !== undefined : true),
    'Rollback requires a target version',
  );
export const crawlerConfirmInputSchema = z.strictObject({
  operationId: z.uuid(),
  previewId: z.uuid(),
});

export interface CrawlerRequestCounts {
  requests: number;
  status1xx: number;
  status2xx: number;
  status3xx: number;
  status304: number;
  status4xx: number;
  status5xx: number;
  denied403429: number;
  head: number;
  successfulGets: number;
}
export interface CrawlerObservationQuality {
  state: 'complete' | 'partial' | 'unknown' | 'missing' | 'unsupported';
  basis: 'event_time' | 'ingestion_time' | 'unknown';
  classificationVersion: string;
  sourceVersion: string;
  timezone: string;
}
export interface CrawlerSummary {
  botId: CrawlerBotId;
  platformId: CrawlerPlatformId;
  name: string;
  type: CrawlerType;
  httpCapable: boolean;
  counts: CrawlerRequestCounts | null;
  quality: CrawlerObservationQuality;
  identity: CrawlerIdentity;
  platformReferralId: CrawlerPlatformId;
}
export interface CrawlerPlatformReferral {
  platformId: CrawlerPlatformId;
  visits: number | null;
  state: 'available' | 'missing' | 'unsupported';
}
export type CrawlerRiskType =
  | 'access'
  | 'origin'
  | 'surge'
  | 'coverage'
  | 'expected_access'
  | 'identity'
  | 'sensitive_path'
  | 'observation'
  | 'execution';
export interface CrawlerRiskFinding {
  key: string;
  botId: CrawlerBotId;
  type: CrawlerRiskType;
  pathGroup: string;
  grade: 'high' | 'medium' | 'info';
  confidence: 'confirmed' | 'possible' | 'insufficient';
  status: 'active' | 'pending' | 'resolved';
  reason: string;
  evidence: Record<string, number | string | null>;
  windowStart: number;
  windowEnd: number;
}
export interface CrawlerPolicy extends CrawlerPolicyInput {
  id: string;
  websiteId: string;
  version: number;
  state: 'draft' | 'enabled' | 'stopped';
  appliedVersion: number | null;
  connectionId: string | null;
  ref: string;
  remoteRuleId: string | null;
  remoteRulesetId: string | null;
  remoteHash: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface CrawlerConnection {
  id: string;
  websiteId: string;
  zoneId: string;
  domain: string;
  state: 'active' | 'frozen' | 'disconnected' | 'cleanup';
  capabilities: Record<string, boolean | number | string | null>;
  testedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface CrawlerDeployment {
  id: string;
  websiteId: string;
  policyId: string;
  policyVersion: number;
  operation: 'deploy' | 'stop' | 'rollback' | 'cleanup';
  state: 'queued' | 'running' | 'confirmed' | 'unknown' | 'failed' | 'conflict' | 'cleanup';
  ref: string;
  ruleId: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}
