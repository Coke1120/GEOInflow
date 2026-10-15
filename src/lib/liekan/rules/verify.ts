import { createHash } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import snapshots from '../../../../config/liekan/bot-ranges.json';
import { BOT_RULES } from './bots';
export type VerificationSnapshots = Record<
  string,
  { prefixes: string[]; retrievedAt: string; version?: string }
>;
export const bundledVerificationSnapshots: VerificationSnapshots = Object.fromEntries(
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
type Prefix = ReturnType<typeof ipaddr.parseCIDR>;
const compiledRanges = new WeakMap<
  string[],
  { signature: string; ipv4: Prefix[]; ipv6: Prefix[] }
>();
function ranges(prefixes: string[]) {
  const signature = prefixes.join('\0');
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
export function verifyBotIp(
  ip: string,
  bot: string,
  ua: string,
  time: string,
  evidence: VerificationSnapshots = bundledVerificationSnapshots,
): string {
  const snapshot = evidence[bot];
  const known = BOT_RULES.find(rule => rule.name === bot);
  if (!snapshot || !known || !ua.toLowerCase().includes(known.pattern.toLowerCase()))
    return 'unverified';
  const fetched = new Date(snapshot.retrievedAt).getTime();
  if (
    Math.abs(Date.now() - fetched) > 7 * 86400000 ||
    Math.abs(new Date(time).getTime() - fetched) > 7 * 86400000
  )
    return 'unverified';
  const address = ipaddr.process(ip);
  const matches = ranges(snapshot.prefixes)[address.kind()].some(([network, bits]) =>
    address.match(network, bits),
  );
  return matches ? 'verified_range' : 'range_mismatch';
}
