import { z } from 'zod';
import { defineOperation } from '@/openapi/operation';
import { evidenceExportSchema } from '@/lib/liekan/contracts/traffic-evidence';
export const operations = [
  defineOperation({
    method: 'post',
    path: '/api/liekan/websites/{websiteId}/crawler-analysis/export',
    audience: 'internal',
    auth: 'bearer',
    operation: {
      operationId: 'postLiekanCrawlerEvidenceExport',
      summary: 'Export a consistent private evidence snapshot',
      tags: ['Liekan'],
      requestParams: { path: z.object({ websiteId: z.uuid() }) },
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: evidenceExportSchema.extend({
              kind: z.enum(['evidence', 'performance', 'outcomes']),
            }),
          },
        },
      },
      responses: {
        '200': {
          description: 'CSV snapshot with metadata and sanitized cells',
          content: { 'text/csv': { schema: z.string() } },
        },
        '400': { description: 'Invalid input' },
        '401': { description: 'Full login required' },
        '403': { description: 'Permission denied' },
        '404': { description: 'Website unavailable' },
        '409': { description: 'Policy or catalog changed' },
        '413': { description: 'Output budget exceeded' },
        '503': { description: 'Computation unavailable' },
      },
    },
  }),
] as const;
