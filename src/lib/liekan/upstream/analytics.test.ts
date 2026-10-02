import { describe, expect, it, vi } from 'vitest';

vi.mock('./server', () => ({ query: vi.fn(), humanTotals: vi.fn() }));
vi.mock('@/queries/sql', () => ({ getFunnel: vi.fn() }));

import { classifyEntrySource } from './analytics';

describe('visit entry attribution', () => {
  it('gives explicit UTM attribution priority and keeps unknown values conservative', () => {
    expect(classifyEntrySource({ utmSource: ' ChatGPT ', referrer: '' })).toEqual({
      source: 'chatgpt.com',
      channel: 'AI 搜索引荐',
    });
    expect(classifyEntrySource({ utmMedium: 'email', referrer: 'google.com' })).toEqual({
      source: 'UTM / email',
      channel: '其他引荐',
    });
    expect(
      classifyEntrySource({ utmSource: 'google', utmMedium: 'email', referrer: 'chatgpt.com' }),
    ).toEqual({ source: 'google.com', channel: '其他引荐' });
    expect(
      classifyEntrySource({ utmSource: 'google-not-a-real-source', referrer: 'google.com' }),
    ).toEqual({ source: 'google-not-a-real-source', channel: '其他引荐' });
    expect(classifyEntrySource({ utmSource: 'constructor', referrer: 'google.com' })).toEqual({
      source: 'constructor',
      channel: '其他引荐',
    });
    expect(classifyEntrySource({ utmCampaign: 'launch', referrer: 'www.google.com' })).toEqual({
      source: 'www.google.com',
      channel: '传统搜索',
    });
    expect(classifyEntrySource({ referrer: 'chatgpt.com.evil.example' })).toEqual({
      source: 'chatgpt.com.evil.example',
      channel: '其他引荐',
    });
    expect(classifyEntrySource({ referrer: 'app.perplexity.ai' })).toEqual({
      source: 'app.perplexity.ai',
      channel: 'AI 搜索引荐',
    });
    expect(classifyEntrySource({})).toEqual({ source: '直接访问', channel: '直接访问' });
  });
});
