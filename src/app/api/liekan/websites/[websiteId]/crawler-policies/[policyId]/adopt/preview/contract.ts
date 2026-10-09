import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
import { crawlerAdoptPreviewInput } from '@/lib/liekan/crawler-control/deployments';
export const operations = [
  crawlerOperation(
    'post',
    '/api/liekan/websites/{websiteId}/crawler-policies/{policyId}/adopt/preview',
    'postLiekanCrawlerAdoptPreview',
    crawlerAdoptPreviewInput,
  ),
] as const;
