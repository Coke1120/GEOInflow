import { z } from 'zod';
import { defineOperation } from '@/openapi/operation';
import {
  geoWeightRecalculateSchema,
  geoWeightSnapshotResponseSchema,
} from '@/lib/liekan/contracts/geo-weight';
export const operations = [
  defineOperation({
    method: 'post',
    path: '/api/liekan/websites/{websiteId}/geo-weight/recalculate',
    audience: 'internal',
    auth: 'bearer',
    operation: {
      operationId: 'postLiekanGeoWeightRecalculate',
      summary: 'Request an authorized GEO daily snapshot recalculation',
      tags: ['Liekan'],
      requestParams: { path: z.object({ websiteId: z.uuid() }) },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: geoWeightRecalculateSchema } },
      },
      responses: {
        '202': {
          description: 'Durable calculation demand accepted',
          content: { 'application/json': { schema: geoWeightSnapshotResponseSchema } },
        },
        '400': { description: 'Invalid parameters' },
        '401': { description: 'Full session required' },
        '403': { description: 'Website management permission required' },
        '404': { description: 'Website unavailable' },
        '409': { description: 'Request ID parameters differ' },
        '429': { description: 'Cooldown or capacity limit' },
        '503': { description: 'Queue unavailable' },
      },
    },
  }),
] as const;
