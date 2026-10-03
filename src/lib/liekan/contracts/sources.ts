export type EntrySource = {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  referrer?: string | null;
};
type Channel = 'AI 搜索引荐' | '传统搜索' | '其他引荐' | '直接访问';
export const aiAliases = {
  chatgpt: 'chatgpt.com',
  openai: 'chat.openai.com',
  perplexity: 'perplexity.ai',
  claude: 'claude.ai',
  gemini: 'gemini.google.com',
  copilot: 'copilot.microsoft.com',
  doubao: 'doubao.com',
  kimi: 'kimi.com',
  'kimi.moonshot.cn': 'kimi.moonshot.cn',
  yiyan: 'yiyan.baidu.com',
  deepseek: 'deepseek.com',
};
export const searchAliases = {
  google: 'google.com',
  'google.com.hk': 'google.com.hk',
  'google.cn': 'google.cn',
  bing: 'bing.com',
  baidu: 'baidu.com',
  sogou: 'sogou.com',
  '360': 'so.com',
  so: 'so.com',
  duckduckgo: 'duckduckgo.com',
  yahoo: 'yahoo.com',
};
export const nonSearchMedia = new Set([
  'email',
  'e-mail',
  'newsletter',
  'sms',
  'social',
  'paid_social',
  'paid-social',
  'display',
  'affiliate',
  'push',
  'banner',
]);
const domains = (host: string, values: string[]) =>
  values.some(domain => host === domain || host.endsWith(`.${domain}`));
const domainChannel = (host: string): Channel =>
  domains(host, Object.values(aiAliases))
    ? 'AI 搜索引荐'
    : domains(host, Object.values(searchAliases))
      ? '传统搜索'
      : '其他引荐';

export function classifyEntrySource(entry: EntrySource): { source: string; channel: Channel } {
  const source = entry.utmSource?.trim() || '';
  const medium = entry.utmMedium?.trim().toLowerCase() || '';
  const normalized = source.toLowerCase();
  // Only explicit aliases and approved domains identify a platform. Unknown UTM values stay visible.
  const canonical =
    (Object.hasOwn(aiAliases, normalized) ? aiAliases[normalized] : '') ||
    (Object.hasOwn(searchAliases, normalized) ? searchAliases[normalized] : '') ||
    source;
  if (source || medium)
    return {
      source: canonical || `UTM / ${medium}`,
      channel:
        nonSearchMedia.has(medium) || !source ? '其他引荐' : domainChannel(canonical.toLowerCase()),
    };
  // A campaign name alone carries no channel evidence; preserve it for inspection and use Referer.
  const referrer = entry.referrer?.trim().toLowerCase() || '';
  return referrer && referrer !== '直接访问'
    ? { source: referrer, channel: domainChannel(referrer) }
    : { source: '直接访问', channel: '直接访问' };
}
