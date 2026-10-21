import {
  type CrawlerBotId,
  type CrawlerHttpBotId,
  type CrawlerPlatformId,
  type CrawlerPlatformReferral,
} from '../contracts/crawlers';
import type { Crawler } from '../help/types';
import { type BotRule, LEGACY_BOT_RULES, officialCrawlerForRule } from '../rules/bots';
import { crawlerCatalog, getCrawlerCatalog } from './catalog';
import { ACTIVE_CRAWLER_IDS, type CrawlerType, getCrawlerRegistry, getCrawlerPlatformIds } from './registry';

export interface CrawlerDirectoryEntry {
  id: CrawlerBotId;
  name: string;
  platformId: CrawlerPlatformId;
  type: CrawlerType;
  kind: 'http_crawler' | 'robots_purpose' | 'signed_agent';
  uaSelector: string | null;
  robotsToken: string | null;
  robotsApplicability: 'applicable' | 'user_triggered_caveat';
  documentationUrl: string;
  impact: string;
  identityEvidence: 'declared_ua_requires_verification' | 'signed_identity_requires_verification' | 'no_http_identity';
  family: string;
  aiEligible: boolean;
  status: 'active' | 'pending' | 'inactive';
  evidence: Crawler['evidence'];
  reviewedAt: string;
  sources: Crawler['sources'];
  control: { remote: boolean; nginx: boolean };
}

function directoryEntry(entry: ReturnType<typeof getCrawlerCatalog>[number]): Readonly<CrawlerDirectoryEntry> {
  return {
    id: entry.id, name: entry.name, platformId: entry.platformId, type: entry.type,
    kind: entry.kind, uaSelector: entry.uaSelector, robotsToken: entry.robotsToken,
    robotsApplicability: ['chatgpt-user', 'perplexity-user', 'amzn-user', 'kimi-user', 'exauser'].includes(entry.id)
      ? 'user_triggered_caveat' : 'applicable',
    documentationUrl: entry.metadata.sources[0]?.url || '', impact: entry.metadata.summary,
    identityEvidence: entry.kind === 'http_crawler' ? 'declared_ua_requires_verification' : entry.kind === 'signed_agent' ? 'signed_identity_requires_verification' : 'no_http_identity',
    family: entry.family, aiEligible: entry.aiEligible, status: entry.status,
    evidence: entry.metadata.evidence, reviewedAt: entry.metadata.reviewedAt,
    sources: entry.metadata.sources, control: entry.control,
  };
}
// Bundled exports remain available to compatible integrations; runtime readers use the bound version.
export const knownCrawlerDirectory: readonly Readonly<CrawlerDirectoryEntry>[] = Object.freeze(
  crawlerCatalog.filter(entry => entry.status === 'active').sort((left, right) => {
    const position = (entry: typeof left) => entry.kind === 'robots_purpose'
      ? ACTIVE_CRAWLER_IDS.length : ACTIVE_CRAWLER_IDS.indexOf(entry.id);
    return position(left) - position(right);
  }).map(entry => Object.freeze(directoryEntry(entry))),
);
export const crawlerDirectory = knownCrawlerDirectory;
export const getKnownCrawlerDirectory = () => getCrawlerCatalog().map(directoryEntry);
export const getCrawlerDirectory = () => getKnownCrawlerDirectory().filter(entry => entry.status === 'active');
export function crawlerDirectoryForObserved(ids: readonly string[]) {
  return getKnownCrawlerDirectory().filter(entry => entry.status === 'active' || ids.includes(entry.id));
}
export function getCrawler(id: CrawlerBotId): Readonly<CrawlerDirectoryEntry> {
  const crawler = getKnownCrawlerDirectory().find(value => value.id === id);
  if (!crawler) throw new Error('Unknown crawler');
  return crawler;
}
// Historical IDs remain readable when their current recognition is disabled.
export function crawlerIdForName(name: string): CrawlerHttpBotId | null {
  return getCrawlerRegistry().find(value => value.kind === 'http_crawler' && value.name === name)?.id || null;
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
      !getCrawlerPlatformIds().includes(fact.platformId) ||
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
  return getCrawlerPlatformIds().map(
    platformId =>
      facts.find(value => value.platformId === platformId) || {
        platformId,
        visits: null,
        state: 'missing',
      },
  );
}
