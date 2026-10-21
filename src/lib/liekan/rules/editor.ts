import { parseEditableRules } from '../contracts/management';
import { getBotRules, type BotRule } from './bots';
import { getCrawlerRegistry } from '../crawlers/registry';
import {
  type CrawlerRuleConfiguration,
  migrateRuleConfiguration,
  validateCrawlerConfiguration,
} from './configuration';

export function ruleEditorConfiguration(settings: {
  crawlerRules?: CrawlerRuleConfiguration;
  rules?: BotRule[];
}) {
  return settings.crawlerRules ?? migrateRuleConfiguration(settings.rules);
}

/** Legacy drafts retain ordered rules and extension fields until an explicit conversion. */
export function parseRuleEditorDraft(
  content: string,
  knownIds?: readonly string[],
): CrawlerRuleConfiguration {
  let value: any;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error('JSON 格式无效，请检查引号、逗号和括号。');
  }
  if (value?.mode === 'legacy')
    return { mode: 'legacy', rules: parseEditableRules(JSON.stringify(value.rules)) };
  return validateCrawlerConfiguration(value, knownIds);
}

/** Identity settings include signed agents without adding them to the UA matcher. */
export type OfficialRuleOption = Omit<BotRule, 'pattern'> & { pattern?: string };
export function getOfficialRuleOptions(): OfficialRuleOption[] {
  const rules = getBotRules();
  return getCrawlerRegistry()
    .filter(identity => identity.kind !== 'robots_purpose' && identity.status === 'active')
    .map(
      identity =>
        rules.find(rule => rule.crawlerId === identity.id) ?? {
          crawlerId: identity.id,
          name: identity.name,
          vendor: identity.vendor,
          type: {
            training: '训练',
            search: '搜索',
            user: '用户触发',
            traditional_search: '传统搜索',
            other: '其他',
          }[identity.type],
          aiEligible: identity.aiEligible,
        },
    );
}

export function previewOfficialConversion(
  configuration: CrawlerRuleConfiguration,
  officialRules: readonly OfficialRuleOption[] = getOfficialRuleOptions(),
  knownIds: readonly string[] = officialRules.map(rule => rule.crawlerId),
) {
  if (configuration.mode === 'official') throw new Error('规则已采用官方目录');
  const rules =
    configuration.mode === 'legacy' ? parseEditableRules(JSON.stringify(configuration.rules)) : [];
  if (rules.some(rule => rule.name.trim() !== rule.name || rule.vendor.trim() !== rule.vendor))
    throw new Error('旧版名称或厂商包含首尾空格，请核对并修正后再转换。原规则继续保留。');
  const enabled = new Set<string>();
  const overrides: Extract<CrawlerRuleConfiguration, { mode: 'official' }>['overrides'] = {};
  const customRules: Extract<CrawlerRuleConfiguration, { mode: 'official' }>['customRules'] = [];
  const mappings: { name: string; crawlerId: string | null; matchMode: string }[] = [];
  for (const rule of rules) {
    const official = officialRules.find(
      candidate =>
        !!candidate.pattern &&
        candidate.name === rule.name &&
        candidate.vendor === rule.vendor &&
        candidate.pattern === rule.pattern &&
        !enabled.has(candidate.crawlerId),
    );
    if (official) {
      enabled.add(official.crawlerId);
      if (official.type !== rule.type)
        overrides[official.crawlerId] = { type: rule.type as (typeof customRules)[number]['type'] };
      mappings.push({ name: rule.name, crawlerId: official.crawlerId, matchMode: 'token' });
    } else {
      customRules.push({
        name: rule.name,
        vendor: rule.vendor,
        type: rule.type as (typeof customRules)[number]['type'],
        pattern: rule.pattern,
        matchMode: rule.matchMode === 'token' ? 'token' : 'literal',
      });
      mappings.push({
        name: rule.name,
        crawlerId: null,
        matchMode: rule.matchMode === 'token' ? 'token' : 'literal',
      });
    }
  }
  const disabledIds = [...new Set(knownIds)].filter(id => !enabled.has(id));
  const next = validateCrawlerConfiguration(
    {
      mode: 'official',
      disabledIds,
      overrides,
      customRules,
    },
    knownIds,
  );
  return {
    configuration: next,
    mappings,
    enabled: [...enabled],
    disabled: disabledIds.map(id => officialRules.find(rule => rule.crawlerId === id)?.name ?? id),
    overrides: Object.entries(overrides).map(([id, value]) => ({
      name: officialRules.find(rule => rule.crawlerId === id).name,
      type: value.type,
    })),
    additions: [] as string[],
    removals: [] as string[],
  };
}

export function crawlerDetailSelection(action: string): { name?: string; botId?: string | null } {
  if (!action.startsWith('蜘蛛详情:')) return {};
  const value = action.slice(5);
  try {
    const parsed = JSON.parse(value);
    if (
      typeof parsed?.name === 'string' &&
      (parsed.botId === null || parsed.botId === undefined || typeof parsed.botId === 'string')
    )
      return parsed;
  } catch {
    /* Historical name-only actions remain valid. */
  }
  return { name: value };
}
