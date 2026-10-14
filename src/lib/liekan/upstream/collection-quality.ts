import { normalizeIp, configuredIp } from '@/lib/ip';
import { createHash } from 'node:crypto';
import { browserName } from 'detect-browser';
import ipaddr from 'ipaddr.js';
import { isbot } from 'isbot';
import officialSnapshots from '../../../../config/liekan/bot-ranges.json';
import type { VerificationSnapshots } from '../rules/verify';

export const COLLECTION_RULE_VERSION = 'traffic-quality-v1';
export type CollectionClassification = 'browser' | 'automated' | 'suspected' | 'unknown';
export type CollectionSource = 'browser' | 'authenticated_server' | 'legacy_override';
export type CollectionRangeStatus = 'fresh' | 'stale' | 'missing' | 'untrusted' | 'invalid';
export interface CollectionQuality {
  classification: CollectionClassification;
  source: CollectionSource;
  reasons: string[];
  ruleVersion: string;
  rangeVersion: string | null;
  rangeStatus: CollectionRangeStatus;
  hostname: string | null;
}
export interface CollectionInput {
  request: Request;
  payload: Record<string, any>;
  authenticated: boolean;
  ip: string;
  userAgent: string;
  snapshots: VerificationSnapshots;
  now?: Date;
}

const RANGE_MAX_AGE = 7 * 86400000;
const OVERRIDE_FIELDS = ['ip', 'userAgent', 'browser', 'os', 'device'] as const;

function hasUrlAuthority(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[a-z][a-z0-9+.-]*:)?\/\/[^/\\]/i.test(value.trim());
}

