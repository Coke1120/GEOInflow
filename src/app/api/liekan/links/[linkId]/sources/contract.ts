import { z } from 'zod';
import {
  resourceSourcesQuery,
  resourceSourcesResponse,
} from '@/lib/liekan/contracts/resource-sources';
import {
  defineOperation,
  badRequestResponse,
  unauthorizedResponse,
  notFoundResponse,
  apiErrorSchema,
} from '@/lib/liekan/upstream/feature-api-contracts';
export const operations = [
  defineOperation({
    method: 'get',
    path: '/api/liekan/links/{linkId}/sources',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'getLiekanLinkSources',
      summary: '查询链接来源与地域的真实点击次数',
      tags: ['Liekan'],
      requestParams: { path: z.object({ linkId: z.uuid() }), query: resourceSourcesQuery },
      responses: {
        200: {
          description: '按来源和地域联合聚合并分页',
          content: { 'application/json': { schema: resourceSourcesResponse } },
        },
        400: badRequestResponse,
        401: unauthorizedResponse,
        403: {
          description: '无权访问资源',
          content: { 'application/json': { schema: apiErrorSchema } },
        },
        404: notFoundResponse,
      },
    },
  }),
] as const;
