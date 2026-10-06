import { z } from 'zod';
import { aiOperation, aiRunResponseSchema } from '@/lib/liekan/ai/api-contracts';
const ids = z.object({ id: z.uuid() });
export const operations = [
  aiOperation({
    method: 'post',
    path: '/api/liekan/ai/runs/{id}/cancel',
    id: 'cancelLiekanAiRun',
    summary: '停止本人正在执行的 AI 任务',
    params: ids,
    response: aiRunResponseSchema,
  }),
] as const;
