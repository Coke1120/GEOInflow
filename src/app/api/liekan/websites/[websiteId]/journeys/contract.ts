import { z } from 'zod';
import { journeyQuery } from '@/lib/liekan/contracts/analysis';
import { journeyResponse } from '@/lib/liekan/contracts/feature-responses';
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
    path: '/api/liekan/websites/{websiteId}/journeys',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'getLiekanJourneys',
      summary: '查询 Liekan 访问旅程',
      tags: ['Liekan'],
      requestParams: { path: z.object({ websiteId: z.uuid() }), query: journeyQuery },
      responses: {
        200: {
          description: '实际路径与访客统计',
          content: { 'application/json': { schema: journeyResponse } },
        },
        400: badRequestResponse,
        401: unauthorizedResponse,
        403: {
          description: '无权访问资源',
          content: { 'application/json': { schema: apiErrorSchema } },
        },
        404: notFoundResponse,
        501: {
          description: '当前数据引擎暂不支持',
          content: { 'application/json': { schema: apiErrorSchema } },
        },
      },
    },
  }),
] as const;
