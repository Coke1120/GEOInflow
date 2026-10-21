import { z } from 'zod';
import { defineOperation } from '@/openapi/operation';
import {
  browserRiskReportSchema,
  browserRiskRangeSchema,
} from '@/lib/liekan/contracts/traffic-quality';
import {
  badRequestResponse,
  notFoundResponse,
  unauthorizedResponse,
  forbiddenResponse,
} from '@/openapi/schemas';
export const operations = [
  defineOperation({
    method: 'get',
    path: '/api/liekan/websites/{websiteId}/traffic-quality/risk',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'getLiekanBrowserRisk',
      summary: 'Read browser behavior observations',
      tags: ['Liekan'],
      requestParams: { path: z.object({ websiteId: z.uuid() }), query: browserRiskRangeSchema },
      responses: {
        '200': {
          description: 'Quality analysis',
          content: { 'application/json': { schema: browserRiskReportSchema } },
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
