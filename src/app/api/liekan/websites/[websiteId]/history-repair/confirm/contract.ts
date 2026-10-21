import { z } from 'zod';
import { defineOperation } from '@/openapi/operation';
import {
  badRequestResponse,
  unauthorizedResponse,
  forbiddenResponse,
  notFoundResponse,
} from '@/openapi/schemas';
import {
  historyRepairConfirmSchema,
  historyRepairRunSchema,
} from '@/lib/liekan/contracts/history-repair';
export const operations = [
  defineOperation({
    method: 'post',
    path: '/api/liekan/websites/{websiteId}/history-repair/confirm',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'postLiekanHistoryRepairConfirm',
      summary: 'Historical repair: confirm (full session and site management required)',
      tags: ['Liekan'],
      requestParams: { path: z.object({ websiteId: z.uuid() }) },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: historyRepairConfirmSchema } },
      },
      responses: {
        '200': {
          description: 'Repair state after the idempotent action',
          content: { 'application/json': { schema: historyRepairRunSchema } },
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
