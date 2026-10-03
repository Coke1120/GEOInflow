import { z } from 'zod';
import { analysisQuery } from '@/lib/liekan/contracts/analysis';
import { featureAnalyticsResponse } from '@/lib/liekan/contracts/feature-responses';
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
    path: '/api/liekan/websites/{websiteId}/analytics',
    audience: 'public',
    auth: 'bearer',
    operation: {
      operationId: 'getLiekanFeatureAnalytics',
      summary: '查询 Liekan 明细统计',
      tags: ['Liekan'],
      requestParams: { path: z.object({ websiteId: z.uuid() }), query: analysisQuery },
      responses: {
        200: {
          description: '按 kind 返回实际统计结果',
          content: { 'application/json': { schema: featureAnalyticsResponse } },
        },
        400: badRequestResponse,
        401: unauthorizedResponse,
        403: {
          description: '无权访问资源',
          content: { 'application/json': { schema: apiErrorSchema } },
        },
        404: notFoundResponse,
        501: {
          description: '当前数据引擎暂不支持此补充统计',
          content: { 'application/json': { schema: apiErrorSchema } },
        },
      },
    },
  }),
] as const;
