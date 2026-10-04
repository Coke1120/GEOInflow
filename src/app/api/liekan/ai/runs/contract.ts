import { z } from 'zod';
import { aiOperation, aiRunResponseSchema } from '@/lib/liekan/ai/api-contracts';
export const operations = [
  aiOperation({
    method: 'get',
    path: '/api/liekan/ai/runs',
    id: 'findLiekanAiRun',
    summary: '按本人请求标识恢复任务',
    query: z.object({ clientRequestId: z.uuid() }),
    response: aiRunResponseSchema,
  }),
] as const;
