import { z } from 'zod';
import { aiOperation, aiConnectionListSchema } from '@/lib/liekan/ai/api-contracts';
import { createAiConnectionSchema, aiConnectionPublicSchema } from '@/lib/liekan/ai/contracts';
export const operations = [
  aiOperation({
    method: 'get',
    path: '/api/liekan/ai/connections',
    id: 'getLiekanAiConnections',
    summary: '获取当前空间已配置 API 列表',
    query: z.object({ spaceKind: z.enum(['personal', 'team']), spaceId: z.uuid() }),
    response: aiConnectionListSchema,
  }),
  aiOperation({
    method: 'post',
    path: '/api/liekan/ai/connections',
    id: 'createLiekanAiConnection',
    summary: '新建加密 API 配置',
    body: createAiConnectionSchema,
    response: aiConnectionPublicSchema,
  }),
] as const;
