import { z } from 'zod';
import { defineOperation } from '@/openapi/operation';
import {
  trafficPreviewResultSchema,
  trafficPreviewSchema,
} from '@/lib/liekan/contracts/traffic-quality';
import {
  badRequestResponse,
  notFoundResponse,
  unauthorizedResponse,
  forbiddenResponse,
} from '@/openapi/schemas';
export const operations = [
  defineOperation({
    method: 'post',
    path: '/api/liekan/websites/{websiteId}/traffic-quality/preview',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'previewLiekanTrafficPolicy',
      summary: 'Preview traffic policy impact',
      tags: ['Liekan'],
      requestParams: { path: z.object({ websiteId: z.uuid() }) },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: trafficPreviewSchema } },
      },
      responses: {
        '200': {
          description: 'Quality analysis',
          content: { 'application/json': { schema: trafficPreviewResultSchema } },
        },
        '400': badRequestResponse,
        '401': unauthorizedResponse,
        '403': forbiddenResponse,
        '404': notFoundResponse,
        '409': { description: 'Policy revision conflict' },
        '501': { description: 'Unsupported analytics backend' },
      },
    },
  }),
] as const;
