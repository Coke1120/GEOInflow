import { getPublishedCatalog } from './published';
import { getCrawlerCatalog } from './catalog';
/** Reviewed official feeds and exact HTTP crawler bindings; safe for client imports. */
export type RangeSource = {
  id: string;
  url: string;
  names: readonly string[];
  crawlerIds: readonly string[];
  parserVersion: string;
  reviewedAt: string;
  enabled?: boolean;
  /** Separately reviewed for anonymous browser exclusion; omitted values grant no authority. */
  browserExclusion?: 'dedicated_crawler' | 'unsupported';
};

export const rangeSources: readonly RangeSource[] = Object.freeze([
  Object.freeze({
    id: 'openai-gpt',
    url: 'https://openai.com/gptbot.json',
    names: Object.freeze(['GPTBot']),
    crawlerIds: Object.freeze(['gptbot']),
    browserExclusion: 'dedicated_crawler',
    parserVersion: 'prefixes-v1',
    reviewedAt: '2026-10-15',
  }),
  Object.freeze({
    id: 'openai-search',
    url: 'https://openai.com/searchbot.json',
    names: Object.freeze(['OAI-SearchBot']),
    crawlerIds: Object.freeze(['oai-searchbot']),
    browserExclusion: 'dedicated_crawler',
    parserVersion: 'prefixes-v1',
    reviewedAt: '2026-10-15',
  }),
  Object.freeze({
    id: 'openai-user',
    url: 'https://openai.com/chatgpt-user.json',
    names: Object.freeze(['ChatGPT-User']),
    crawlerIds: Object.freeze(['chatgpt-user']),
    browserExclusion: 'dedicated_crawler',
    parserVersion: 'prefixes-v1',
    reviewedAt: '2026-10-15',
  }),
  Object.freeze({
    id: 'openai-ads',
    url: 'https://openai.com/adsbot.json',
    names: Object.freeze(['OAI-AdsBot']),
    crawlerIds: Object.freeze(['oai-adsbot']),
    browserExclusion: 'dedicated_crawler',
    parserVersion: 'prefixes-v1',
    reviewedAt: '2026-10-15',
  }),
  Object.freeze({
    id: 'anthropic',
    url: 'https://claude.com/crawling/bots.json',
    names: Object.freeze(['ClaudeBot', 'Claude-SearchBot', 'Claude-User']),
    crawlerIds: Object.freeze(['claudebot', 'claude-searchbot', 'claude-user']),
    browserExclusion: 'dedicated_crawler',
    parserVersion: 'prefixes-v1',
    reviewedAt: '2026-10-15',
  }),
  Object.freeze({
    id: 'perplexity-bot',
    url: 'https://www.perplexity.ai/perplexitybot.json',
    names: Object.freeze(['PerplexityBot']),
    crawlerIds: Object.freeze(['perplexitybot']),
    browserExclusion: 'dedicated_crawler',
    parserVersion: 'prefixes-v1',
    reviewedAt: '2026-10-15',
  }),
  Object.freeze({
    id: 'perplexity-user',
    url: 'https://www.perplexity.ai/perplexity-user.json',
    names: Object.freeze(['Perplexity-User']),
    crawlerIds: Object.freeze(['perplexity-user']),
    browserExclusion: 'dedicated_crawler',
    parserVersion: 'prefixes-v1',
    reviewedAt: '2026-10-15',
  }),
  Object.freeze({
    id: 'kimi-bot',
    url: 'https://www.kimi.ai/policies/kimibot.json',
    names: Object.freeze(['KimiBot']),
    crawlerIds: Object.freeze(['kimibot']),
    browserExclusion: 'dedicated_crawler',
    parserVersion: 'prefixes-v1',
    reviewedAt: '2026-10-21',
  }),
  Object.freeze({
    id: 'kimi-search',
    url: 'https://www.kimi.ai/policies/kimi-searchbot.json',
    names: Object.freeze(['Kimi-SearchBot']),
    crawlerIds: Object.freeze(['kimi-searchbot']),
    browserExclusion: 'dedicated_crawler',
    parserVersion: 'prefixes-v1',
    reviewedAt: '2026-10-21',
  }),
  Object.freeze({
    id: 'kimi-user',
    url: 'https://www.kimi.ai/policies/kimi-user.json',
    names: Object.freeze(['Kimi-User']),
    crawlerIds: Object.freeze(['kimi-user']),
    browserExclusion: 'dedicated_crawler',
    parserVersion: 'prefixes-v1',
    reviewedAt: '2026-10-21',
  }),
  Object.freeze({
    id: 'tencent-hyspider',
    url: 'https://hy.tencent.com/policy/hyspider.json',
    names: Object.freeze(['HySpider']),
    crawlerIds: Object.freeze(['hyspider']),
    browserExclusion: 'dedicated_crawler',
    parserVersion: 'prefixes-v1',
    reviewedAt: '2026-10-21',
  }),
  Object.freeze({
    id: 'google-common',
    url: 'https://developers.google.com/static/crawling/ipranges/common-crawlers.json',
    names: Object.freeze([
      'Googlebot',
      'Googlebot-Image',
      'Googlebot-Video',
      'GoogleOther',
      'GoogleOther-Image',
      'GoogleOther-Video',
      'Storebot-Google',
      'Google-InspectionTool',
      'Google-CloudVertexBot',
    ]),
    crawlerIds: Object.freeze([
      'googlebot',
      'googlebot-image',
      'googlebot-video',
      'googleother',
      'googleother-image',
      'googleother-video',
      'storebot-google',
      'google-inspectiontool',
      'google-cloudvertexbot',
    ]),
    browserExclusion: 'dedicated_crawler',
    parserVersion: 'prefixes-v1',
    reviewedAt: '2026-10-15',
  }),
  Object.freeze({
    id: 'bing',
    url: 'https://www.bing.com/toolbox/bingbot.json',
    names: Object.freeze(['bingbot']),
    crawlerIds: Object.freeze(['bingbot']),
    browserExclusion: 'dedicated_crawler',
    parserVersion: 'prefixes-v1',
    reviewedAt: '2026-10-15',
  }),
  Object.freeze({
    id: 'apple',
    url: 'https://search.developer.apple.com/applebot.json',
    names: Object.freeze(['Applebot']),
    crawlerIds: Object.freeze(['applebot']),
    browserExclusion: 'dedicated_crawler',
    parserVersion: 'prefixes-v1',
    reviewedAt: '2026-10-15',
  }),
  Object.freeze({
    id: 'mistral-user',
    url: 'https://mistral.ai/mistralai-user-ips.json',
    names: Object.freeze(['MistralAI-User']),
    crawlerIds: Object.freeze(['mistralai-user']),
    browserExclusion: 'dedicated_crawler',
    parserVersion: 'prefixes-v1',
    reviewedAt: '2026-10-15',
  }),
  Object.freeze({
    id: 'mistral-index',
    url: 'https://mistral.ai/mistralai-index-ips.json',
    names: Object.freeze(['MistralAI-Index']),
    crawlerIds: Object.freeze(['mistralai-index']),
    browserExclusion: 'dedicated_crawler',
    parserVersion: 'prefixes-v1',
    reviewedAt: '2026-10-15',
  }),
  Object.freeze({
    id: 'duck-bot',
    url: 'https://duckduckgo.com/duckduckbot.json',
    names: Object.freeze(['DuckDuckBot']),
    crawlerIds: Object.freeze(['duckduckbot']),
    browserExclusion: 'dedicated_crawler',
    parserVersion: 'prefixes-v1',
    reviewedAt: '2026-10-15',
  }),
  Object.freeze({
    id: 'duck-assist',
    url: 'https://duckduckgo.com/duckassistbot.json',
    names: Object.freeze(['DuckAssistBot']),
    crawlerIds: Object.freeze(['duckassistbot']),
    browserExclusion: 'dedicated_crawler',
    parserVersion: 'prefixes-v1',
    reviewedAt: '2026-10-15',
  }),
  Object.freeze({
    id: 'commoncrawl',
    url: 'https://index.commoncrawl.org/ccbot.json',
    names: Object.freeze(['CCBot']),
    crawlerIds: Object.freeze(['ccbot']),
    browserExclusion: 'dedicated_crawler',
    parserVersion: 'prefixes-v1',
    reviewedAt: '2026-10-15',
  }),
  Object.freeze({
    id: 'ahrefs',
    url: 'https://api.ahrefs.com/v3/public/crawler-ip-ranges',
    names: Object.freeze(['AhrefsBot']),
    crawlerIds: Object.freeze(['ahrefsbot']),
    browserExclusion: 'dedicated_crawler',
    parserVersion: 'prefixes-v1',
    reviewedAt: '2026-10-15',
  }),
  Object.freeze({
    id: 'amazonbot',
    url: 'https://developer.amazon.com/amazonbot/ip-addresses/',
    names: Object.freeze(['Amazonbot']),
    crawlerIds: Object.freeze(['amazonbot']),
    browserExclusion: 'dedicated_crawler',
    parserVersion: 'amazon-code-json-v1',
    reviewedAt: '2026-10-17',
  }),
  Object.freeze({
    id: 'amazon-search',
    url: 'https://developer.amazon.com/amazonbot/searchbot-ip-addresses/',
    names: Object.freeze(['Amzn-SearchBot']),
    crawlerIds: Object.freeze(['amzn-searchbot']),
    browserExclusion: 'dedicated_crawler',
    parserVersion: 'amazon-code-json-v1',
    reviewedAt: '2026-10-17',
  }),
  Object.freeze({
    id: 'amazon-user',
    url: 'https://developer.amazon.com/amazonbot/live-ip-addresses/',
    names: Object.freeze(['Amzn-User']),
    crawlerIds: Object.freeze(['amzn-user']),
    browserExclusion: 'dedicated_crawler',
    parserVersion: 'amazon-code-json-v1',
    reviewedAt: '2026-10-17',
  }),
]);

export const getRangeSources = (): readonly RangeSource[] =>
  getPublishedCatalog()?.payload.rangeSources.filter(source => source.enabled !== false) ??
  rangeSources;

/** A feed can verify a named log crawler without proving an anonymous browser is automated. */
export function getBrowserRangeSources(): readonly RangeSource[] {
  const identities = getCrawlerCatalog();
  return getRangeSources().filter(
    source =>
      source.browserExclusion === 'dedicated_crawler' &&
      source.crawlerIds.length === source.names.length &&
      source.crawlerIds.every((id, index) =>
        identities.some(
          identity =>
            identity.id === id &&
            identity.name === source.names[index] &&
            identity.kind === 'http_crawler' &&
            identity.status === 'active' &&
            identity.metadata.evidence === 'operator',
        ),
      ),
  );
}
