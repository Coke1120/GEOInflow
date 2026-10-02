import ipaddr from 'ipaddr.js';
import snapshots from '../../../../config/liekan/bot-ranges.json';
import { BOT_RULES } from './bots';
export function verifyBotIp(ip: string, bot: string, ua: string, time: string): string {
  const snapshot = snapshots[bot];
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
  const matches = snapshot.prefixes.some(prefix => {
    const [network, bits] = ipaddr.parseCIDR(prefix);
    return address.kind() === network.kind() && address.match(network, bits);
  });
  return matches ? 'verified_range' : 'range_mismatch';
}
