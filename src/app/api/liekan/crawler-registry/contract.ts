import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
import { publishedCatalogSchema } from '@/lib/liekan/contracts/crawler-registry';

export const operations = [
  crawlerOperation(
    'get',
    '/api/liekan/crawler-registry',
    'getLiekanPublishedCrawlerRegistry',
    undefined,
    publishedCatalogSchema,
  ),
] as const;
