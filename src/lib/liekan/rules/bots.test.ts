import { describe, expect, it } from 'vitest';
import { crawlerIdForRule } from '../crawlers/directory';
import { ACTIVE_CRAWLER_IDS } from '../crawlers/registry';
import { ALL_BOT_RULES, BOT_RULES, classifyBot, LEGACY_BOT_RULES } from './bots';

const expectedTypes = {
  训练: [
    'GPTBot',
    'ClaudeBot',
    'Amazonbot',
    'MistralAI-Training',
    'AI2Bot',
    'Meta-ExternalAgent',
    'FacebookBot',
    'Bytespider',
  ],
  搜索: [
    'OAI-SearchBot',
    'Claude-SearchBot',
    'PerplexityBot',
    'Amzn-SearchBot',
    'MistralAI-Index',
    'DuckAssistBot',
  ],
  用户触发: [
    'ChatGPT-User',
    'Claude-User',
    'Perplexity-User',
    'Amzn-User',
    'MistralAI-User',
    'Meta-ExternalFetcher',
    'Google-InspectionTool',
  ],
  传统搜索: [
    'Googlebot',
    'Googlebot-Image',
    'Googlebot-Video',
    'Storebot-Google',
    'Applebot',
    'bingbot',
    'DuckDuckBot',
    'Baiduspider',
    'Baiduspider-render',
    'Sogou web spider',
    'Sogou inst spider',
    '360Spider',
    'YandexBot',
    'Yeti',
    'SeznamBot',
    'FreshBot',
    'Qwantbot',
    'Qwantbot-news',
    'MojeekBot',
  ],
  其他: [
    'OAI-AdsBot',
    'GoogleOther',
    'GoogleOther-Image',
    'GoogleOther-Video',
    'Google-CloudVertexBot',
    'CCBot',
    'Ads-Naver',
    'Blueno',
    'AhrefsBot',
    'AhrefsSiteAudit',
    'SemrushBot',
    'SiteAuditBot',
    'MJ12bot',
  ],
};

describe('official crawler token recognition', () => {
  it.each([
    'NotGPTBot/1.0',
    'GPTBot-Unaffiliated/1.0',
    'Mozilla/5.0 (+https://example.com/GPTBot)',
    'Mozilla/5.0 https://GPTBot.example.com/',
    "Mozilla/5.0 (+https://example.com/'(GPTBot/1.0))",
    'Mozilla/5.0 (https://example.com/?ua=(GPTBot/1.0))',
    'GPTBot.com',
    'Googlebot-Unknown/1.0',
    'Baiduspider-notreal',
  ])('does not grant official identity to %s', ua => {
    expect(classifyBot(ua, ALL_BOT_RULES)).toMatchObject({ name: '其他', aiEligible: false });
    expect(crawlerIdForRule(classifyBot(ua, ALL_BOT_RULES))).toBeNull();
  });

  it('prepares every approved HTTP name with its independently specified primary type', () => {
    expect(ALL_BOT_RULES).toHaveLength(53);
    expect(new Set(ALL_BOT_RULES.map(rule => rule.crawlerId)).size).toBe(53);
    for (const [type, names] of Object.entries(expectedTypes)) {
      expect(
        ALL_BOT_RULES.filter(rule => rule.type === type)
          .map(rule => rule.name)
          .sort(),
      ).toEqual([...names].sort());
      for (const name of names) {
        const classified = classifyBot(
          `Mozilla/5.0 (compatible; ${name.toUpperCase()}/2.1; +https://example.com/bot)`,
          ALL_BOT_RULES,
        );
        expect(classified).toMatchObject({ name, type, matchMode: 'token' });
        expect(crawlerIdForRule(classified)).toBeTruthy();
      }
    }
  });

  it.each([
    'GPTBot',
    ';GPTBot;',
    '(gptbot)',
    'Mozilla/5.0 GPTBot/1.4',
    'GPTBot/1.0(+https://example.com/GPTBot)',
  ])('accepts the documented product boundary in %s', ua => {
    expect(classifyBot(ua).name).toBe('GPTBot');
  });

  it.each([
    'Google-Extended',
    'Googlebot-News',
    'Applebot-Extended',
    'PetalBot',
    'ByteDance',
    '字节蜘蛛',
    'Naverbot',
    'Semrush Site Audit',
  ])('keeps display aliases, pending entries and purpose markers out of UA matches: %s', token => {
    expect(crawlerIdForRule(classifyBot(token, ALL_BOT_RULES))).toBeNull();
  });

  it.each([
    ['Googlebot', 'Googlebot-Image'],
    ['Googlebot', 'Googlebot-Video'],
    ['GoogleOther', 'GoogleOther-Image'],
    ['GoogleOther', 'GoogleOther-Video'],
    ['Baiduspider', 'Baiduspider-render'],
    ['Qwantbot', 'Qwantbot-news'],
  ])('selects the known %s family child %s independently of rule ordering', (parent, child) => {
    const ua = `${parent}/1.0 ${child}/1.0`;
    expect(classifyBot(ua, ALL_BOT_RULES).name).toBe(child);
    expect(classifyBot(ua, [...ALL_BOT_RULES].reverse()).name).toBe(child);
  });

  it.each([
    ['GPTBot/1.0 ClaudeBot/1.0', ['claudebot', 'gptbot']],
    ['GPTBot/1.0 OAI-SearchBot/1.0', ['gptbot', 'oai-searchbot']],
    ['Googlebot-Image/1.0 Googlebot-Video/1.0', ['googlebot-image', 'googlebot-video']],
  ])('keeps conflicting tokens unrecognized: %s', (ua, candidateIds) => {
    const result = classifyBot(ua, ALL_BOT_RULES);
    expect(result).toEqual({
      name: '其他',
      vendor: '',
      type: '其他',
      pattern: '',
      aiEligible: false,
      recognition: 'ambiguous',
      candidateIds,
    });
    expect(crawlerIdForRule(result)).toBeNull();
  });

  it('keeps AI eligibility separate from user-triggered and display classifications', () => {
    expect(ALL_BOT_RULES.filter(rule => rule.aiEligible)).toHaveLength(20);
    expect(classifyBot('Google-InspectionTool/1.0', ALL_BOT_RULES)).toMatchObject({
      type: '用户触发',
      aiEligible: false,
    });
    for (const name of ['Google-CloudVertexBot', 'CCBot', 'Applebot'])
      expect(classifyBot(name, ALL_BOT_RULES).aiEligible).toBe(false);
    expect(classifyBot('ChatGPT-User/1.0', ALL_BOT_RULES).aiEligible).toBe(true);
  });

  it('binds the effective rollout to the active identity selection', () => {
    expect(BOT_RULES.map(rule => rule.crawlerId)).toEqual(ACTIVE_CRAWLER_IDS);
  });
});

