import { z } from 'zod';
import { aiSavedContextSchema } from '@/lib/liekan/ai/api-contracts';
import { aiOperation } from '@/lib/liekan/ai/api-contracts';
export const operations = [
  aiOperation({
    method: 'get',
    path: '/api/liekan/ai/conversations/{id}/contexts/{contextId}',
    id: 'getLiekanAiContext',
    summary: '查看回答生成时的原范围和事实依据',
    params: z.object({ id: z.uuid(), contextId: z.uuid() }),
    response: z.object({
      protocolVersion: z.literal(1),
      id: z.uuid(),
      facts: aiSavedContextSchema,
      checksum: z.string(),
      createdAt: z.iso.datetime(),
      expiresAt: z.iso.datetime(),
    }),
  }),
] as const;
