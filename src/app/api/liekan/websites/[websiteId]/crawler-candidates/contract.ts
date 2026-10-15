import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
import { crawlerCandidatesResponseSchema } from '@/lib/liekan/contracts/crawler-maintenance';
export const operations = [
  crawlerOperation(
    'get',
    '/api/liekan/websites/{websiteId}/crawler-candidates',
    'getLiekanCrawlerCandidates',
    undefined,
    crawlerCandidatesResponseSchema,
  ),
] as const;
