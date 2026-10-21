// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  catalog: undefined as any,
  configuration: undefined as any,
  authorize: vi.fn(),
}));
vi.mock('../crawlers/published', () => ({
  getPublishedCatalog: () => h.catalog,
  installPublishedCatalogResolver: vi.fn(),
}));
vi.mock('./crawler-registry', () => ({ registryVersionIsCurrent: vi.fn() }));
vi.mock('./ai-db', () => ({ aiTransaction: vi.fn() }));
vi.mock('./server', () => ({ query: vi.fn() }));
vi.mock('./crawler-access', () => ({
  authorizeCrawler: h.authorize,
  crawlerTransaction: (work: any) =>
    work({ query: async () => [{ crawlerRules: h.configuration, rulesRevision: 3 }] }),
}));
import { crawlerRecognition } from './crawler-maintenance';
import { getBundledPublishedCatalog } from '../crawlers/catalog-seed';
import { LEGACY_BOT_RULES } from '../rules/bots';
import { officialRuleConfiguration, resolveCrawlerRules } from '../rules/configuration';
import { crawlerClassificationVersion } from '../log-ingestion/crawler-evidence';
beforeEach(() => {
  vi.clearAllMocks();
  h.catalog = getBundledPublishedCatalog();
  h.configuration = officialRuleConfiguration();
});
describe('website recognition configuration metadata', () => {
  it('reports enabled signed identities and the full configuration version', async () => {
    const result = await crawlerRecognition({ id: 'fixture', role: 'user' }, 'website');
    expect(h.authorize).toHaveBeenCalledOnce();
    expect(result.enabledIds).toContain('chatgpt-agent');
    expect(result.classificationVersion).toBe(
      crawlerClassificationVersion(
        resolveCrawlerRules({ crawlerRules: h.configuration }).rules,
        h.configuration,
      ),
    );
    h.configuration = { ...officialRuleConfiguration(), disabledIds: ['chatgpt-agent'] };
    const disabled = await crawlerRecognition({ id: 'fixture', role: 'user' }, 'website');
    expect(disabled.enabledIds).not.toContain('chatgpt-agent');
    expect(disabled.classificationVersion).not.toBe(result.classificationVersion);
  });
  it.each([{ mode: 'disabled' }, { mode: 'legacy', rules: [LEGACY_BOT_RULES[0]] }])(
    'keeps signed identities disabled in $mode mode',
    async configuration => {
      h.configuration = configuration;
      const result = await crawlerRecognition({ id: 'fixture', role: 'user' }, 'website');
      expect(result.enabledIds).not.toContain('chatgpt-agent');
      expect(result.enabledIds).toEqual(configuration.mode === 'disabled' ? [] : ['gptbot']);
    },
  );
});
