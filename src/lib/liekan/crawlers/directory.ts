import {
  type CrawlerBotId,
  type CrawlerHttpBotId,
  type CrawlerPlatformId,
  type CrawlerPlatformReferral,
  crawlerPlatformIds,
} from '../contracts/crawlers';
import type { Crawler } from '../help/types';
import { type BotRule, LEGACY_BOT_RULES, officialCrawlerForRule } from '../rules/bots';
import { crawlerCatalog } from './catalog';
import { ACTIVE_CRAWLER_IDS, type CrawlerType, crawlerRegistry } from './registry';

export interface CrawlerDirectoryEntry {
  id: CrawlerBotId;
  name: string;
  platformId: CrawlerPlatformId;
  type: CrawlerType;
  kind: 'http_crawler' | 'robots_purpose';
  uaSelector: string | null;
  robotsToken: string | null;
  robotsApplicability: 'applicable' | 'user_triggered_caveat';
  documentationUrl: string;
  impact: string;
  identityEvidence: 'declared_ua_requires_verification' | 'no_http_identity';
  family: string;
  aiEligible: boolean;
  status: 'active' | 'pending';
  evidence: Crawler['evidence'];
  reviewedAt: string;
  sources: Crawler['sources'];
  control: { remote: boolean; nginx: boolean };
}

export const knownCrawlerDirectory: readonly Readonly<CrawlerDirectoryEntry>[] = Object.freeze(
  crawlerCatalog
    .filter(entry => entry.status === 'active')
    .sort((left, right) => {
      const position = (entry: typeof left) =>
        entry.kind === 'robots_purpose'
          ? ACTIVE_CRAWLER_IDS.length
          : ACTIVE_CRAWLER_IDS.indexOf(entry.id);
      return position(left) - position(right);
    })
    .map(entry =>
      Object.freeze({
        id: entry.id,
        name: entry.name,
        platformId: entry.platformId,
        type: entry.type,
        kind: entry.kind,
        uaSelector: entry.uaSelector,
        robotsToken: entry.robotsToken,
        robotsApplicability: ['chatgpt-user', 'perplexity-user', 'amzn-user'].includes(entry.id)
          ? ('user_triggered_caveat' as const)
          : ('applicable' as const),
        documentationUrl: entry.metadata.sources[0]?.url || '',
        impact: entry.metadata.summary,
        identityEvidence:
          entry.kind === 'http_crawler'
            ? ('declared_ua_requires_verification' as const)
            : ('no_http_identity' as const),
        family: entry.family,
        aiEligible: entry.aiEligible,
        status: entry.status,
        evidence: entry.metadata.evidence,
        reviewedAt: entry.metadata.reviewedAt,
        sources: entry.metadata.sources,
        control: entry.control,
      }),
    ),
);

export const crawlerDirectory = Object.freeze(
  knownCrawlerDirectory.filter(
    entry =>
      entry.kind === 'robots_purpose' || ACTIVE_CRAWLER_IDS.includes(entry.id as CrawlerHttpBotId),
  ),
);

export function crawlerDirectoryForObserved(ids: readonly string[]) {
  return knownCrawlerDirectory.filter(
    entry => crawlerDirectory.includes(entry) || ids.includes(entry.id),
  );
}

export function getCrawler(id: CrawlerBotId): Readonly<CrawlerDirectoryEntry> {
  const crawler = knownCrawlerDirectory.find(value => value.id === id);
  if (!crawler) throw new Error('Unknown crawler');
  return crawler;
}

// Historical names retain stable IDs independently of active recognition and display copy.
export function crawlerIdForName(name: string): CrawlerHttpBotId | null {
  const crawler = crawlerRegistry.find(
    value => value.kind === 'http_crawler' && value.status === 'active' && value.name === name,
  );
  return (crawler?.id as CrawlerHttpBotId) || null;
}

export function crawlerIdForRule(
  rule: Pick<BotRule, 'name' | 'pattern'> & Partial<BotRule>,
): CrawlerHttpBotId | null {
  const official = officialCrawlerForRule(rule);
  if (official) return official.id;
  // Exact historical records retain compatibility. Custom settings always have matchMode.
  if (
    Object.keys(rule).length !== 4 ||
    rule.matchMode !== undefined ||
    rule.crawlerId !== undefined
  )
    return null;
  const legacy = LEGACY_BOT_RULES.find(
    value =>
      value.name === rule.name &&
      value.vendor === rule.vendor &&
      value.type === rule.type &&
      value.pattern === rule.pattern,
  );
  return legacy ? crawlerIdForName(legacy.name) : null;
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
