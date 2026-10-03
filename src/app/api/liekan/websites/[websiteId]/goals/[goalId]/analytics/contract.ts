import { z } from 'zod';
import { analysisQuery } from '@/lib/liekan/contracts/analysis';
import { goalAnalyticsResponse } from '@/lib/liekan/contracts/feature-responses';
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
    path: '/api/liekan/websites/{websiteId}/goals/{goalId}/analytics',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'getLiekanGoalAnalytics',
      summary: '查询实际目标转化次数与趋势',
      tags: ['Liekan'],
      requestParams: {
        path: z.object({ websiteId: z.uuid(), goalId: z.uuid() }),
        query: analysisQuery,
      },
      responses: {
        200: {
          description: '转化次数、独立访客、基数与完整时间桶',
          content: { 'application/json': { schema: goalAnalyticsResponse } },
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
