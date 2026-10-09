import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
import { crawlerPreviewInputSchema } from '@/lib/liekan/contracts/crawlers';
export const operations = [
  crawlerOperation(
    'post',
    '/api/liekan/websites/{websiteId}/crawler-policies/{policyId}/preview',
    'postLiekanCrawlerPreview',
    crawlerPreviewInputSchema,
  ),
] as const;
