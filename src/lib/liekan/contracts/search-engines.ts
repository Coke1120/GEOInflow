import type { Row } from './report';

export const searchChannels = ['传统搜索', 'AI 搜索引荐'] as const;
export type SearchChannel = (typeof searchChannels)[number];
// Platform domains follow the existing source classifier; subdomains share one platform.
export const searchPlatforms = [
  { name: 'Google', channel: '传统搜索', domains: ['google.com', 'google.com.hk', 'google.cn'] },
  { name: 'Bing', channel: '传统搜索', domains: ['bing.com'] },
  { name: '百度', channel: '传统搜索', domains: ['baidu.com'] },
  { name: '搜狗', channel: '传统搜索', domains: ['sogou.com'] },
  { name: '360', channel: '传统搜索', domains: ['so.com'] },
  { name: 'DuckDuckGo', channel: '传统搜索', domains: ['duckduckgo.com'] },
  { name: 'Yahoo', channel: '传统搜索', domains: ['yahoo.com'] },
  { name: 'ChatGPT', channel: 'AI 搜索引荐', domains: ['chatgpt.com', 'chat.openai.com'] },
  { name: 'Perplexity', channel: 'AI 搜索引荐', domains: ['perplexity.ai'] },
  { name: 'Claude', channel: 'AI 搜索引荐', domains: ['claude.ai'] },
  { name: 'Gemini', channel: 'AI 搜索引荐', domains: ['gemini.google.com'] },
  { name: 'Copilot', channel: 'AI 搜索引荐', domains: ['copilot.microsoft.com'] },
  { name: '豆包', channel: 'AI 搜索引荐', domains: ['doubao.com'] },
  { name: 'Kimi', channel: 'AI 搜索引荐', domains: ['kimi.com', 'kimi.moonshot.cn'] },
  { name: '文心一言', channel: 'AI 搜索引荐', domains: ['yiyan.baidu.com'] },
  { name: 'DeepSeek', channel: 'AI 搜索引荐', domains: ['deepseek.com'] },
] as const;
export type SearchSourceFact = {
  source: string;
  channel: string;
  sessions: number;
  pv: number;
  bounces: number;
  conversions: number;
};
const percent = (value: number, total: number) =>
  total ? Math.round((value / total) * 10000) / 100 : null;

export function summarizeSearchEngines(sources: SearchSourceFact[], hasGoals: boolean) {
  const groups = new Map<string, SearchSourceFact & { engine: string }>();
  const totals = { 传统搜索: 0, 'AI 搜索引荐': 0 };
  for (const source of sources) {
    if (!searchChannels.includes(source.channel as SearchChannel)) continue;
    const channel = source.channel as SearchChannel;
    const host = source.source.trim().toLowerCase();
    const platform = searchPlatforms.find(
      item =>
        item.channel === channel &&
        item.domains.some(domain => host === domain || host.endsWith(`.${domain}`)),
    );
    const engine = platform?.name || '未识别平台';
    const key = JSON.stringify([channel, engine]);
    const group = groups.get(key) || {
      engine,
      channel,
      source: engine,
      sessions: 0,
      pv: 0,
      bounces: 0,
      conversions: 0,
    };
    for (const metric of ['sessions', 'pv', 'bounces', 'conversions'] as const)
      group[metric] += source[metric] ?? 0;
    totals[channel] += source.sessions;
    groups.set(key, group);
  }
  const sessions = totals['传统搜索'] + totals['AI 搜索引荐'];
  const rows: Row[] = [...groups.values()]
    .sort((a, b) => b.sessions - a.sessions || a.engine.localeCompare(b.engine, 'zh-CN'))
    .map(group => ({
      engine: group.engine,
      type: group.channel,
      channel: group.channel,
      sessions: group.sessions,
      pv: group.pv,
      share: percent(group.sessions, sessions),
      categoryShare: percent(group.sessions, totals[group.channel as SearchChannel]),
      bounceRate: percent(group.bounces, group.sessions),
      conversionRate: hasGoals ? percent(group.conversions, group.sessions) : null,
    }));
  return { rows, totals, sessions, aiShare: percent(totals['AI 搜索引荐'], sessions) };
}
