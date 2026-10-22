import { createHash } from 'node:crypto';
import { isbot } from 'isbot';
import { classifyBot, MATCHER_VERSION, type BotRule } from '../rules/bots';
import type { CrawlerRuleConfiguration } from '../rules/configuration';
import type { CollectionClassification } from '../upstream/collection-quality';
import {
  HISTORY_REPAIR_ENGINE,
  type HistoryRepairCounts,
  type HistoryRepairStatus,
} from '../contracts/history-repair';

export const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Ordered hexadecimal chunk hashes each include a trailing LF, including the last hash. */
export function evidenceManifestDigest(chunks: Iterable<string>) {
  const digest = createHash('sha256');
  for (const chunk of chunks) digest.update(`${chunk}\n`, 'utf8');
  return digest.digest('hex');
}
export function canonicalRepairTimezone(value: string) {
  if (/^[-+]/.test(value)) throw new RangeError('IANA time zone required');
  const canonical = new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
  if (/^[-+]/.test(canonical)) throw new RangeError('IANA time zone required');
  return canonical;
}
export const terminalStatuses: readonly HistoryRepairStatus[] = [
  'completed',
  'completed_limited',
  'unchanged',
  'unidentifiable',
  'empty',
  'cancelled',
  'rolled_back',
  'expired',
  'invalidated',
];
export const workingStatuses: readonly HistoryRepairStatus[] = [
  'scanning',
  'preparing',
  'queued',
  'running',
  'validating',
];
export const emptyCounts = (): HistoryRepairCounts => ({
  events: '0',
  logs: '0',
  processed: '0',
  changedEvents: '0',
  changedLogs: '0',
  browserEvidence: '0',
  logEvidence: '0',
  missingQuality: '0',
  conflicts: '0',
  undatedEvents: '0',
  beforePV: '0',
  afterPV: '0',
  beforeUV: '0',
  afterUV: '0',
  beforeIdentityMissingPV: '0',
  afterIdentityMissingPV: '0',
});
export function addCounts(base: HistoryRepairCounts, add: Partial<HistoryRepairCounts>) {
  const output = { ...base };
  for (const key of Object.keys(add) as (keyof HistoryRepairCounts)[])
    output[key] = (BigInt(output[key] ?? '0') + BigInt(add[key] ?? '0')).toString();
  return output;
}
export function fraction(numerator: string, denominator: string): number | null {
  const total = BigInt(denominator);
  return total === 0n ? null : Number((BigInt(numerator) * 10000n) / total) / 10000;
}
export function progress(status: HistoryRepairStatus, counts: HistoryRepairCounts): number {
  if (terminalStatuses.includes(status))
    return status === 'expired' || status === 'invalidated' || status === 'cancelled' ? 0 : 100;
  if (status === 'validating') return 97;
  if (['ready', 'queued', 'running'].includes(status)) return 95;
  const total = BigInt(counts.events) + BigInt(counts.logs);
  return total ? Number((95n * BigInt(counts.processed)) / total) : 0;
}
export interface RepairRulepack {
  engine: string;
  matcher: string;
  detector: string;
  botCheckDisabled: boolean;
  catalogVersion: string;
  rulesRevision: number;
  rules: BotRule[];
  configuration: CrawlerRuleConfiguration;
  hash: string;
}
export function rulepack(
  input: Omit<RepairRulepack, 'engine' | 'matcher' | 'detector' | 'hash'>,
): RepairRulepack {
  const value = {
    ...input,
    engine: HISTORY_REPAIR_ENGINE,
    matcher: MATCHER_VERSION,
    detector: 'isbot-5.2.2',
  };
  return { ...value, hash: hash(value) };
}
export interface EventVerdict {
  classification: CollectionClassification;
  source: string | null;
  reasons: string[];
  ruleVersion: string | null;
}
export interface RepairDecision<T> {
  before: T;
  after: T;
  changed: boolean;
  evidence: boolean;
  issue: string | null;
  proof: Record<string, unknown>;
}
const explicitReasons = new Set([
  'ua_bot',
  'request_ua_bot',
  'crawler_ua_token',
  'request_crawler_ua_token',
  'browser_webdriver',
  'official_range_match',
  'official_range_ambiguous',
]);
/** Interpret retained reasons only within their original supported rule version. */
export function eventDecision(
  original: EventVerdict,
  pack: RepairRulepack,
  supplied?: { automated: boolean; reasons: string[]; hash: string; uploadId: string },
): RepairDecision<EventVerdict> {
  const supported = /^traffic-quality-v[123]$/.test(original.ruleVersion || '');
  const explicit =
    supported &&
    !original.reasons.includes('bot_check_disabled') &&
    original.reasons.some(reason => explicitReasons.has(reason));
  const blocked = pack.botCheckDisabled;
  const evidence = original.source === 'browser' && !blocked && (explicit || !!supplied);
  const issue =
    supplied && original.classification === 'automated' && !supplied.automated
      ? 'retained-automation-conflict'
      : null;
  let after = { ...original, reasons: [...original.reasons] };
  if (evidence && (explicit || supplied?.automated) && original.classification !== 'automated') {
    after = {
      ...after,
      classification: 'automated',
      reasons: [
        ...new Set([
          ...original.reasons,
          ...(supplied?.reasons || ['retained_automation_evidence']),
        ]),
      ],
      ruleVersion: HISTORY_REPAIR_ENGINE,
    };
  }
  return {
    before: original,
    after,
    changed: hash(original) !== hash(after),
    evidence,
    issue,
    proof: {
      kind: supplied ? 'administrator-supplied' : 'retained-reason',
      originalRuleVersion: original.ruleVersion,
      originalReasons: original.reasons,
      ...(supplied ? { uploadId: supplied.uploadId, evidenceHash: supplied.hash } : {}),
    },
  };
}
/** An upload establishes automation only; a negative match never establishes a human identity. */
export function classifySuppliedUa(ua: string, pack: RepairRulepack) {
  const match = classifyBot(ua, pack.rules);
  const token = !!match.pattern || match.recognition === 'ambiguous';
  const automated = !pack.botCheckDisabled && (isbot(ua) || token);
  return {
    automated,
    reasons: automated ? [token ? 'administrator_crawler_ua' : 'administrator_ua_bot'] : [],
    hash: hash(ua),
  };
}
export interface LogVerdict {
  bot: string;
  vendor: string;
  botType: string;
  aiEligible: boolean | null;
  crawlerId: string | null;
  recognitionState: string | null;
  recognitionCandidates: string[];
  verification: string;
  verificationVersion: string | null;
  verificationObservedAt: string | null;
  verificationReason: string | null;
}
export interface LogRepairCatalog {
  originalVersion: string | null;
  originalProductForm: string | null;
  forms: ReadonlyMap<string, string>;
}
export interface LogRepairDecision extends RepairDecision<LogVerdict> {
  productForm: { before: string | null; after: string | null };
}
export function logDecision(
  original: LogVerdict,
  ua: string,
  pack: RepairRulepack,
  identityProof?: { subjectId?: string; status?: string } | null,
  catalog?: LogRepairCatalog,
): LogRepairDecision {
  const sufficient = ua.length > 0 && ua.length < 500;
  const originalProductForm = catalog?.originalProductForm || null;
  const retained = {
    before: original,
    after: original,
    changed: false,
    evidence: false,
    productForm: { before: originalProductForm, after: originalProductForm },
    proof: {
      kind: 'retained-log',
      rulepack: pack.hash,
      catalogVersion: catalog ? catalog.originalVersion : pack.catalogVersion,
    },
  };
  if (!ua || pack.botCheckDisabled || pack.configuration.mode === 'disabled')
    return {
      ...retained,
      issue: !ua ? 'missing-log-ua' : 'classification-disabled',
    };
  const match = classifyBot(ua, pack.rules);
  // Truncated inputs can prove a positive token, while negative results retain original facts.
  if (!sufficient && !match.pattern && match.recognition !== 'ambiguous')
    return {
      ...retained,
      issue: 'truncated-log-ua',
    };
  const rawProofId = identityProof?.subjectId || original.crawlerId;
  const verified = ['verified_range', 'verified_dns', 'verified_edge'].includes(
    original.verification,
  );
  const conflict =
    verified &&
    !!rawProofId &&
    (match.crawlerId !== rawProofId || match.recognition === 'ambiguous');
  const sameIdentity =
    verified && !!original.crawlerId && match.crawlerId === original.crawlerId && !conflict;
  const after: LogVerdict = {
    bot: conflict ? '其他' : match.name,
    vendor: conflict ? '' : match.vendor,
    botType: conflict ? '其他' : match.type,
    aiEligible: conflict
      ? false
      : (match.aiEligible ?? ['训练', '搜索', '用户触发'].includes(match.type)),
    crawlerId: conflict ? null : match.crawlerId || null,
    recognitionState: conflict
      ? 'ambiguous'
      : match.recognition || (match.pattern ? 'recognized' : 'unknown'),
    recognitionCandidates: conflict
      ? [
          ...new Set([
            rawProofId,
            ...(match.candidateIds || []),
            ...(match.crawlerId ? [match.crawlerId] : []),
          ]),
        ].sort()
      : match.candidateIds || [],
    verification: sameIdentity ? original.verification : 'unverified',
    verificationVersion: sameIdentity ? original.verificationVersion : null,
    verificationObservedAt: sameIdentity ? original.verificationObservedAt : null,
    verificationReason: sameIdentity
      ? original.verificationReason
      : conflict
        ? 'historical-identity-conflict'
        : 'historical-ua-only',
  };
  const afterProductForm = after.crawlerId ? catalog?.forms.get(after.crawlerId) || null : null;
  return {
    before: original,
    after,
    changed: hash(original) !== hash(after) || originalProductForm !== afterProductForm,
    evidence: sufficient || !!match.pattern,
    productForm: { before: originalProductForm, after: afterProductForm },
    issue: conflict ? 'identity-conflict' : sufficient ? null : 'truncated-log-ua',
    proof: {
      kind: 'retained-log',
      rulepack: pack.hash,
      catalogVersion: pack.catalogVersion,
      originalCrawlerId: original.crawlerId,
      originalVerification: original.verification,
      originalVerificationVersion: original.verificationVersion,
      originalIdentitySubject: identityProof?.subjectId || null,
    },
  };
}
export interface PreviewPolicy {
  mode: 'standard' | 'strict' | 'raw';
  allowedHostnames: string[];
  revision: string;
}
export function includedEvent(
  verdict: EventVerdict,
  eventType: number,
  hostname: string | null,
  policy: PreviewPolicy,
  context: { originHostname?: string | null; excluded?: boolean } = {},
) {
  if (context.excluded) return false;
  if (verdict.source !== 'browser' || ![1, 2, 5].includes(eventType)) return false;
  return (
    verdict.classification !== 'automated' &&
    !verdict.reasons.includes('bot_check_disabled') &&
    (policy.mode !== 'strict' || verdict.classification !== 'suspected') &&
    (!policy.allowedHostnames.length || (policy.allowedHostnames.includes(hostname) &&
      (!context.originHostname || policy.allowedHostnames.includes(context.originHostname))))
  );
}

/** Missing historical identity evidence remains unknown in public previews and exports. */
export function publicRepairCounts(counts: HistoryRepairCounts): HistoryRepairCounts {
  const result = { ...counts };
  for (const side of ['before', 'after'] as const) {
    const missing = counts[`${side}IdentityMissingPV`];
    const qualified = counts[`${side}QualifiedUV`] ?? (missing != null ? counts[`${side}UV`] : null);
    result[`${side}QualifiedUV`] = qualified;
    result[`${side}IdentityMissingPV`] = missing ?? null;
    result[`${side}UV`] = missing === '0' ? qualified : null;
  }
  return result;
}
export function publicRepairPreview<T extends { counts: HistoryRepairCounts }>(preview: T | null): T | null {
  return preview ? { ...preview, counts: publicRepairCounts(preview.counts) } : null;
}
