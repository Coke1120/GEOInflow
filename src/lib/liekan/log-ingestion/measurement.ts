import { z } from 'zod';

const providerConfigObservationSchema = z.object({
  version: z.string().min(1).max(128),
  observedAt: z.iso.datetime({ offset: true }),
  samplingRate: z.number().positive().max(1),
});
export const logMeasurementSchema = z.object({
  version: z.literal('log-measurement-v1'),
  host: z.string().max(253).nullable(),
  hostBasis: z.enum(['request_host', 'configured_host', 'declared_host', 'legacy_unknown']),
  sourceIntervalVersion: z.string().max(128).nullable().optional(),
  sourceConfigVersion: z.string().max(128).nullable(),
  samplingRate: z.number().positive().max(1).nullable(),
  samplingBasis: z.enum(['observed_provider_config', 'unknown']),
  samplingTimeBasis: z.enum(['event_time', 'received_at']).optional(),
  providerConfigAtReceipt: providerConfigObservationSchema
    .extend({ receivedAt: z.iso.datetime({ offset: true }) })
    .optional(),
  bytesAvailability: z.enum(['present', 'missing', 'legacy_unknown']),
  bytesUnit: z.enum(['edge_body', 'combined_response', 'unknown']),
});
export type LogMeasurement = z.infer<typeof logMeasurementSchema>;

/** A recent provider read describes receipt context without proving a record's sampling. */
export function samplingAtReceipt(
  kind: 'cloudflare' | 'server',
  observed: unknown,
  receivedAt = new Date(),
): Pick<
  LogMeasurement,
  'samplingRate' | 'samplingBasis' | 'samplingTimeBasis' | 'providerConfigAtReceipt'
> {
  const parsed = providerConfigObservationSchema.safeParse(observed);
  const age = parsed.success ? +receivedAt - Date.parse(parsed.data.observedAt) : NaN;
  return {
    samplingRate: null,
    samplingBasis: 'unknown',
    samplingTimeBasis: undefined,
    providerConfigAtReceipt:
      kind === 'cloudflare' && parsed.success && age >= 0 && age <= 3600000
        ? { ...parsed.data, receivedAt: receivedAt.toISOString() }
        : undefined,
  };
}

/** Legacy provider observations have no event-time proof and remain unknown when read. */
export const eventSamplingRateSql = `CASE WHEN e.measurement->>'samplingTimeBasis'='event_time'
  AND e.measurement->>'samplingBasis'='observed_provider_config'
  AND jsonb_typeof(e.measurement->'samplingRate')='number'
  THEN CASE WHEN (e.measurement->>'samplingRate')::numeric>0 AND (e.measurement->>'samplingRate')::numeric<=1
    THEN (e.measurement->>'samplingRate')::numeric END END`;
