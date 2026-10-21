import { z } from 'zod';
import { defineOperation } from '@/openapi/operation';
import {
  badRequestResponse,
  unauthorizedResponse,
  forbiddenResponse,
  notFoundResponse,
} from '@/openapi/schemas';
import {
  historyRepairQuerySchema,
  historyRepairDetailSchema,
} from '@/lib/liekan/contracts/history-repair';
export const operations = [
  defineOperation({
    method: 'get',
    path: '/api/liekan/websites/{websiteId}/history-repair',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'getLiekanHistoryRepair',
      summary: 'Read historical repair state and bounded records (full session required)',
      tags: ['Liekan'],
      requestParams: { path: z.object({ websiteId: z.uuid() }), query: historyRepairQuerySchema },
      responses: {
        '200': {
          description: 'Authorized website repair state',
          content: { 'application/json': { schema: historyRepairDetailSchema } },
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
