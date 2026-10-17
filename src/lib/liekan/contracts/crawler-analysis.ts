import type {
  CrawlerBotId,
  CrawlerPlatformId,
  CrawlerObservationQuality,
  CrawlerRequestCounts,
  CrawlerRiskFinding,
} from './crawlers';
import type { CrawlerDirectoryEntry } from '../crawlers/directory';
export interface CrawlerAnalyzedBot extends CrawlerRequestCounts {
  botId: CrawlerBotId | null;
  name: string;
  bytes: number;
  verifiedRange: number;
  rangeMismatch: number;
  unverified: number;
  successfulCatalogPages: number;
  lastVisit: string;
  legacyRecords: number;
}
export interface CrawlerAnalyzedPage extends CrawlerRequestCounts {
  botId: CrawlerBotId | null;
  name?: string;
  path: string;
  humanPath: string;
  mergedPaths: string[];
  bytes: number;
  ownedTerminatingBlocks: number;
  ownedMatches: number;
}
export interface CrawlerAnalyzedPlatform {
  platformId: CrawlerPlatformId;
  state: 'available' | 'missing' | 'unsupported';
  visits: number | null;
  conversions: number | null;
  goalEvents: number | null;
  landingPagesTruncated: boolean;
  landingPages: {
    path: string;
    visits: number;
    conversions: number | null;
    goalEvents: number | null;
  }[];
}
export interface CrawlerStoredFinding {
  key: string;
  botId: CrawlerBotId;
  type: CrawlerRiskFinding['type'];
  pathGroup: string;
  grade: CrawlerRiskFinding['grade'];
  confidence: CrawlerRiskFinding['confidence'];
  state: 'active' | 'ignored' | 'resolved';
  facts: CrawlerRiskFinding;
  firstSeenAt: string;
  lastSeenAt: string;
  windowEnd: string;
  occurrenceWindows: number;
  workflow?: { state: string; snoozedUntil: string | null };
}
export interface CrawlerAnalysisResponse {
  range: { startAt: number; endAt: number; timezone: string };
  quality: CrawlerObservationQuality;
  directory: readonly CrawlerDirectoryEntry[];
  previous: {
    range: CrawlerAnalysisResponse['range'];
    quality: CrawlerObservationQuality;
    bots: (CrawlerRequestCounts & { botId: CrawlerBotId | null; name?: string; bytes: number })[];
    platforms: CrawlerAnalyzedPlatform[];
  };
  bots: CrawlerAnalyzedBot[];
  pagesTruncated: boolean;
  pages: CrawlerAnalyzedPage[];
  platforms: CrawlerAnalyzedPlatform[];
  findings: CrawlerStoredFinding[];
  criticalPaths: string[];
  analysis: { computedAt: string; windowEnd: string; errorCode: string | null } | null;
  generatedAt: string;
  permissions: { canDraft: boolean; canControl: boolean };
}
