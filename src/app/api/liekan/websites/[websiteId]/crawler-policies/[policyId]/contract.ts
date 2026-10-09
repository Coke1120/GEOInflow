import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
import { crawlerPolicyUpdateSchema } from '@/lib/liekan/contracts/crawlers';
export const operations = [
  crawlerOperation(
    'get',
    '/api/liekan/websites/{websiteId}/crawler-policies/{policyId}',
    'getLiekanCrawlerPolicy',
  ),
  crawlerOperation(
    'patch',
    '/api/liekan/websites/{websiteId}/crawler-policies/{policyId}',
    'patchLiekanCrawlerPolicy',
    crawlerPolicyUpdateSchema,
  ),
] as const;
