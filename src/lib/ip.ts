import ipaddr from 'ipaddr.js';

export const IP_ADDRESS_HEADERS = [
  ...(process.env.CLOUD_MODE ? ['x-umami-client-ip'] : []), // Umami custom header (cloud mode only)
  'true-client-ip', // CDN
  'cf-connecting-ip', // Cloudflare
  'fastly-client-ip', // Fastly
  'x-nf-client-connection-ip', // Netlify
  'do-connecting-ip', // Digital Ocean
  'x-real-ip', // Reverse proxy
  'x-appengine-user-ip', // Google App Engine
  'x-forwarded-for',
  'forwarded',
  'x-client-ip',
  'x-cluster-client-ip',
  'x-forwarded',
];

/** Parse one address; forwarding chains are handled separately. */
export function normalizeIp(value?: string | null): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  let clean = value.trim();
  const bracketed = clean.match(/^\[([^\]]+)\](?::\d{1,5})?$/);
  if (bracketed) clean = bracketed[1];
  else if (/^\d+\.\d+\.\d+\.\d+:\d{1,5}$/.test(clean))
    clean = clean.slice(0, clean.lastIndexOf(':'));
  // Scoped/link-local interface identifiers are not visitor addresses.
  if (clean.includes('%')) return undefined;
  if (!clean.includes(':') && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(clean)) return undefined;
  if (!clean.includes(':')) {
    const bytes = clean.split('.').map(Number);
    if (bytes.some(n => n > 255)) return undefined;
    clean = bytes.join('.');
  }
  try {
    return ipaddr.process(clean).toString();
  } catch {
    return undefined;
  }
}

export function parseIpHeader(name: string, value?: string | null) {
  if (!value) return undefined;
  const header = name.toLowerCase();
  // The leftmost hop is the client. Do not promote a later proxy hop to client.
  if (header === 'x-forwarded-for') return normalizeIp(value.split(',')[0]);
  if (header === 'forwarded') {
    const match = value.split(',')[0].match(/(?:^|;)\s*for=(?:"([^"]+)"|([^;\s]+))/i);
    return normalizeIp(match?.[1] || match?.[2]);
  }
  return normalizeIp(value);
}

export function configuredIp(headers: Headers) {
  const names = [
    process.env.CLIENT_IP_HEADER,
    ...(process.env.CLOUD_MODE ? ['x-umami-client-ip'] : []),
  ].filter(Boolean);
  for (const name of names) {
    try {
      const ip = parseIpHeader(name, headers.get(name));
      if (ip) return { ip, source: 'trusted_ingress' as const, header: name.toLowerCase() };
    } catch {
      /* An invalid configured header cannot establish trust. */
    }
  }
  return undefined;
}

export function getIpAddress(headers: Headers) {
  const configured = configuredIp(headers);
  if (configured) return configured.ip;
  for (const name of IP_ADDRESS_HEADERS) {
    const ip = parseIpHeader(name, headers.get(name));
    if (ip) return ip;
  }
  return undefined;
}

export type IpEvidence = {
  ip?: string;
  source: 'trusted_ingress' | 'authenticated_server' | 'legacy_override' | 'unverified' | 'missing';
  trusted: boolean;
  invalidInput?: boolean;
};
export function resolveClientIp(
  headers: Headers,
  payloadIp?: string,
  authenticated = false,
): IpEvidence {
  const candidateNames = [process.env.CLIENT_IP_HEADER, ...IP_ADDRESS_HEADERS].filter(Boolean);
  const invalidInput =
    !!(payloadIp && !normalizeIp(payloadIp)) ||
    candidateNames.some(name => {
      try {
        const value = headers.get(name);
        return !!value && !parseIpHeader(name, value);
      } catch {
        return false;
      }
    });
  const supplied = normalizeIp(payloadIp);
  if (authenticated && supplied)
    return { invalidInput, ip: supplied, source: 'authenticated_server', trusted: true };
  const ingress = configuredIp(headers);
  if (ingress) return { invalidInput, ip: ingress.ip, source: ingress.source, trusted: true };
  if (supplied) return { invalidInput, ip: supplied, source: 'legacy_override', trusted: false };
  const ip = getIpAddress(headers);
  return { invalidInput, ip, source: ip ? 'unverified' : 'missing', trusted: false };
}

export function stripPort(ip?: string | null) {
  if (!ip) return ip;
  const normalized = normalizeIp(ip);
  return normalized || ip;
}

export function ipPurpose(ip?: string) {
  const clean = normalizeIp(ip);
  if (!clean) return 'invalid';
  return ipaddr.parse(clean).range();
}
export function isGeolocatable(ip?: string) {
  return ![
    'invalid',
    'unspecified',
    'broadcast',
    'multicast',
    'linkLocal',
    'loopback',
    'private',
    'uniqueLocal',
    'reserved',
    'carrierGradeNat',
  ].includes(ipPurpose(ip));
}

type IpRange = [ipaddr.IPv4 | ipaddr.IPv6, number];
let ruleSource: string | undefined;
let blockedRanges: IpRange[] = [];
let invalidRules = 0;
export function normalizedCidr(value: string): IpRange | undefined {
  try {
    if (!value.includes('/')) {
      const ip = normalizeIp(value);
      if (!ip) return undefined;
      const addr = ipaddr.parse(ip);
      return [addr, addr.kind() === 'ipv4' ? 32 : 128];
    }
    const [addr, bits] = ipaddr.parseCIDR(value.trim());
    if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress() && bits >= 96)
      return [(addr as ipaddr.IPv6).toIPv4Address(), bits - 96];
    return [addr, bits];
  } catch {
    return undefined;
  }
}
export function hasIgnoredIp(ip?: string) {
  const source = process.env.IGNORE_IP || '';
  if (source !== ruleSource) {
    const values = source
      .split(',')
      .map(n => n.trim())
      .filter(Boolean);
    const ranges = values.map(normalizedCidr);
    invalidRules = ranges.filter(n => !n).length;
    // Initial partial configuration uses valid entries. Runtime invalid updates preserve the last valid set.
    if (ruleSource === undefined || !invalidRules) blockedRanges = ranges.filter(Boolean);
    ruleSource = source;
    if (invalidRules)
      console.warn('IGNORE_IP contains invalid rules; valid filtering policy retained.');
  }
  const clean = normalizeIp(ip);
  if (!clean) return false;
  const addr = ipaddr.parse(clean);
  const mapped = addr.kind() === 'ipv4' ? ipaddr.IPv6.parse(`::ffff:${clean}`) : addr;
  return blockedRanges.some(([network, bits]) => {
    const candidate =
      network.kind() === addr.kind() ? addr : network.kind() === 'ipv6' ? mapped : undefined;
    return (
      candidate && candidate.kind() === network.kind() && candidate.match(network as any, bits)
    );
  });
}
export function ipConfigurationStatus() {
  // Compile pending rules without retaining an address.
  hasIgnoredIp();
  return {
    trustedIngressConfigured: !!(process.env.CLIENT_IP_HEADER || process.env.CLOUD_MODE),
    ignoreRuleCount: blockedRanges.length,
    invalidIgnoreRuleCount: invalidRules,
  };
}
