import { z } from 'zod';
import { defineOperation } from '@/openapi/operation';
import {
  trafficGovernanceSchema,
  trafficExclusionActionSchema,
  trafficExclusionResultSchema,
} from '@/lib/liekan/contracts/traffic-exclusions';
import {
  badRequestResponse,
  notFoundResponse,
  unauthorizedResponse,
  forbiddenResponse,
} from '@/openapi/schemas';
export const operations = [
  defineOperation({
    method: 'get',
    path: '/api/liekan/websites/{websiteId}/traffic-quality/exclusions',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'getLiekanTrafficExclusions',
      summary: 'Read a stable page of confirmed traffic exclusions',
      tags: ['Liekan'],
      requestParams: {
        path: z.object({ websiteId: z.uuid() }),
        query: z.object({ cursor: z.string().max(1024).optional() }),
      },
      responses: {
        '200': {
          description: 'Traffic governance page',
          content: { 'application/json': { schema: trafficGovernanceSchema } },
        },
        '400': badRequestResponse,
        '401': unauthorizedResponse,
        '403': forbiddenResponse,
        '404': notFoundResponse,
        '409': { description: 'Governance changed; restart pagination' },
      },
    },
  }),
  defineOperation({
    method: 'post',
    path: '/api/liekan/websites/{websiteId}/traffic-quality/exclusions',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'manageLiekanTrafficExclusions',
      summary: 'Preview, confirm or revoke a bounded traffic exclusion',
      tags: ['Liekan'],
      requestParams: { path: z.object({ websiteId: z.uuid() }) },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: trafficExclusionActionSchema } },
      },
      responses: {
        '200': {
          description: 'Traffic governance result',
          content: { 'application/json': { schema: trafficExclusionResultSchema } },
        },
        '400': badRequestResponse,
        '401': unauthorizedResponse,
        '403': forbiddenResponse,
        '404': notFoundResponse,
        '409': { description: 'Stale preview or changed authority' },
        '413': { description: 'Window budget exceeded' },
        '501': { description: 'Unsupported analytics backend' },
      },
    },
  }),
] as const;
