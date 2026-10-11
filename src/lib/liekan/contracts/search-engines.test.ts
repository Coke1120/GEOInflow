import { describe, expect, it } from 'vitest';
import { classifyEntrySource, aiAliases, searchAliases } from './sources';
import { searchPlatforms, summarizeSearchEngines } from './search-engines';

const fact = (source: string, sessions = 1, channel?: string) => ({
  ...classifyEntrySource({ referrer: source }),
  ...(channel ? { channel } : {}),
  sessions,
  pv: sessions * 2,
  bounces: 1,
  conversions: 1,
});
describe('search platform aggregation', () => {
  it('merges platform domains and computes rates from summed counts and distinct denominators', () => {
    const result = summarizeSearchEngines(
      [
        fact('www.google.com', 3),
        fact('google.com.hk', 1),
        fact('cn.bing.com', 2),
        fact('chatgpt.com', 1),
        fact('chat.openai.com', 3),
        fact('kimi.moonshot.cn', 1),
        fact('kimi.com', 1),
        fact('直接访问', 10),
        fact('example.test', 7),
      ],
      true,
    );
    expect(result.sessions).toBe(12);
    expect(result.aiShare).toBe(50);
    expect(result.totals).toEqual({ 传统搜索: 6, 'AI 搜索引荐': 6 });
    expect(result.rows).toHaveLength(4);
    expect(result.rows.find(row => row.engine === 'Google')).toMatchObject({
      sessions: 4,
      pv: 8,
      share: 33.33,
      categoryShare: 66.67,
      bounceRate: 50,
      conversionRate: 50,
    });
    expect(result.rows.find(row => row.engine === 'ChatGPT')?.sessions).toBe(4);
    expect(result.rows.find(row => row.engine === 'Kimi')?.sessions).toBe(2);
  });
  it('retains the upstream UTM classification and excludes non-search campaigns', () => {
    const entry = { utmSource: 'google', utmMedium: 'email', referrer: 'chatgpt.com' };
    const sources = [
      { ...fact('google.com'), ...classifyEntrySource(entry) },
      {
        ...fact('google.com'),
        ...classifyEntrySource({ utmSource: 'copilot', referrer: 'google.com' }),
      },
    ];
    expect(summarizeSearchEngines(sources, false).rows).toEqual([
      expect.objectContaining({ engine: 'Copilot', sessions: 1, conversionRate: null }),
    ]);
  });
  it.each([...Object.values(aiAliases), ...Object.values(searchAliases)])(
    'covers every currently classified domain including %s',
    host => {
      const result = summarizeSearchEngines([fact(host)], false);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].engine).not.toBe('未识别平台');
      expect(searchPlatforms.some(platform => platform.name === result.rows[0].engine)).toBe(true);
    },
  );
  it('keeps zero searches undefined and unknown future search platforms visible', () => {
    expect(summarizeSearchEngines([], true)).toEqual({
      rows: [],
      sessions: 0,
      totals: { 传统搜索: 0, 'AI 搜索引荐': 0 },
      aiShare: null,
    });
    expect(
      summarizeSearchEngines([fact('future.test', 2, 'AI 搜索引荐')], false).rows[0],
    ).toMatchObject({
      engine: '未识别平台',
      sessions: 2,
      share: 100,
      conversionRate: null,
    });
    expect(summarizeSearchEngines([fact('google.com.evil.test')], false).rows).toEqual([]);
  });
});
