import snapshots from '../../../../config/liekan/bot-ranges.json';
import { projectArticles } from '../contracts/product';
import { BOT_RULES, classifyBot } from '../rules/bots';
import { helpGuides } from './articles';
import { helpCrawlers } from './crawlers';
import helpRanges from './ip-snapshots.json';
import { helpMetrics } from './metrics';
import { type Crawler, type HelpArticle, helpSections } from './types';

export { helpCrawlers, helpSections };
export const helpArticles: HelpArticle[] = [...helpGuides, ...helpMetrics, ...projectArticles];
export const helpIdentityCount = Object.keys(snapshots).length;
export const helpRuleCount = BOT_RULES.length;
export type PublicRangeSnapshot = {
  source: string;
  retrievedAt: string;
  publishedAt?: string;
  prefixes: string[];
};
const publicRanges: Record<string, PublicRangeSnapshot> = snapshots;

export function crawlerCapabilities(crawler: Crawler) {
  const classified =
    crawler.kind === 'crawler' && crawler.evidence !== 'pending'
      ? classifyBot(crawler.token)
      : undefined;
  const rule = classified?.name !== '其他' ? classified : undefined;
  return { rule, ip: !!(rule && publicRanges[rule.name]) };
}
export function crawlerSnapshot(crawler: Crawler): PublicRangeSnapshot | undefined {
  // A vendor-wide list is not automatically evidence for every crawler at that vendor.
  return crawler.feeds
    .map(feed =>
      [...Object.values(publicRanges), ...helpRanges].find(range => range.source === feed.url),
    )
    .find(Boolean);
}
export function snapshotState(range: PublicRangeSnapshot | undefined, now: number = Date.now()) {
  if (!range) return 'missing';
  const date = Date.parse(range.retrievedAt);
  return Number.isFinite(date) && Math.abs(now - date) <= 7 * 86400000 ? 'fresh' : 'stale';
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
) {
  return helpCrawlers.filter(
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
export function helpLocation(query: Record<string, string>) {
  const article = helpArticles.find(item => item.id === query.article);
  const crawler = helpCrawlers.find(item => item.id === query.crawler);
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
