import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
import {
  crawlerRegistryCommandSchema,
  crawlerRegistryCommandResponseSchema,
  crawlerRegistryResponseSchema,
} from '@/lib/liekan/contracts/crawler-registry';

export const operations = [
  crawlerOperation(
    'get',
    '/api/liekan/admin/crawler-registry',
    'getLiekanCrawlerRegistryAdmin',
    undefined,
    crawlerRegistryResponseSchema,
  ),
  crawlerOperation(
    'post',
    '/api/liekan/admin/crawler-registry',
    'mutateLiekanCrawlerRegistry',
    crawlerRegistryCommandSchema,
    crawlerRegistryCommandResponseSchema,
  ),
] as const;
