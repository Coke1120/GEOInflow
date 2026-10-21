import { z } from 'zod';
import { defineOperation } from '@/openapi/operation';
import { geoWeightExportSchema, geoWeightResponseSchema } from '@/lib/liekan/contracts/geo-weight';
export const operations = [
  defineOperation({
    method: 'post',
    path: '/api/liekan/websites/{websiteId}/geo-weight/export',
    audience: 'internal',
    auth: 'bearer',
    operation: {
      operationId: 'postLiekanGeoWeightExport',
      summary: 'Export a pinned private GEO weight calculation',
      tags: ['Liekan'],
      requestParams: { path: z.object({ websiteId: z.uuid() }) },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: geoWeightExportSchema } },
      },
      responses: {
        '200': {
          description: 'Localized CSV calculation evidence',
          content: { 'text/csv': { schema: z.string() } },
        },
        '400': { description: 'Invalid input' },
        '401': { description: 'Full session required' },
        '403': { description: 'Permission denied or feature disabled' },
        '404': { description: 'Website unavailable' },
        '409': {
          description: 'Snapshot changed; reload the updated result before exporting',
          content: {
            'application/json': {
              schema: z.object({
                error: z.object({ message: z.string(), status: z.number() }),
                updated: geoWeightResponseSchema.optional(),
              }),
            },
          },
        },
        '413': { description: 'Request body too large' },
        '503': { description: 'Calculation unavailable' },
      },
    },
  }),
] as const;
