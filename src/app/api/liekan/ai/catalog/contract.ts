import { aiOperation, aiCatalogSchema } from '@/lib/liekan/ai/api-contracts';
export const operations = [
  aiOperation({
    method: 'get',
    path: '/api/liekan/ai/catalog',
    id: 'getLiekanAiCatalog',
    summary: '获取 AI 模块状态、模型模板与可访问网站',
    response: aiCatalogSchema,
  }),
] as const;
