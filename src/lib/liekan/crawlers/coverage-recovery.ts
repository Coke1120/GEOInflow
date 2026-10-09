import type { CrawlerObservationQuality } from '../contracts/crawlers';
import { comparableCrawlerQuality, completeEventQuality } from './risks';
const DAY = 86400000;
export function coverageRecovery(
  previous: { good: number; dayEnd: number | null; quality: CrawlerObservationQuality | null },
  quality: CrawlerObservationQuality | null,
  dayEnd: number,
) {
  if (previous.dayEnd !== null && dayEnd <= previous.dayEnd)
    return {
      good: previous.good,
      resolved: previous.good === 2,
      dayEnd: previous.dayEnd,
      quality: previous.quality,
    };
  const complete = quality && completeEventQuality(quality);
  const consecutive =
    previous.dayEnd === dayEnd - DAY &&
    previous.quality &&
    quality &&
    comparableCrawlerQuality(previous.quality, quality);
  const good = complete ? (consecutive ? Math.min(2, previous.good + 1) : 1) : 0;
  return { good, resolved: good === 2, dayEnd, quality };
}
