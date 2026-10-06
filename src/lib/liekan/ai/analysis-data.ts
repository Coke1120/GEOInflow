import type { AiFactsContext } from './facts-contracts';
const positive = (...counts: Array<number | null | undefined>) =>
  counts.some(value => typeof value === 'number' && value > 0);
/** Current zeroes still support analysis when the previous period or configured goals contain events. */
export function isAiContextEmpty(context: AiFactsContext) {
  if (context.metrics.some(metric => positive(metric.value))) return false;
  return !context.facts.some(fact => {
    switch (fact.id) {
      case 'summary':
        return (
          [fact.data.current, fact.data.previous].some(
            row => row && positive(row.pageviews, row.visitors, row.visits),
          ) || [fact.data.logs, fact.data.previousLogs].some(row => row && positive(row.requests))
        );
      case 'bots':
        return positive(fact.data.requests, fact.data.previousRequests);
      case 'log-errors':
        return positive(fact.data.requests, fact.data.previousRequests);
      case 'ai-referrals':
        return positive(
          fact.data.visits,
          fact.data.pageviews,
          fact.data.previousVisits,
          fact.data.previousPageviews,
        );
      case 'pages':
        return fact.data.rows.some(row =>
          positive(
            row.humanPageviews,
            row.previousHumanPageviews,
            row.aiRequests,
            row.previousAiRequests,
          ),
        );
      case 'goals':
        return fact.data.rows.some(row => positive(row.count, row.previousCount));
    }
  });
}
