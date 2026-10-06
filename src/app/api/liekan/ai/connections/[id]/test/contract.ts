import { z } from 'zod';
import { aiOperation, aiRunResponseSchema } from '@/lib/liekan/ai/api-contracts';
const ids = z.object({ id: z.uuid() });
export const operations = [
  aiOperation({
    method: 'post',
    path: '/api/liekan/ai/connections/{id}/test',
    id: 'testLiekanAiConnection',
    summary: '实时测试当前 API 配置',
    params: ids,
    body: z.object({
      clientRequestId: z.uuid(),
      expectedConfigVersion: z.number().int().positive(),
    }),
    response: aiRunResponseSchema,
    stream: true,
  }),
] as const;
