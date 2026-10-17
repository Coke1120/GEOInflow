import { z } from 'zod';

export const CRAWLER_METRIC_VERSION = 'crawler-metrics-v1';
export const crawlerIdentityScopeSchema = z.enum(['all', 'verified_range']);
export type CrawlerIdentityScope = z.infer<typeof crawlerIdentityScopeSchema>;
export const crawlerMetricOptionsSchema = z.object({
  crawlerIdentityScope: crawlerIdentityScopeSchema.default('all'),
  crawlerMetricsVersion: z.coerce.number().pipe(z.literal(1)).optional(),
});
export type CrawlerMetricOptions = z.infer<typeof crawlerMetricOptionsSchema>;
export const evidenceStateSchema = z.enum([
  'available',
  'empty',
  'partial',
  'missing',
  'unsupported',
  'unknown',
  'not_comparable',
]);
export type EvidenceState = z.infer<typeof evidenceStateSchema>;
export interface EvidenceValue<T = number> {
  value: T | null;
  state: EvidenceState;
  reasonCode: string | null;
  sampleCount: number;
  populationCount: number;
  coverage: number | null;
  timeBasis: 'event_time' | 'received_at';
  metricVersion: typeof CRAWLER_METRIC_VERSION;
}
export function evidenceValue<T>(
  value: T | null,
  sampleCount: number,
  populationCount: number,
  state: EvidenceState,
  reasonCode: string | null = null,
  timeBasis: EvidenceValue['timeBasis'] = 'event_time',
): EvidenceValue<T> {
  return {
    value,
    state,
    reasonCode,
    sampleCount,
    populationCount,
    coverage: populationCount ? sampleCount / populationCount : null,
    timeBasis,
    metricVersion: CRAWLER_METRIC_VERSION,
  };
}
