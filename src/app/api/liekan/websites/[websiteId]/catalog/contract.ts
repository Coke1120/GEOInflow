import { z } from 'zod';
import { defineOperation } from '@/openapi/operation';
import { badRequestResponse, notFoundResponse, unauthorizedResponse } from '@/openapi/schemas';
export const operations = [
  defineOperation({
    method: 'put',
    path: '/api/liekan/websites/{websiteId}/catalog',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'putLiekanCatalog',
      summary: 'put Liekan catalog',
      tags: ['Liekan'],
      requestParams: { path: z.object({ websiteId: z.uuid() }) },
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: z.object({
              format: z.enum(['json', 'csv', 'sitemap']),
              content: z.string().max(10485760),
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
