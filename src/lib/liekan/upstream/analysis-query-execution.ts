import { analysisTransaction } from './analysis-rollups-db';
import { authorizeCrawler, type CrawlerActor } from './crawler-access';
import { aiExecutor } from './ai-db';
import { analysisQueryParameters } from './analysis-query-model';
import { executeNativeAnalysis } from './analysis-native-execution';
import { readPageReport } from './page-report';
import { featureAnalytics, featureJourney } from './feature-analytics';
import { noteCacheResult } from './cache-context';
import { LiekanError } from './errors';

/** Closed registry of existing report functions; jobs never fetch a client-provided URL. */
export async function executeAnalysisQuery(
  websiteId: string,
  actor: CrawlerActor,
  target: string,
  input: Record<string, unknown>,
) {
  const parameters = analysisQueryParameters(target, input);
  const website = await analysisTransaction(tx =>
    authorizeCrawler(aiExecutor(tx), actor, websiteId),
  );
  if (target === 'feature:page-report') {
    const result = await readPageReport(website, parameters);
    noteCacheResult(result);
    // Permissions are projected for each reader instead of saved with the shared report.
    delete result.value.meta.canManage;
    return result.value;
  }
  if (target === 'feature:analytics') return featureAnalytics(websiteId, parameters);
  if (target === 'feature:journeys') return featureJourney(websiteId, parameters);
  if (target.startsWith('native:'))
    return executeNativeAnalysis(websiteId, target.slice(7), parameters);
  throw new LiekanError('不支持的统计任务', 400);
}
