export const BOT_TYPES = ['训练', '搜索', '用户触发', '传统搜索', '其他'] as const;
export interface BotRule {
  name: string;
  vendor: string;
  type: string;
  pattern: string;
}
export const BOT_RULES: BotRule[] = [
  { name: 'GPTBot', vendor: 'OpenAI', type: '训练', pattern: 'GPTBot' },
  { name: 'OAI-SearchBot', vendor: 'OpenAI', type: '搜索', pattern: 'OAI-SearchBot' },
  { name: 'ChatGPT-User', vendor: 'OpenAI', type: '用户触发', pattern: 'ChatGPT-User' },
  { name: 'ClaudeBot', vendor: 'Anthropic', type: '训练', pattern: 'ClaudeBot' },
  { name: 'Claude-SearchBot', vendor: 'Anthropic', type: '搜索', pattern: 'Claude-SearchBot' },
  { name: 'Claude-User', vendor: 'Anthropic', type: '用户触发', pattern: 'Claude-User' },
  { name: 'PerplexityBot', vendor: 'Perplexity', type: '搜索', pattern: 'PerplexityBot' },
  { name: 'Perplexity-User', vendor: 'Perplexity', type: '用户触发', pattern: 'Perplexity-User' },
  { name: 'Bytespider', vendor: '字节跳动', type: '训练', pattern: 'Bytespider' },
  { name: 'Googlebot', vendor: 'Google', type: '传统搜索', pattern: 'Googlebot' },
  { name: 'Baiduspider', vendor: '百度', type: '传统搜索', pattern: 'Baiduspider' },
  { name: 'bingbot', vendor: 'Microsoft', type: '传统搜索', pattern: 'bingbot' },
  { name: 'Applebot', vendor: 'Apple', type: '传统搜索', pattern: 'Applebot' },
];
export function classifyBot(ua: string, rules: BotRule[] = BOT_RULES) {
  // Rules are literal substrings with bounded length; user-supplied regex is excluded.
  return (
    rules.find(rule => ua.toLowerCase().includes(rule.pattern.toLowerCase())) ?? {
      name: '其他',
      vendor: '',
      type: '其他',
      pattern: '',
    }
  );
}
