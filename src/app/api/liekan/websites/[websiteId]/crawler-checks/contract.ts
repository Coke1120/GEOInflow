import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
import { crawlerCheckInput } from '@/lib/liekan/crawler-control/diagnostics';
export const operations = [
  crawlerOperation(
    'get',
    '/api/liekan/websites/{websiteId}/crawler-checks',
    'getLiekanCrawlerChecks',
    undefined,
  ),
  crawlerOperation(
    'post',
    '/api/liekan/websites/{websiteId}/crawler-checks',
    'postLiekanCrawlerChecks',
    crawlerCheckInput,
  ),
] as const;
