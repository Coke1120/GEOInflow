import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
import { crawlerPolicyCreateSchema } from '@/lib/liekan/contracts/crawlers';
export const operations = [
  crawlerOperation(
    'get',
    '/api/liekan/websites/{websiteId}/crawler-policies',
    'getLiekanCrawlerPolicies',
  ),
  crawlerOperation(
    'post',
    '/api/liekan/websites/{websiteId}/crawler-policies',
    'postLiekanCrawlerPolicies',
    crawlerPolicyCreateSchema,
  ),
] as const;
