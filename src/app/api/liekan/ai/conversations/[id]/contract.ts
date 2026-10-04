import { z } from 'zod';
import { aiOperation, aiConversationPublicSchema } from '@/lib/liekan/ai/api-contracts';
const ids = z.object({ id: z.uuid() });
export const operations = [
  aiOperation({
    method: 'get',
    path: '/api/liekan/ai/conversations/{id}',
    id: 'getLiekanAiConversation',
    summary: '读取本人对话元数据',
    params: ids,
    response: aiConversationPublicSchema,
  }),
  aiOperation({
    method: 'delete',
    path: '/api/liekan/ai/conversations/{id}',
    id: 'deleteLiekanAiConversation',
    summary: '删除本人对话、依据及可回查内容',
    params: ids,
    response: z.object({ deleted: z.literal(true) }),
  }),
] as const;