export function normalizeCollectionHostname(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  const fullUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const protocolRelative = trimmed.startsWith('//');
  if ((fullUrl || protocolRelative) && !hasUrlAuthority(trimmed)) return null;
  if (/^[/\\]/.test(trimmed) && !protocolRelative) return null;
  try {
    const url = new URL(
      protocolRelative ? `https:${trimmed}` : fullUrl ? trimmed : `https://${trimmed}`,
    );
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (
      !fullUrl &&
      !protocolRelative &&
      (url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    )
      return null;
    const hostname = url.hostname
      .toLowerCase()
      .replace(/\.$/, '')
      .replace(/^www\./, '');
    if (!hostname || hostname.length > 253) return null;
    return hostname;
  } catch {
    return null;
  }
}

function address(value: unknown) {
  const clean = typeof value === 'string' ? normalizeIp(value) : undefined;
  return clean ? ipaddr.parse(clean) : null;
}

function trustedAddress(input: CollectionInput) {
  const clientAddress = address(input.ip);
  if (!clientAddress) return null;
  if (input.authenticated) return clientAddress;
  const candidate = configuredIp(input.request.headers);
  if (candidate?.ip === clientAddress.toString()) return clientAddress;
  return null;
}

type RangeEvidence = {
  status: CollectionRangeStatus;
  version: string | null;
  freshMatches: number;
};

function rangeEvidence(input: CollectionInput): RangeEvidence {
  const entries = Object.entries(input.snapshots || {});
  const empty = (status: CollectionRangeStatus): RangeEvidence => ({
    status,
    version: null,
    freshMatches: 0,
  });
  if (!entries.length) return empty('missing');
  const clientAddress = trustedAddress(input);
  if (!clientAddress)
    return empty(input.authenticated && !address(input.ip) ? 'invalid' : 'untrusted');
  const timestamp = +(input.now || new Date());
  if (!Number.isFinite(timestamp)) return empty('invalid');
  const eventTimestamp =
    input.payload?.timestamp == null
      ? timestamp
      : typeof input.payload.timestamp === 'number'
        ? input.payload.timestamp * 1000
        : NaN;
  if (!Number.isFinite(eventTimestamp)) return empty('invalid');
  const available: CollectionRangeStatus[] = [];
  const matching: { status: 'fresh' | 'stale'; version: string }[] = [];
  for (const [bot, snapshot] of entries) {
    const official = Object.hasOwn(officialSnapshots, bot)
      ? officialSnapshots[bot as keyof typeof officialSnapshots]
      : null;
    if (!official) {
      available.push('untrusted');
      continue;
    }
    try {
      if (
        !snapshot ||
        typeof snapshot !== 'object' ||
        !Array.isArray(snapshot.prefixes) ||
        !snapshot.prefixes.length ||
        snapshot.prefixes.length > 5000 ||
        typeof snapshot.retrievedAt !== 'string'
      )
        throw new Error('Invalid range snapshot');
      if ('source' in snapshot && snapshot.source !== official.source) {
        available.push('untrusted');
        continue;
      }
      const retrievedAt = +new Date(snapshot.retrievedAt);
      if (!Number.isFinite(retrievedAt) || retrievedAt > timestamp)
        throw new Error('Invalid range time');
      const prefixes = snapshot.prefixes.map(prefix => {
        if (typeof prefix !== 'string') throw new Error('Invalid CIDR');
        return ipaddr.parseCIDR(prefix);
      });
      const status =
        timestamp - retrievedAt <= RANGE_MAX_AGE &&
        Math.abs(eventTimestamp - retrievedAt) <= RANGE_MAX_AGE
          ? 'fresh'
          : 'stale';
      available.push(status);
      if (
        prefixes.some(
          ([network, bits]) =>
            network.kind() === clientAddress.kind() && clientAddress.match(network, bits),
        )
      ) {
        const version =
          typeof snapshot.version === 'string' && snapshot.version
            ? snapshot.version
            : createHash('sha256')
                .update(JSON.stringify([...snapshot.prefixes].sort()))
                .digest('hex');
        matching.push({ status, version });
      }
    } catch {
      available.push('invalid');
    }
  }
  const fresh = matching.filter(match => match.status === 'fresh');
  const used = fresh.length ? fresh : matching;
  const status = used.length
    ? fresh.length
      ? 'fresh'
      : 'stale'
    : available.includes('invalid')
      ? 'invalid'
      : available.includes('untrusted')
        ? 'untrusted'
        : available.includes('fresh')
          ? 'fresh'
          : 'stale';
  return {
    status,
    version: used.length
      ? createHash('sha256')
          .update(JSON.stringify(used.map(match => match.version).sort()))
          .digest('hex')
      : null,
    freshMatches: fresh.length,
  };
}

export function classifyCollection(input: CollectionInput): CollectionQuality {
  const legacy = OVERRIDE_FIELDS.some(field => input.payload?.[field] != null);
  const source: CollectionSource = input.authenticated
    ? 'authenticated_server'
    : legacy
      ? 'legacy_override'
      : 'browser';
  const ranges = rangeEvidence(input);
  const ua = typeof input.userAgent === 'string' ? input.userAgent : '';
  const automated = ranges.freshMatches > 0 || isbot(ua);
  let classification: CollectionClassification;
  let reasons: string[];
  if (automated && process.env.DISABLE_BOT_CHECK) {
    classification = 'unknown';
    reasons = ['bot_check_disabled'];
  } else if (ranges.freshMatches) {
    classification = 'automated';
    reasons = [ranges.freshMatches > 1 ? 'official_range_ambiguous' : 'official_range_match'];
  } else if (automated) {
    classification = 'automated';
    reasons = ['ua_bot'];
  } else if (source === 'legacy_override') {
    classification = 'suspected';
    reasons = ['legacy_payload_override'];
  } else if (browserName(ua)) {
    classification = 'browser';
    reasons = ['browser_compatible'];
  } else {
    classification = 'unknown';
    reasons = ['ua_unrecognized'];
  }
  return {
    classification,
    source,
    reasons,
    ruleVersion: COLLECTION_RULE_VERSION,
    rangeVersion: ranges.version,
    rangeStatus: ranges.status,
    hostname:
      (hasUrlAuthority(input.payload?.url)
        ? normalizeCollectionHostname(input.payload.url)
        : null) || normalizeCollectionHostname(input.payload?.hostname),
  };
}
