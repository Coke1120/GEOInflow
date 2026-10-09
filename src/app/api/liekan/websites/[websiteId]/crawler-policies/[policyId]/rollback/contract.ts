import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
import { crawlerConfirmInputSchema } from '@/lib/liekan/contracts/crawlers';
export const operations = [
  crawlerOperation(
    'post',
    '/api/liekan/websites/{websiteId}/crawler-policies/{policyId}/rollback',
    'postLiekanCrawlerRollback',
    crawlerConfirmInputSchema,
  ),
] as const;
