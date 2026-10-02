import { z } from 'zod';
import { defineOperation } from '@/openapi/operation';
import { badRequestResponse, notFoundResponse, unauthorizedResponse } from '@/openapi/schemas';
export const operations = [
  defineOperation({
    method: 'post',
    path: '/api/liekan/websites/{websiteId}/logs/import',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'postLiekanLogsImport',
      summary: 'post Liekan logs/import',
      tags: ['Liekan'],
      requestParams: { path: z.object({ websiteId: z.uuid() }) },
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: z.object({
              format: z.enum(['json', 'combined']),
              content: z.string().max(10485760).optional(),
              records: z.array(z.record(z.string(), z.unknown())).max(1000).optional(),
            }),
          },
        },
      },
      responses: {
        '200': {
          description: 'Liekan contract v1 response',
          content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } },
        },
        '400': badRequestResponse,
        '401': unauthorizedResponse,
        '404': notFoundResponse,
      },
    },
  }),
] as const;
