import { z } from 'zod';
import { reportQuery } from '@/lib/liekan/contracts/query';
import { liekanReportSchema } from '@/lib/liekan/contracts/report';
import { defineOperation } from '@/openapi/operation';
import {
  apiErrorSchema,
  badRequestResponse,
  notFoundResponse,
  unauthorizedResponse,
} from '@/openapi/schemas';
export const operations = [
  defineOperation({
    method: 'get',
    path: '/api/liekan/websites/{websiteId}/report',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'getLiekanReport',
      summary: 'get Liekan report',
      tags: ['Liekan'],
      requestParams: {
        path: z.object({ websiteId: z.uuid() }),
        query: reportQuery.extend({
          resource: reportQuery.shape.resource.exclude(['human/keywords']),
        }),
      },
      responses: {
        '200': {
          description: 'Liekan contract v1 response',
          content: { 'application/json': { schema: liekanReportSchema } },
        },
        '400': badRequestResponse,
        '401': unauthorizedResponse,
        '404': notFoundResponse,
        '409': {
          description: 'The reporting revision or cursor scope changed; reload the report',
          content: { 'application/json': { schema: apiErrorSchema } },
        },
      },
    },
  }),
] as const;
