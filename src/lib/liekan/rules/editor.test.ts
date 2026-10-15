import { describe, expect, it } from 'vitest';
import { BOT_RULES, LEGACY_BOT_RULES } from './bots';
import {
  parseRuleEditorDraft,
  previewOfficialConversion,
  ruleEditorConfiguration,
  crawlerDetailSelection,
} from './editor';

describe('versioned crawler rule editor', () => {
  it('reads official policy without freezing the resolved rules', () => {
    const crawlerRules = {
      mode: 'official' as const,
      disabledIds: ['gptbot'],
      overrides: {},
      customRules: [],
    };
    expect(ruleEditorConfiguration({ crawlerRules, rules: LEGACY_BOT_RULES })).toBe(crawlerRules);
    expect(ruleEditorConfiguration({ rules: LEGACY_BOT_RULES }).mode).toBe('official');
  });
  it('keeps legacy order and literal identity while editing', () => {
    const rules = [
      { ...LEGACY_BOT_RULES[0], name: 'MyBot', extension: 'retained' },
      LEGACY_BOT_RULES[1],
    ];
    expect(parseRuleEditorDraft(JSON.stringify({ mode: 'legacy', rules }))).toEqual({
      mode: 'legacy',
      rules,
    });
    expect(() => parseRuleEditorDraft('{')).toThrow('JSON 格式无效');
  });
  it('previews explicit canonical mapping, type override and custom rules without adding active defaults', () => {
    const rules = [
      { ...LEGACY_BOT_RULES[0], type: '其他' },
      { ...LEGACY_BOT_RULES[1], pattern: 'CustomOAI' },
      { ...LEGACY_BOT_RULES[2], name: 'Changed name' },
      {
        name: 'PrivateBot',
        vendor: 'Private',
        type: '搜索',
        pattern: 'PrivateBot',
        matchMode: 'token' as const,
      },
    ];
    const preview = previewOfficialConversion({ mode: 'legacy', rules });
    expect(preview.configuration).toMatchObject({
      mode: 'official',
      overrides: { gptbot: { type: '其他' } },
      customRules: [
        { name: 'OAI-SearchBot', pattern: 'CustomOAI', matchMode: 'literal' },
        { name: 'Changed name', pattern: 'ChatGPT-User', matchMode: 'literal' },
        { name: 'PrivateBot', matchMode: 'token' },
      ],
    });
    expect(preview.enabled).toEqual(['gptbot']);
    expect(preview.disabled).toHaveLength(BOT_RULES.length - 1);
    expect(preview.additions).toEqual([]);
    expect(preview.removals).toEqual([]);
  });
  it('requires review before changing ambiguous whitespace labels and keeps duplicate rules as custom', () => {
    expect(() =>
      previewOfficialConversion({
        mode: 'legacy',
        rules: [{ ...LEGACY_BOT_RULES[0], name: ' GPTBot ' }],
      }),
    ).toThrow('首尾空格');
    const preview = previewOfficialConversion({
      mode: 'legacy',
      rules: [LEGACY_BOT_RULES[0], LEGACY_BOT_RULES[0]],
    });
    expect(preview.configuration).toMatchObject({
      customRules: [{ name: 'GPTBot', matchMode: 'literal' }],
    });
  });
  it('keeps disabled configurations disabled after a preview', () => {
    const preview = previewOfficialConversion({ mode: 'disabled' });
    expect(preview.enabled).toEqual([]);
    expect(preview.disabled).toHaveLength(BOT_RULES.length);
  });
  it('preserves explicit official and custom selection even when both share a name', () => {
    expect(crawlerDetailSelection('蜘蛛详情:{"name":"GPTBot","botId":"gptbot"}')).toEqual({
      name: 'GPTBot',
      botId: 'gptbot',
    });
    expect(crawlerDetailSelection('蜘蛛详情:{"name":"GPTBot","botId":null}')).toEqual({
      name: 'GPTBot',
      botId: null,
    });
    expect(crawlerDetailSelection('蜘蛛详情:GPTBot')).toEqual({ name: 'GPTBot' });
  });
});
