import { z } from 'zod';
import { aiOperation, aiListSchema, aiRunResponseSchema } from '@/lib/liekan/ai/api-contracts';
import { aiConversationPostSchema } from '@/lib/liekan/ai/contracts';
const params = z.object({ id: z.uuid() });
export const operations = [
  aiOperation({
    method: 'get',
    path: '/api/liekan/ai/conversations/{id}/messages',
    id: 'getLiekanAiMessages',
    summary: '获取本人当前仍有权限的私有对话记录',
    params,
    query: z.object({
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(50).optional(),
    }),
    response: aiListSchema(
      z.object({
        id: z.uuid(),
        runId: z.uuid().nullable(),
        contextId: z.uuid().nullable(),
        question: z.string(),
        result: z.unknown().nullable(),
        origin: z.enum(['local', 'provider']),
        state: z.string().nullable(),
        createdAt: z.iso.datetime(),
        expiresAt: z.iso.datetime(),
      }),
    ),
  }),
  aiOperation({
    method: 'post',
    path: '/api/liekan/ai/conversations/{id}/messages',
    id: 'postLiekanAiAnalysis',
    summary: '发起单次只读 AI 网站数据分析',
    params,
    body: aiConversationPostSchema,
    response: aiRunResponseSchema,
    stream: true,
  }),
];
