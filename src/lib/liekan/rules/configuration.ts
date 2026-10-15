import { z } from 'zod';
import { BOT_RULES, BOT_TYPES, LEGACY_BOT_RULES, type BotRule } from './bots';

const customRuleSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  vendor: z.string().trim().min(1).max(80),
  type: z.enum(BOT_TYPES),
  pattern: z.string().min(1).max(80),
  matchMode: z.enum(['token', 'literal']).default('token'),
});
export const crawlerRulesSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('official'),
    disabledIds: z.array(z.string().max(80)).max(100).default([]),
    overrides: z
      .record(z.string().max(80), z.strictObject({ type: z.enum(BOT_TYPES) }))
      .default({}),
    customRules: z.array(customRuleSchema).max(100).default([]),
  }),
  z.strictObject({ mode: z.literal('disabled') }),
  z.strictObject({
    mode: z.literal('legacy'),
    rules: z
      .array(
        z.object({
          name: z.string().min(1).max(80),
          vendor: z.string().min(1).max(80),
          type: z.enum(BOT_TYPES),
          pattern: z.string().min(1).max(80),
          matchMode: z.enum(['token', 'literal']).optional(),
        }),
      )
      .max(100),
  }),
]);
export type CrawlerRuleConfiguration =
  | Exclude<z.infer<typeof crawlerRulesSchema>, { mode: 'legacy' }>
  | { mode: 'legacy'; rules: BotRule[] };
export const officialRuleConfiguration = (): CrawlerRuleConfiguration => ({
  mode: 'official',
  disabledIds: [],
  overrides: {},
  customRules: [],
});

/** Only an exact historical default can safely resume following the maintained catalog. */
export function migrateRuleConfiguration(rules?: BotRule[] | null): CrawlerRuleConfiguration {
  if (rules == null) return officialRuleConfiguration();
  if (!rules.length) return { mode: 'disabled' };
  const exactDefault =
    rules.length === LEGACY_BOT_RULES.length &&
    rules.every((rule, index) => {
      const expected = LEGACY_BOT_RULES[index];
      return (
        Object.keys(rule).length === 4 &&
        Object.entries(expected).every(([key, value]) => rule[key] === value)
      );
    });
  return exactDefault ? officialRuleConfiguration() : { mode: 'legacy', rules };
}

export function resolveCrawlerRules(row?: {
  crawlerRules?: CrawlerRuleConfiguration | null;
  rules?: BotRule[] | null;
}): { configuration: CrawlerRuleConfiguration; rules: BotRule[] } {
  const configuration = row?.crawlerRules ?? migrateRuleConfiguration(row?.rules);
  if (configuration.mode === 'disabled') return { configuration, rules: [] };
  if (configuration.mode === 'legacy') return { configuration, rules: configuration.rules };
  const rules = BOT_RULES.filter(rule => !configuration.disabledIds.includes(rule.crawlerId)).map(
    rule => ({
      ...rule,
      ...configuration.overrides[rule.crawlerId],
    }),
  );
  for (const custom of configuration.customRules)
    rules.push({
      name: custom.name,
      vendor: custom.vendor,
      type: custom.type,
      pattern: custom.pattern,
      matchMode: custom.matchMode,
      aiEligible: ['训练', '搜索', '用户触发'].includes(custom.type),
    });
  return { configuration, rules };
}

export function validateCrawlerConfiguration(value: unknown): CrawlerRuleConfiguration {
  const configuration = crawlerRulesSchema.parse(value);
  if (configuration.mode === 'official') {
    const ids = new Set(BOT_RULES.map(rule => rule.crawlerId));
    if (
      [...configuration.disabledIds, ...Object.keys(configuration.overrides)].some(
        id => !ids.has(id),
      )
    )
      throw new Error('Unknown crawler override');
    if (new Set(configuration.disabledIds).size !== configuration.disabledIds.length)
      throw new Error('Duplicate crawler override');
  }
  if (configuration.mode === 'legacy')
    return {
      mode: 'legacy',
      rules: configuration.rules.map(rule => ({ ...rule, matchMode: rule.matchMode ?? 'literal' })),
    };
  return configuration;
}

/** Existing historical provenance survives unchanged edits; new client input cannot mint it. */
export function preserveHistoricalRules(
  next: CrawlerRuleConfiguration,
  submitted: unknown,
  current: CrawlerRuleConfiguration,
): CrawlerRuleConfiguration {
  if (next.mode !== 'legacy' || current.mode !== 'legacy' || !Array.isArray(submitted)) return next;
  return {
    ...next,
    rules: next.rules.map((rule, index) => {
      const input = submitted[index];
      const historical = current.rules.find(
        previous =>
          Object.keys(previous).length === 4 &&
          input &&
          Object.keys(input).length === 4 &&
          ['name', 'vendor', 'type', 'pattern'].every(key => input[key] === previous[key]),
      );
      return historical ? { ...historical } : rule;
    }),
  };
}
