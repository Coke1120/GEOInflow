import type { CatalogPayload } from '../contracts/crawler-registry';
import baselines from '../../../../config/liekan/crawler-range-baselines.json';
import { rangeSources } from '../crawlers/range-sources';
import { projectArticles } from '../contracts/product';
import { BOT_RULES, classifyBot } from '../rules/bots';
import { helpGuides } from './articles';
import { helpCrawlers } from './crawlers';
import helpRanges from './ip-snapshots.json';
import { helpMetrics } from './metrics';
import { type Crawler, type HelpArticle, helpSections } from './types';

export { helpCrawlers, helpSections };
export const helpArticles: HelpArticle[] = [...helpGuides, ...helpMetrics, ...projectArticles];
export const helpIdentityCount = new Set(rangeSources.flatMap(source => source.names)).size;
export const helpRuleCount = BOT_RULES.length;
export type PublicRangeSnapshot = {
  source: string;
  retrievedAt: string;
  publishedAt?: string;
  prefixes: string[];
};
const publicRanges: Record<string, PublicRangeSnapshot> = Object.fromEntries(
  rangeSources.flatMap(source => {
    const baseline = baselines[source.id];
    return baseline
      ? source.names.map(name => [
          name,
          {
            source: source.url,
            retrievedAt: baseline.observedAt,
            publishedAt: baseline.publishedAt,
            prefixes: baseline.prefixes,
          },
        ])
      : [];
  }),
);

function catalogRanges(catalog?: CatalogPayload): Record<string, PublicRangeSnapshot> {
  if (!catalog) return publicRanges;
  return Object.fromEntries(catalog.rangeSources.filter(source => source.enabled !== false).flatMap(source => {
    const baseline = catalog.rangeBaselines[source.id];
    return baseline ? source.names.map(name => [name, { source: source.url, retrievedAt: baseline.observedAt, publishedAt: baseline.publishedAt, prefixes: baseline.prefixes }]) : [];
  }));
}
export function crawlerCapabilities(crawler: Crawler, catalog?: CatalogPayload) {
  if (catalog) {
    const identity = catalog.identities.find(item => item.id === crawler.id && item.status === 'active' && item.kind !== 'robots_purpose');
    return { rule: identity, ip: !!(identity && catalogRanges(catalog)[identity.name]) };
  }
  const classified =
    crawler.kind === 'crawler' && crawler.evidence !== 'pending'
      ? classifyBot(crawler.token)
      : undefined;
  const rule = classified?.name !== '其他' ? classified : undefined;
  return { rule, ip: !!(rule && publicRanges[rule.name]) };
}
export function crawlerSnapshot(crawler: Crawler, catalog?: CatalogPayload): PublicRangeSnapshot | undefined {
  const publicRanges = catalogRanges(catalog);
  if (crawler.kind === 'control') return;
  if (publicRanges[crawler.name]) return publicRanges[crawler.name];
  // Reference-only feeds remain separate from active identity verification.
  return crawler.feeds
    .map(feed =>
      [...Object.values(publicRanges), ...helpRanges].find(range => range.source === feed.url),
    )
    .find(Boolean);
}
export function snapshotState(range: PublicRangeSnapshot | undefined, now: number = Date.now()) {
  if (!range) return 'missing';
  const date = Date.parse(range.retrievedAt);
  return Number.isFinite(date) && date <= now && now - date <= 7 * 86400000 ? 'fresh' : 'stale';
}
export function searchText(query: string, fields: string[]) {
  const terms = query
    .slice(0, 256)
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const haystack = fields.join(' ').normalize('NFKC').toLowerCase();
  return terms.every(term => haystack.includes(term));
}
export function searchArticles(query: string, section?: string, display = (text: string) => text) {
  return helpArticles.filter(
    article =>
      (!section || article.section === section) &&
      searchText(
        query,
        [
          article.title,
          article.summary,
          ...article.keywords,
          ...article.blocks.flatMap(block => [
            block.title,
            ...block.paragraphs,
            block.code?.text || '',
          ]),
        ].flatMap(text => [text, display(text)]),
      ),
  );
}
export function searchCrawlers(
  query: string,
  purpose = '',
  vendor = '',
  kind = '',
  display = (text: string) => text,
  directory: Crawler[] = helpCrawlers,
) {
  return directory.filter(
    crawler =>
      (!purpose || crawler.purposes.includes(purpose as any)) &&
      (!vendor || crawler.vendor === vendor) &&
      (!kind || crawler.kind === kind) &&
      searchText(
        query,
        [
          crawler.name,
          crawler.vendor,
          crawler.token,
          crawler.robotsToken || '',
          crawler.ua || '',
          crawler.summary,
          ...crawler.aliases,
          ...crawler.purposes,
          ...crawler.feeds.map(feed => feed.url),
          crawler.verification,
        ].flatMap(text => [text, display(text)]),
      ),
  );
}
export function crawlerRobotsDraft(crawler: Crawler): string | undefined {
  if (crawler.evidence !== 'operator' || !crawler.robotsToken) return;
  return `# Configuration draft: review purpose and merge existing rules\n# ${crawler.name} | reviewed ${crawler.reviewedAt}\nUser-agent: ${crawler.robotsToken}\nDisallow: /\n`;
}
export function helpLocation(query: Record<string, string>, directory: Crawler[] = helpCrawlers) {
  const article = helpArticles.find(item => item.id === query.article);
  const crawler = directory.find(item => item.id === query.crawler);
  const section = helpSections.find(item => item.id === query.section)?.id;
  const invalid =
    (!!query.article && !article) ||
    (!!query.crawler && !crawler) ||
    (!!query.article && !!query.crawler) ||
    (!!query.section && !section);
  return {
    article,
    crawler,
    section: article?.section || (crawler ? 'crawlers' : section),
    invalid,
  };
}
