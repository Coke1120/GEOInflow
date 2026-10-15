import { crawlerIdForRule } from '../crawlers/directory';
import { describe, expect, it } from 'vitest';
import { classifyBot, BOT_RULES, LEGACY_BOT_RULES } from './bots';
import {
  migrateRuleConfiguration,
  preserveHistoricalRules,
  resolveCrawlerRules,
  validateCrawlerConfiguration,
} from './configuration';

describe('crawler configuration migration', () => {
  it('follows official defaults only for absent settings and exact historical copies', () => {
    for (const rules of [undefined, null, structuredClone(LEGACY_BOT_RULES)]) {
      expect(migrateRuleConfiguration(rules).mode).toBe('official');
      expect(resolveCrawlerRules({ rules }).rules).toEqual(BOT_RULES);
    }
  });
  it('keeps explicit disable, reordered, removed, renamed, extra and extended legacy rules', () => {
    expect(migrateRuleConfiguration([])).toEqual({ mode: 'disabled' });
    for (const rules of [
      [...LEGACY_BOT_RULES].reverse(),
      LEGACY_BOT_RULES.slice(1),
      [...LEGACY_BOT_RULES, { name: 'Custom', vendor: 'Custom', type: '搜索', pattern: 'Custom' }],
      LEGACY_BOT_RULES.map((rule, i) => (i ? rule : { ...rule, name: 'Renamed' })),
      LEGACY_BOT_RULES.map((rule, i) => (i ? rule : { ...rule, matchMode: 'literal' as const })),
    ]) {
      const migrated = migrateRuleConfiguration(rules);
      expect(migrated).toEqual({ mode: 'legacy', rules });
      expect(resolveCrawlerRules({ crawlerRules: migrated }).rules).toEqual(rules);
    }
  });
  it('does not grant historical identity to newly submitted legacy rules', () => {
    const configuration = validateCrawlerConfiguration({
      mode: 'legacy',
      rules: [LEGACY_BOT_RULES[0]],
    });
    const { rules } = resolveCrawlerRules({ crawlerRules: configuration });
    expect(rules[0].matchMode).toBe('literal');
    expect(crawlerIdForRule(classifyBot('NotGPTBot/1.0', rules))).toBeNull();
  });
  it('preserves already stored historical identities while rejecting newly invented provenance', () => {
    const submitted = [LEGACY_BOT_RULES[0], { ...LEGACY_BOT_RULES[1], pattern: 'Custom' }];
    const next = validateCrawlerConfiguration({ mode: 'legacy', rules: submitted });
    const preserved = preserveHistoricalRules(next, submitted, {
      mode: 'legacy',
      rules: [LEGACY_BOT_RULES[0], LEGACY_BOT_RULES[1]],
    });
    expect(resolveCrawlerRules({ crawlerRules: preserved }).rules.map(crawlerIdForRule)).toEqual([
      'gptbot',
      null,
    ]);
    expect(
      resolveCrawlerRules({
        crawlerRules: preserveHistoricalRules(next, submitted, { mode: 'legacy', rules: [] }),
      }).rules.map(crawlerIdForRule),
    ).toEqual([null, null]);
  });
  it('applies official overrides without granting a custom official identity', () => {
    const configuration = validateCrawlerConfiguration({
      mode: 'official',
      disabledIds: ['claudebot'],
      overrides: { gptbot: { type: '其他' } },
      customRules: [{ name: 'GPTBot', vendor: 'OpenAI', type: '训练', pattern: 'MyBot' }],
    });
    const { rules } = resolveCrawlerRules({ crawlerRules: configuration });
    expect(rules.some(rule => rule.crawlerId === 'claudebot')).toBe(false);
    expect(rules.find(rule => rule.crawlerId === 'gptbot')).toMatchObject({
      type: '其他',
      aiEligible: true,
    });
    expect(rules.at(-1)).toMatchObject({ matchMode: 'token', pattern: 'MyBot' });
    expect(rules.at(-1).crawlerId).toBeUndefined();
    expect(() =>
      validateCrawlerConfiguration({
        mode: 'official',
        customRules: [
          {
            name: 'GPTBot',
            vendor: 'OpenAI',
            type: '训练',
            pattern: 'GPTBot',
            crawlerId: 'gptbot',
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      validateCrawlerConfiguration({ mode: 'official', disabledIds: ['invented'] }),
    ).toThrow();
  });
});
