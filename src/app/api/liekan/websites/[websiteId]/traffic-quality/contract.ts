import { z } from 'zod';
import { defineOperation } from '@/openapi/operation';
import { trafficPolicySchema } from '@/lib/liekan/contracts/traffic-quality';
import {
  badRequestResponse,
  notFoundResponse,
  unauthorizedResponse,
  forbiddenResponse,
} from '@/openapi/schemas';

const responses = {
  '200': {
    description: 'Site traffic policy and bounded quality audit',
    content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } },
  },
  '400': badRequestResponse,
  '401': unauthorizedResponse,
  '403': forbiddenResponse,
  '404': notFoundResponse,
};
export const operations = [
  defineOperation({
    method: 'get',
    path: '/api/liekan/websites/{websiteId}/traffic-quality',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'getLiekanTrafficQuality',
      summary: 'Audit browser traffic quality',
      tags: ['Liekan'],
      requestParams: {
        path: z.object({ websiteId: z.uuid() }),
        query: z.object({
          startAt: z.coerce.number().int().optional(),
          endAt: z.coerce.number().int().optional(),
          classification: z.enum(['browser', 'automated', 'suspected', 'unknown']).optional(),
          page: z.coerce.number().int().min(1).max(10000).optional(),
        }),
      },
      responses,
    },
  }),
  defineOperation({
    method: 'put',
    path: '/api/liekan/websites/{websiteId}/traffic-quality',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'putLiekanTrafficQuality',
      summary: 'Set one site traffic policy',
      tags: ['Liekan'],
      requestParams: { path: z.object({ websiteId: z.uuid() }) },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: trafficPolicySchema } },
      },
      responses,
    },
  }),
] as const;
