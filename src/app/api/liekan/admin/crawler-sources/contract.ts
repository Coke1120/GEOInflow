import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
import { crawlerSourcesResponseSchema } from '@/lib/liekan/contracts/crawler-maintenance';
export const operations = [
  crawlerOperation(
    'get',
    '/api/liekan/admin/crawler-sources',
    'getLiekanCrawlerSources',
    undefined,
    crawlerSourcesResponseSchema,
  ),
] as const;
