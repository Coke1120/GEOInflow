import { createHash } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import snapshots from '../../../../config/liekan/bot-ranges.json';
import { rangeBaselines } from '../crawlers/range-check';
import { rangeSources, getRangeSources } from '../crawlers/range-sources';
import { classifyBot, officialCrawlerForRule, LEGACY_BOT_RULES, type BotClassification } from './bots';

export type VerificationSnapshots = Record<
  string,
  { prefixes: string[]; retrievedAt: string; version?: string; source?: string }
>;
/** Preserve the original content IDs for historical evidence and compatible recovery. */
export const legacyBundledVerificationSnapshots: VerificationSnapshots = Object.fromEntries(
  Object.entries(snapshots).map(([bot, snapshot]) => [
    bot,
    {
      ...snapshot,
      version: createHash('sha256')
        .update(JSON.stringify(['bundled-v1', bot, snapshot.source, [...snapshot.prefixes].sort()]))
        .digest('hex'),
    },
  ]),
);
export const bundledVerificationSnapshots: VerificationSnapshots = Object.fromEntries(
  rangeSources.flatMap(source => {
    const baseline = rangeBaselines[source.id];
    return baseline
      ? source.names.map(name => [
          name,
          {
            prefixes: baseline.content.prefixes,
            retrievedAt: baseline.observedAt,
            version: baseline.content.version,
            source: source.url,
          },
        ])
      : [];
  }),
);
type Prefix = ReturnType<typeof ipaddr.parseCIDR>;
const compiledRanges = new WeakMap<
  string[],
  { signature: string | null; ipv4: Prefix[]; ipv6: Prefix[] }
>();
function ranges(prefixes: string[]) {
  // Production snapshots are immutable. Mutable caller fixtures retain mutation detection.
  const signature = Object.isFrozen(prefixes) ? null : prefixes.join('\0');
  const cached = compiledRanges.get(prefixes);
  if (cached?.signature === signature) return cached;
  const compiled = { signature, ipv4: [] as Prefix[], ipv6: [] as Prefix[] };
  for (const prefix of prefixes) {
    const network = ipaddr.parseCIDR(prefix);
    compiled[network[0].kind()].push(network);
  }
  compiledRanges.set(prefixes, compiled);
  return compiled;
}
export function rangeContainsAddress(
  prefixes: string[],
  address: ReturnType<typeof ipaddr.process>,
) {
  return ranges(prefixes)[address.kind()].some(([network, bits]) => address.match(network, bits));
}
export type VerificationReason =
  | 'no_official_source'
  | 'untrusted_ip'
  | 'ambiguous_name'
  | 'unmapped_identity'
  | 'missing_snapshot'
  | 'invalid_snapshot'
  | 'stale_snapshot'
  | 'range_mismatch'
  | 'verified_range';
export function verifyBotIpEvidence(
  ip: string,
  bot: string,
  ua: string,
  time: string,
  evidence: VerificationSnapshots = bundledVerificationSnapshots,
  options: { trustedIp?: boolean; now?: number; identity?: BotClassification } = {},
): {
  status: 'unverified' | 'verified_range' | 'range_mismatch';
  reason: VerificationReason;
  version: string | null;
  observedAt: string | null;
} {
  const result = (
    reason: VerificationReason,
    version: string | null = null,
    observedAt: string | null = null,
  ) => ({
    status:
      reason === 'verified_range' || reason === 'range_mismatch' ? reason : ('unverified' as const),
    reason,
    version,
    observedAt,
  });
  const supplied = options.identity;
  const historical = supplied && Object.keys(supplied).length === 4 && LEGACY_BOT_RULES.some(rule =>
    Object.entries(rule).every(([key, value]) => supplied[key] === value));
  const identity = supplied && !historical ? supplied : classifyBot(ua);
  if (identity.recognition === 'ambiguous') return result('ambiguous_name');
  if (!identity.crawlerId || identity.name !== bot || !officialCrawlerForRule(identity)) return result('unmapped_identity');
  const source = getRangeSources().find(
    entry => entry.names.includes(bot) && entry.crawlerIds.includes(identity.crawlerId!),
  );
  if (!source) return result('no_official_source');
  if (options.trustedIp === false) return result('untrusted_ip');
  const snapshot = evidence[bot];
  if (!snapshot) return result('missing_snapshot');
  const now = options.now ?? Date.now();
  const fetched = Date.parse(snapshot.retrievedAt),
    event = Date.parse(time);
  const version =
    typeof snapshot.version === 'string' && /^[a-f0-9]{64}$/.test(snapshot.version)
      ? snapshot.version
      : null;
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(fetched) ||
    !Number.isFinite(event) ||
    fetched > now
  )
    return result('invalid_snapshot', version);
  const observedAt = new Date(fetched).toISOString();
  // Historical Google snapshots used the earlier official URL, which remains valid evidence.
  const legacySource = (snapshots as Record<string, { source: string }>)[bot]?.source;
  if (snapshot.source && snapshot.source !== source.url && snapshot.source !== legacySource)
    return result('invalid_snapshot', version, observedAt);
  if (now - fetched > 7 * 86400000 || Math.abs(event - fetched) > 7 * 86400000)
    return result('stale_snapshot', version, observedAt);
  try {
    if (!snapshot.prefixes.length) return result('missing_snapshot', version, observedAt);
    const matches = rangeContainsAddress(snapshot.prefixes, ipaddr.process(ip));
    return result(matches ? 'verified_range' : 'range_mismatch', version, observedAt);
  } catch {
    return result('invalid_snapshot', version, observedAt);
  }
}
export function verifyBotIp(
  ip: string,
  bot: string,
  ua: string,
  time: string,
  evidence: VerificationSnapshots = bundledVerificationSnapshots,
): string {
  return verifyBotIpEvidence(ip, bot, ua, time, evidence).status;
}
