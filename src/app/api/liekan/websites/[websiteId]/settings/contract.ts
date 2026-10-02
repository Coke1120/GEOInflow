import { z } from 'zod';
import { defineOperation } from '@/openapi/operation';
import { badRequestResponse, notFoundResponse, unauthorizedResponse } from '@/openapi/schemas';
export const operations = [
  defineOperation({
    method: 'get',
    path: '/api/liekan/websites/{websiteId}/settings',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'getLiekanSettings',
      summary: 'get Liekan settings',
      tags: ['Liekan'],
      requestParams: { path: z.object({ websiteId: z.uuid() }) },
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
  defineOperation({
    method: 'put',
    path: '/api/liekan/websites/{websiteId}/settings',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'putLiekanSettings',
      summary: 'put Liekan settings',
      tags: ['Liekan'],
      requestParams: { path: z.object({ websiteId: z.uuid() }) },
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: z.object({
              robots: z.string().max(50000),
              allowlist: z.array(z.string().max(80)).max(100),
              rules: z
                .array(
                  z.object({
                    name: z.string().min(1).max(80),
                    vendor: z.string().min(1).max(80),
                    type: z.enum(['训练', '搜索', '用户触发', '传统搜索', '其他']),
                    pattern: z.string().min(1).max(80),
                  }),
                )
                .max(100),
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
