import { z } from 'zod';
import {
  aiOperation,
  aiConversationPublicSchema,
  aiListSchema,
} from '@/lib/liekan/ai/api-contracts';
export const operations = [
  aiOperation({
    method: 'get',
    path: '/api/liekan/ai/conversations',
    id: 'getLiekanAiConversations',
    summary: '读取本人当前网站对话列表',
    query: z.object({
      websiteId: z.uuid(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(50).optional(),
    }),
    response: aiListSchema(aiConversationPublicSchema),
  }),
  aiOperation({
    method: 'post',
    path: '/api/liekan/ai/conversations',
    id: 'createLiekanAiConversation',
    summary: '新建绑定明确网站的本人对话',
    body: z.object({ websiteId: z.uuid() }),
    response: aiConversationPublicSchema,
  }),
] as const;
