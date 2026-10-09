import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
import { crawlerConnectionInputSchema } from '@/lib/liekan/contracts/crawlers';
import { crawlerControlInput } from '@/lib/liekan/crawler-control/service';
export const operations = [
  crawlerOperation(
    'get',
    '/api/liekan/websites/{websiteId}/control-connections',
    'getLiekanCrawlerConnections',
  ),
  crawlerOperation(
    'post',
    '/api/liekan/websites/{websiteId}/control-connections',
    'postLiekanCrawlerConnection',
    crawlerConnectionInputSchema,
  ),
  crawlerOperation(
    'patch',
    '/api/liekan/websites/{websiteId}/control-connections',
    'patchLiekanCrawlerControl',
    crawlerControlInput,
  ),
] as const;
