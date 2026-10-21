import { z } from 'zod';
import { defineOperation } from '@/openapi/operation';
import {
  badRequestResponse,
  unauthorizedResponse,
  forbiddenResponse,
  notFoundResponse,
} from '@/openapi/schemas';
import {
  historyRepairListSchema,
  historyRepairNoticeSchema,
  historyRepairNoticeResultSchema,
} from '@/lib/liekan/contracts/history-repair';
export const operations = [
  defineOperation({
    method: 'get',
    path: '/api/liekan/history-repair',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'listLiekanHistoryRepair',
      summary: 'List manageable sites for this upgrade campaign (full session required)',
      tags: ['Liekan'],
      requestParams: { query: z.object({ cursor: z.string().max(2048).optional() }) },
      responses: {
        '200': {
          description: 'Bounded site list and private notice state',
          content: { 'application/json': { schema: historyRepairListSchema } },
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
  defineOperation({
    method: 'put',
    path: '/api/liekan/history-repair',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'acknowledgeLiekanHistoryRepairNotice',
      summary: 'Dismiss an upgrade notice or mark results read',
      tags: ['Liekan'],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: historyRepairNoticeSchema } },
      },
      responses: {
        '200': {
          description: 'Private notice state',
          content: { 'application/json': { schema: historyRepairNoticeResultSchema } },
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
