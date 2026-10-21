import { Resolver } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import { getPublishedCatalog } from './published';
import { publicSourceAddress } from './source-fetch';
import type { AutomaticRecord } from '../log-ingestion/protocol';
import type { CatalogVerificationMethod } from '../contracts/crawler-registry';
import type { CrawlerRuleConfiguration } from '../rules/configuration';

export type RequestIdentityEvidence = {
  method: 'dns' | 'edge'; status: 'verified_dns' | 'verified_edge' | 'unverified';
  reason: string; checkedAt: string; catalogVersion: string; methodId: string | null;
  subjectId: string | null; evidenceHash?: string;
};
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function recordEvidence(record: AutomaticRecord, evidence: RequestIdentityEvidence) {
  record.identityEvidence = evidence;
  if (evidence.status !== 'unverified') {
    record.verification = evidence.status;
    record.verificationReason = evidence.reason;
    record.verificationObservedAt = evidence.checkedAt;
    record.verificationVersion = hash(evidence);
  }
}
/** Called only after the authenticated live source and Zone job have been revalidated. */
export function applyTrustedEdgeIdentity(record: AutomaticRecord, source: {
  kind: string; id: string; provider_config?: string | null; provider_job_id?: string | number | null;
  health?: { fieldCapabilities?: Record<string, boolean> };
}, configuration: CrawlerRuleConfiguration) {
  const catalog = getPublishedCatalog();
  if (!catalog || source.kind !== 'cloudflare' || !source.provider_config || !source.provider_job_id ||
      source.health?.fieldCapabilities?.BotDetectionIDs !== true) return;
  const field = record.crawlerEvidence?.edgeObservation?.fields.BotDetectionIDs;
  if (field?.state !== 'present' || !Array.isArray(field.value)) return;
  const ids = field.value as number[];
  const methods = catalog.payload.verificationMethods.filter(method => method.enabled !== false && method.method === 'edge' && method.provider === 'cloudflare' && method.detectionIds?.some(id => ids.includes(id)));
  const subjects = [...new Set(methods.flatMap(method => method.crawlerIds))];
  if (subjects.length !== 1) return;
  const identity = catalog.payload.identities.find(item => item.id === subjects[0] && item.status === 'active' && item.kind !== 'robots_purpose');
  if (!identity || configuration.mode !== 'official' || configuration.disabledIds.includes(identity.id)) return;
  const evidence: RequestIdentityEvidence = {
    method: 'edge', status: 'verified_edge', reason: 'trusted_cloudflare_identity', checkedAt: new Date().toISOString(),
    catalogVersion: catalog.version, methodId: methods[0].id, subjectId: identity.id,
    evidenceHash: hash([source.id, source.provider_job_id, record.id, record.time, ids]),
  };
  const candidates = [...new Set([
    ...(record.recognitionCandidates ?? []),
    ...(record.crawlerId ? [record.crawlerId] : []),
    identity.id,
  ])].sort();
  if (record.recognitionState === 'ambiguous' || candidates.length > 1) {
    // Preserve the verified edge observation while the combined identity remains unresolved.
    record.identityEvidence = evidence;
    record.crawlerId = null; record.bot = '其他'; record.vendor = ''; record.type = '其他';
    record.aiEligible = false; record.recognitionState = 'ambiguous'; record.recognitionCandidates = candidates;
    record.verification = 'unverified'; record.verificationReason = 'identity_conflict';
    record.verificationVersion = null; record.verificationObservedAt = null;
    return;
  }
  // Only one identity is persisted. A shared provider identity never splits into multiple products.
  record.crawlerId = identity.id; record.bot = identity.name; record.vendor = identity.vendor;
  record.type = configuration.overrides[identity.id]?.type ??
    ({ training: '训练', search: '搜索', user: '用户触发', traditional_search: '传统搜索', other: '其他' })[identity.type];
  record.aiEligible = identity.aiEligible; record.recognitionState = 'recognized'; record.recognitionCandidates = [];
  recordEvidence(record, evidence);
}

/** Raw IP exists only for the bounded DNS operation; persisted evidence contains no address or PTR. */
export async function verifyOfficialDns(ip: string, record: AutomaticRecord, method: CatalogVerificationMethod, options: {
  now?: number; resolver?: Pick<Resolver, 'reverse' | 'resolve4' | 'resolve6' | 'cancel'>;
} = {}): Promise<RequestIdentityEvidence> {
  const now = options.now ?? Date.now(), catalog = getPublishedCatalog();
  const evidence: RequestIdentityEvidence = { method: 'dns', status: 'unverified', reason: 'dns_missing_input', checkedAt: new Date(now).toISOString(), catalogVersion: catalog?.version || '', methodId: method.id, subjectId: record.crawlerId ?? null };
  if (!catalog || method.enabled === false || method.method !== 'dns' || !method.crawlerIds.includes(record.crawlerId) ||
      !publicSourceAddress(ip) || !Number.isFinite(Date.parse(record.time)) || Math.abs(now - Date.parse(record.time)) > 10 * 60_000) return evidence;
  const resolver = options.resolver ?? new Resolver({ timeout: 500, tries: 1 });
  let timer: ReturnType<typeof setTimeout>;
  try {
    const result = await Promise.race([
      (async () => {
        const names = (await resolver.reverse(ip)).slice(0, 8).map(name => name.toLowerCase().replace(/\.$/, ''));
        const allowed = names.filter(name => name.length <= 253 && method.hostSuffixes?.some(suffix => name.endsWith(`.${suffix}`)));
        if (!allowed.length) return { reason: 'dns_suffix_mismatch' };
        const target = ipaddr.process(ip).toNormalizedString();
        for (const name of allowed) {
          const addresses = await Promise.allSettled([resolver.resolve4(name), resolver.resolve6(name)]);
          if (addresses.some(result => result.status === 'fulfilled' && result.value.some(address => ipaddr.process(address).toNormalizedString() === target)))
            return { reason: 'verified_dns', evidenceHash: hash([method.id, name, target, now]) };
        }
        return { reason: 'dns_forward_mismatch' };
      })(),
      new Promise<{ reason: string }>(resolve => { timer = setTimeout(() => { resolver.cancel(); resolve({ reason: 'dns_timeout' }); }, 1000); }),
    ]);
    return { ...evidence, ...result, status: result.reason === 'verified_dns' ? 'verified_dns' : 'unverified' };
  } catch { return { ...evidence, reason: 'dns_unavailable' }; }
  finally { clearTimeout(timer); resolver.cancel(); }
}
export async function verifyDnsBatch(observed: { ip: string; record: AutomaticRecord }[]) {
  const catalog = getPublishedCatalog();
  if (!catalog) return;
  const methods = catalog.payload.verificationMethods.filter(method => method.enabled !== false && method.method === 'dns');
  const selected = observed.filter(({ record }) => record.verification !== 'verified_range' && record.crawlerId && methods.some(method => method.crawlerIds.includes(record.crawlerId)));
  // Eight unique requests at most, four concurrently, so DNS cannot hold an entire import indefinitely.
  for (let index = 0; index < Math.min(selected.length, 8); index += 4)
    await Promise.all(selected.slice(index, Math.min(index + 4, 8)).map(async ({ ip, record }) => recordEvidence(record, await verifyOfficialDns(ip, record, methods.find(method => method.crawlerIds.includes(record.crawlerId))))));
  for (const { record } of selected.slice(8)) recordEvidence(record, { method: 'dns', status: 'unverified', reason: 'dns_budget_exhausted', checkedAt: new Date().toISOString(), catalogVersion: catalog.version, methodId: null, subjectId: record.crawlerId });
}
