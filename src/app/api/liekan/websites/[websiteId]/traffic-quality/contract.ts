import { z } from 'zod';
import { defineOperation } from '@/openapi/operation';
import {
  trafficPolicySchema,
  savedTrafficPolicySchema,
  trafficAuditSchema,
  qualityRangeSchema,
} from '@/lib/liekan/contracts/traffic-quality';
import {
  badRequestResponse,
  notFoundResponse,
  unauthorizedResponse,
  forbiddenResponse,
} from '@/openapi/schemas';

const responses = {
  '200': {
    description: 'Site traffic policy and bounded quality audit',
    content: { 'application/json': { schema: trafficAuditSchema } },
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
        query: qualityRangeSchema,
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
      responses: {
        ...responses,
        '200': {
          description: 'Saved site policy',
          content: { 'application/json': { schema: savedTrafficPolicySchema } },
        },
        '409': { description: 'Policy revision conflict' },
        '501': { description: 'Unsupported analytics backend' },
      },
    },
  }),
] as const;
