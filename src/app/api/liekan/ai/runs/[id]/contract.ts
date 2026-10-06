import { z } from 'zod';
import { aiOperation, aiRunResponseSchema } from '@/lib/liekan/ai/api-contracts';
const ids = z.object({ id: z.uuid() });
export const operations = [
  aiOperation({
    method: 'get',
    path: '/api/liekan/ai/runs/{id}',
    id: 'getLiekanAiRun',
    summary: '读取本人任务状态和已保存结果',
    params: ids,
    response: aiRunResponseSchema,
  }),
] as const;
