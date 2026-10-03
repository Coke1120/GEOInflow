import { z } from 'zod';
import {
  apiErrorSchema,
  badRequestResponse,
  defineOperation,
  notFoundResponse,
  unauthorizedResponse,
} from '@/lib/liekan/upstream/feature-api-contracts';
export const operations = [
  defineOperation({
    method: 'post',
    path: '/api/share/{slug}',
    audience: 'public',
    auth: 'none',
    operation: {
      operationId: 'verifySharePassword',
      summary: '验证公开分享密码并获取受限访问令牌',
      tags: ['Shares'],
      requestParams: { path: z.object({ slug: z.string().max(100) }) },
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: z.object({
              password: z.string().refine(p => new TextEncoder().encode(p).byteLength <= 72),
            }),
          },
        },
      },
      responses: {
        200: {
          description: '受当前分享范围限制的令牌',
          content: {
            'application/json': {
              schema: z.object({
                token: z.string(),
                name: z.string(),
                shareId: z.uuid(),
                shareType: z.number(),
                parameters: z.record(z.string(), z.unknown()),
                websiteId: z.uuid().optional(),
                pixelId: z.uuid().optional(),
                linkId: z.uuid().optional(),
                boardId: z.uuid().optional(),
                websiteIds: z.array(z.uuid()).optional(),
                pixelIds: z.array(z.uuid()).optional(),
                linkIds: z.array(z.uuid()).optional(),
              }),
            },
          },
        },
        400: badRequestResponse,
        401: unauthorizedResponse,
        404: notFoundResponse,
        413: {
          description: '分享密码请求内容超过 1 KiB。',
          content: { 'application/json': { schema: apiErrorSchema } },
        },
        429: {
          description: '分享密码验证次数或并发量达到上限，等待 Retry-After 后重试。',
          headers: { 'Retry-After': { description: '重试前等待的秒数', schema: z.string() } },
          content: { 'application/json': { schema: apiErrorSchema } },
        },
        503: {
          description: '共享验证保护暂时不可用，等待 Retry-After 后重试。',
          headers: { 'Retry-After': { description: '重试前等待的秒数', schema: z.string() } },
          content: { 'application/json': { schema: apiErrorSchema } },
        },
      },
    },
  }),
] as const;
