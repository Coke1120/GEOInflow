import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
import { performanceQuerySchema } from '@/lib/liekan/contracts/traffic-evidence';
import { performanceResponseSchema } from '@/lib/liekan/contracts/traffic-evidence';
export const operations = [
  crawlerOperation(
    'get',
    '/api/liekan/websites/{websiteId}/crawler-analysis/performance',
    'getLiekanCrawlerPerformance',
    undefined,
    performanceResponseSchema,
    performanceQuerySchema,
  ),
] as const;