describe('legacy and custom recognition compatibility', () => {
  it('preserves all original fields, ordering and substring behavior', () => {
    expect(LEGACY_BOT_RULES.map(rule => rule.name)).toEqual([
      'GPTBot',
      'OAI-SearchBot',
      'ChatGPT-User',
      'ClaudeBot',
      'Claude-SearchBot',
      'Claude-User',
      'PerplexityBot',
      'Perplexity-User',
      'Bytespider',
      'Googlebot',
      'Baiduspider',
      'bingbot',
      'Applebot',
    ]);
    for (const rule of LEGACY_BOT_RULES)
      expect(Object.keys(rule)).toEqual(['name', 'vendor', 'type', 'pattern']);
    expect(classifyBot('NotGPTBot/1.0', LEGACY_BOT_RULES)).toEqual(LEGACY_BOT_RULES[0]);
    expect(classifyBot('ClaudeBot GPTBot', LEGACY_BOT_RULES).name).toBe('GPTBot');
    expect(classifyBot('Googlebot-Image', LEGACY_BOT_RULES).name).toBe('Googlebot');
  });

  it('only accepts exact four-field legacy records for historical identity compatibility', () => {
    expect(crawlerIdForRule(JSON.parse(JSON.stringify(LEGACY_BOT_RULES[0])))).toBe('gptbot');
    expect(crawlerIdForRule({ name: 'GPTBot', pattern: 'GPTBot' })).toBeNull();
    expect(crawlerIdForRule({ ...LEGACY_BOT_RULES[0], vendor: 'Custom' })).toBeNull();
    expect(crawlerIdForRule({ ...LEGACY_BOT_RULES[0], matchMode: 'literal' })).toBeNull();
    expect(crawlerIdForRule({ ...LEGACY_BOT_RULES[0], matchMode: 'token' })).toBeNull();
    const official = { ...BOT_RULES[0], type: '其他' };
    expect(crawlerIdForRule(JSON.parse(JSON.stringify(official)))).toBe('gptbot');
    expect(crawlerIdForRule({ ...official, pattern: 'anything' })).toBeNull();
    expect(crawlerIdForRule({ ...official, crawlerId: 'claudebot' })).toBeNull();
  });

  it('keeps custom patterns literal and does not turn a label into official identity', () => {
    const rules = [
      {
        name: 'GPTBot',
        vendor: '',
        type: '训练',
        pattern: 'custom[bot]',
        matchMode: 'literal' as const,
      },
    ];
    const result = classifyBot('prefix custom[bot] suffix', rules);
    expect(result).toEqual(rules[0]);
    expect(crawlerIdForRule(result)).toBeNull();
    expect(classifyBot('customb', rules).name).toBe('其他');
    expect(classifyBot('GPTBot', []).name).toBe('其他');
  });
});
