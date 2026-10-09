import {
  type CrawlerBotId,
  type CrawlerHttpBotId,
  type CrawlerPlatformId,
  type CrawlerPlatformReferral,
  type CrawlerType,
  crawlerPlatformIds,
} from '../contracts/crawlers';

export interface CrawlerDirectoryEntry {
  id: CrawlerBotId;
  name: string;
  platformId: CrawlerPlatformId;
  type: CrawlerType;
  kind: 'http_crawler' | 'robots_purpose';
  uaSelector: string | null;
  robotsToken: string;
  robotsApplicability: 'applicable' | 'user_triggered_caveat';
  documentationUrl: string;
  impact: string;
  identityEvidence: 'declared_ua_requires_verification' | 'no_http_identity';
}

const docs = {
  openai: 'https://developers.openai.com/api/docs/bots',
  anthropic:
    'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler',
  perplexity: 'https://docs.perplexity.ai/docs/resources/perplexity-crawlers',
  bytedance: 'https://developers.cloudflare.com/ai-crawl-control/reference/bots/',
  google: 'https://developers.google.com/crawling/docs/crawlers-fetchers/overview-google-crawlers',
  baidu: 'https://ziyuan.baidu.com/college/articleinfo?id=1000',
  microsoft: 'https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0',
  apple: 'https://support.apple.com/en-us/119829',
};
const impact: Record<CrawlerType, string> = {
  training: 'Express content-use preferences separately for this training crawler.',
  search: 'Blocking may prevent this crawler from discovering or retrieving public pages.',
  user: 'Blocking may prevent retrieval requested by a platform user.',
  traditional_search: 'Blocking may prevent this search crawler from retrieving public pages.',
};

const httpCrawler = (
  id: CrawlerHttpBotId,
  name: string,
  platformId: CrawlerPlatformId,
  type: CrawlerType,
  caveat = false,
): CrawlerDirectoryEntry => ({
  id,
  name,
  platformId,
  type,
  kind: 'http_crawler',
  uaSelector: name,
  robotsToken: name,
  robotsApplicability: caveat ? 'user_triggered_caveat' : 'applicable',
  documentationUrl: docs[platformId],
  impact: impact[type],
  identityEvidence: 'declared_ua_requires_verification',
});

export const crawlerDirectory: readonly Readonly<CrawlerDirectoryEntry>[] = Object.freeze(
  (
    [
      httpCrawler('gptbot', 'GPTBot', 'openai', 'training'),
      httpCrawler('oai-searchbot', 'OAI-SearchBot', 'openai', 'search'),
      httpCrawler('chatgpt-user', 'ChatGPT-User', 'openai', 'user', true),
      httpCrawler('claudebot', 'ClaudeBot', 'anthropic', 'training'),
      httpCrawler('claude-searchbot', 'Claude-SearchBot', 'anthropic', 'search'),
      httpCrawler('claude-user', 'Claude-User', 'anthropic', 'user'),
      httpCrawler('perplexitybot', 'PerplexityBot', 'perplexity', 'search'),
      httpCrawler('perplexity-user', 'Perplexity-User', 'perplexity', 'user', true),
      httpCrawler('bytespider', 'Bytespider', 'bytedance', 'training'),
      httpCrawler('googlebot', 'Googlebot', 'google', 'traditional_search'),
      httpCrawler('baiduspider', 'Baiduspider', 'baidu', 'traditional_search'),
      httpCrawler('bingbot', 'bingbot', 'microsoft', 'traditional_search'),
      httpCrawler('applebot', 'Applebot', 'apple', 'traditional_search'),
      {
        id: 'google-extended',
        name: 'Google-Extended',
        platformId: 'google',
        type: 'training',
        kind: 'robots_purpose',
        uaSelector: null,
        robotsToken: 'Google-Extended',
        robotsApplicability: 'applicable',
        documentationUrl: docs.google,
        impact: 'Controls the documented content-use purpose through robots.txt; has no HTTP UA.',
        identityEvidence: 'no_http_identity',
      },
    ] satisfies CrawlerDirectoryEntry[]
  ).map(entry => Object.freeze(entry)),
);

export function getCrawler(id: CrawlerBotId): Readonly<CrawlerDirectoryEntry> {
  const crawler = crawlerDirectory.find(value => value.id === id);
  if (!crawler) throw new Error('Unknown crawler');
  return crawler;
}

// Historical names retain their stable IDs independently of later directory copy changes.
export function crawlerIdForName(name: string): CrawlerHttpBotId | null {
  const crawler = crawlerDirectory.find(
    value => value.kind === 'http_crawler' && value.name === name,
  );
  return (crawler?.id as CrawlerHttpBotId) || null;
}

export function crawlerIdForRule(rule: { name: string; pattern: string }): CrawlerHttpBotId | null {
  const crawler = crawlerDirectory.find(
    value =>
      value.kind === 'http_crawler' &&
      value.name === rule.name &&
      value.uaSelector === rule.pattern,
  );
  return (crawler?.id as CrawlerHttpBotId) || null;
}

/** One row per platform. Every spider links to that shared row by platformId. */
export function crawlerPlatformReferrals(
  facts: readonly CrawlerPlatformReferral[],
): CrawlerPlatformReferral[] {
  const seen = new Set<CrawlerPlatformId>();
  for (const fact of facts) {
    if (
      !crawlerPlatformIds.includes(fact.platformId) ||
      seen.has(fact.platformId) ||
      !['available', 'missing', 'unsupported'].includes(fact.state) ||
      (fact.state === 'available'
        ? !Number.isSafeInteger(fact.visits) || fact.visits < 0
        : fact.visits !== null)
    ) {
      throw new Error('Invalid or duplicate platform referral aggregate');
    }
    seen.add(fact.platformId);
  }
  return crawlerPlatformIds.map(
    platformId =>
      facts.find(value => value.platformId === platformId) || {
        platformId,
        visits: null,
        state: 'missing',
      },
  );
}
