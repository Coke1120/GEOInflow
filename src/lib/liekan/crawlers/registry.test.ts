import { describe, expect, it } from 'vitest';
import { crawlerPolicyInputSchema } from '../contracts/crawlers';
import { crawlerRobotsDraft } from '../help/catalog';
import { helpCrawlers } from '../help/crawlers';
import { ALL_BOT_RULES, LEGACY_BOT_RULES } from '../rules/bots';
import { crawlerCatalog } from './catalog';
import {
  crawlerDirectory,
  crawlerDirectoryForObserved,
  getCrawler,
  crawlerIdForName,
} from './directory';
import {
  ACTIVE_CRAWLER_IDS,
  ALL_HTTP_CRAWLER_IDS,
  crawlerControllableBotIds,
  crawlerRegistry,
  INITIAL_CRAWLER_IDS,
} from './registry';
import { crawlerRobotsPolicySchema } from './robots';

const policy = {
  name: 'Scoped policy',
  botIds: ['gptbot'],
  paths: [{ value: '/docs', match: 'exact' }],
  action: 'block',
  expectedAccess: 'block',
};

describe('central crawler identity registry', () => {
  it('keeps 57 catalog entries, 54 HTTP entries, 53 recognized names and 3 purpose controls', () => {
    expect(crawlerCatalog).toHaveLength(57);
    expect(new Set(crawlerCatalog.map(entry => entry.id)).size).toBe(57);
    expect(crawlerRegistry.filter(entry => entry.kind === 'http_crawler')).toHaveLength(54);
    expect(ALL_HTTP_CRAWLER_IDS).toHaveLength(53);
    expect(ACTIVE_CRAWLER_IDS).toEqual(ALL_HTTP_CRAWLER_IDS);
    expect(crawlerRegistry.filter(entry => entry.kind === 'robots_purpose')).toHaveLength(3);
    expect(
      crawlerCatalog.filter(entry => entry.status === 'pending').map(entry => entry.name),
    ).toEqual(['PetalBot']);
    expect(ALL_BOT_RULES.map(rule => rule.name).sort()).toEqual(
      helpCrawlers
        .filter(entry => entry.kind === 'crawler' && entry.evidence !== 'pending')
        .map(entry => entry.name)
        .sort(),
    );
    expect(crawlerDirectory).toHaveLength(ACTIVE_CRAWLER_IDS.length + 3);
    expect(crawlerDirectory.some(entry => entry.name === 'PetalBot')).toBe(false);
  });

  it('reads all recognized identities while retaining the control capability boundary', () => {
    expect(getCrawler('googlebot-image').name).toBe('Googlebot-Image');
    expect(
      crawlerDirectoryForObserved(['googlebot-image']).some(
        entry => entry.id === 'googlebot-image',
      ),
    ).toBe(true);
    expect(getCrawler('googlebot-image').control.remote).toBe(false);
  });

  it('preserves original IDs and all existing evidence/source review metadata', () => {
    expect(INITIAL_CRAWLER_IDS).toHaveLength(13);
    expect(LEGACY_BOT_RULES.map(rule => crawlerIdForName(rule.name))).toEqual(INITIAL_CRAWLER_IDS);
    expect(helpCrawlers.map(entry => entry.id)).toEqual(crawlerCatalog.map(entry => entry.id));
    for (const entry of crawlerCatalog) {
      expect(entry.metadata.sources.length).toBeGreaterThan(0);
      expect(entry.metadata.reviewedAt).toBe('2026-10-05');
    }
    for (const name of [
      'Bytespider',
      'Meta-ExternalAgent',
      'Meta-ExternalFetcher',
      'FacebookBot',
    ]) {
      const entry = crawlerCatalog.find(entry => entry.name === name);
      expect(entry.metadata.evidence).toBe('observed');
      expect(entry.metadata.sources[0].url).toBe(
        'https://developers.cloudflare.com/ai-crawl-control/reference/bots/',
      );
    }
  });

  it('separates remote and Nginx control capability from HTTP recognition', () => {
    expect(crawlerControllableBotIds).toEqual(INITIAL_CRAWLER_IDS);
    for (const entry of crawlerCatalog) {
      const controllable = (crawlerControllableBotIds as readonly string[]).includes(entry.id);
      expect(entry.control).toEqual({ remote: controllable, nginx: controllable });
      expect(crawlerPolicyInputSchema.safeParse({ ...policy, botIds: [entry.id] }).success).toBe(
        controllable,
      );
    }
  });

  it('uses confirmed documented tokens for robots drafts and runtime exports', () => {
    const mistral = crawlerCatalog.find(entry => entry.id === 'mistralai-index');
    expect(mistral.robotsToken).toBe('MistralAI-Index');
    expect(mistral.metadata.robotsToken).toBe('MistralAI-Index');
    expect(crawlerRobotsDraft(mistral.metadata)).toContain('User-agent: MistralAI-Index');
    const petal = crawlerCatalog.find(entry => entry.id === 'petalbot');
    expect(petal.metadata.evidence).toBe('pending');
    expect(crawlerRobotsDraft(petal.metadata)).toBeUndefined();
  });

  it('exports only confirmed operator tokens and keeps observed or pending tokens unavailable', () => {
    for (const entry of crawlerCatalog) {
      const approved = entry.metadata.evidence === 'operator' && !!entry.metadata.robotsToken;
      expect(
        crawlerRobotsPolicySchema.safeParse({
          botIds: [entry.id],
          paths: policy.paths,
          action: 'block',
        }).success,
      ).toBe(approved);
      expect(entry.robotsToken !== null).toBe(approved);
    }
  });
});
