import { z } from 'zod';

export const logMeasurementSchema = z.object({
  version: z.literal('log-measurement-v1'),
  host: z.string().max(253).nullable(),
  hostBasis: z.enum(['request_host', 'configured_host', 'declared_host', 'legacy_unknown']),
  sourceIntervalVersion: z.string().max(128).nullable().optional(),
  sourceConfigVersion: z.string().max(128).nullable(),
  samplingRate: z.number().positive().max(1).nullable(),
  samplingBasis: z.enum(['observed_provider_config', 'unknown']),
  bytesAvailability: z.enum(['present', 'missing', 'legacy_unknown']),
  bytesUnit: z.enum(['edge_body', 'combined_response', 'unknown']),
});
export type LogMeasurement = z.infer<typeof logMeasurementSchema>;
