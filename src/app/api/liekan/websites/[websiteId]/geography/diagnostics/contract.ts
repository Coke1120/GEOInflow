import { z } from 'zod';
import { defineOperation } from '@/openapi/operation';
import { geographyCoverageSchema } from '@/lib/liekan/contracts/report';
import { geographyDiagnosticQuery } from '@/lib/liekan/upstream/geography-diagnostics';
import {
  badRequestResponse,
  notFoundResponse,
  unauthorizedResponse,
  forbiddenResponse,
} from '@/openapi/schemas';
const count = z.number().int().nonnegative();
export const geographyDiagnosticSchema = z.object({
  available: z.boolean(),
  reason: z.string().optional(),
  range: z.object({ startAt: z.number(), endAt: z.number(), timezone: z.string() }).optional(),
  coverage: geographyCoverageSchema.optional(),
  ingress: z.array(z.object({ reason: z.string(), count })).optional(),
  evidence: z
    .array(
      z.object({
        precision: z.string(),
        reason: z.string(),
        source: z.string(),
        trust: z.string(),
        ipFamily: z.string(),
        dataVersion: z.string().nullable(),
        ruleVersion: z.string().nullable(),
        shadowPrecision: z.string().nullable(),
        shadowReason: z.string().nullable(),
        events: count,
      }),
    )
    .optional(),
  versions: z.object({ dictionary: z.string(), rule: z.string(), anchor: z.string() }).optional(),
  runtime: z
    .object({
      version: z.string().nullable(),
      providers: z.array(z.string()),
      chinaMode: z.string(),
      dataAvailable: z.boolean(),
    })
    .optional(),
  configuration: z
    .object({
      trustedIngressConfigured: z.boolean(),
      ignoreRuleCount: count,
      invalidIgnoreRuleCount: count,
    })
    .optional(),
});
export const operations = [
  defineOperation({
    method: 'get',
    path: '/api/liekan/websites/{websiteId}/geography/diagnostics',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'getLiekanGeographyDiagnostics',
      summary: 'Inspect aggregate geography coverage and evidence',
      tags: ['Liekan'],
      requestParams: { path: z.object({ websiteId: z.uuid() }), query: geographyDiagnosticQuery },
      responses: {
        '200': {
          description: 'Private aggregate geography diagnostics',
          content: { 'application/json': { schema: geographyDiagnosticSchema } },
        },
        '400': badRequestResponse,
        '401': unauthorizedResponse,
        '403': forbiddenResponse,
        '404': notFoundResponse,
      },
    },
  }),
] as const;
