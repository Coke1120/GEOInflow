import { z } from 'zod';
import { aiOperation } from '@/lib/liekan/ai/api-contracts';
import { updateAiConnectionSchema, aiConnectionPublicSchema } from '@/lib/liekan/ai/contracts';
const ids = z.object({ id: z.uuid() });
export const operations = [
  aiOperation({
    method: 'patch',
    path: '/api/liekan/ai/connections/{id}',
    id: 'updateLiekanAiConnection',
    summary: '版本化编辑 API、启停和默认连接',
    params: ids,
    body: updateAiConnectionSchema,
    response: aiConnectionPublicSchema,
  }),
  aiOperation({
    method: 'delete',
    path: '/api/liekan/ai/connections/{id}',
    id: 'deleteLiekanAiConnection',
    summary: '删除 API 配置并撤销相关任务',
    params: ids,
    body: z.object({ rowVersion: z.number().int().positive() }),
    response: z.object({ deleted: z.literal(true) }),
  }),
] as const;
