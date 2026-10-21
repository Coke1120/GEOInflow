import { z } from 'zod';
import { defineOperation } from '@/openapi/operation';
import {
  badRequestResponse,
  unauthorizedResponse,
  forbiddenResponse,
  notFoundResponse,
} from '@/openapi/schemas';
export const operations = [
  defineOperation({
    method: 'get',
    path: '/api/liekan/websites/{websiteId}/history-repair/export',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'exportLiekanHistoryRepair',
      summary: 'Export bounded repair records in the requested locale (full session required)',
      tags: ['Liekan'],
      requestParams: {
        path: z.object({ websiteId: z.uuid() }),
        query: z.object({
          generation: z.uuid(),
          locale: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
        }),
      },
      responses: {
        '200': {
          description: 'Repair CSV with no request agents or raw addresses',
          content: { 'text/csv': { schema: z.string() } },
        },
        '400': badRequestResponse,
        '401': unauthorizedResponse,
        '403': forbiddenResponse,
        '404': notFoundResponse,
        '409': {
          description: 'The approved scope, revision or generation changed; refresh the preview',
        },
        '501': { description: 'Historical repair requires PostgreSQL' },
        '503': { description: 'A compatible repair worker or installation is unavailable' },
      },
    },
  }),
] as const;
