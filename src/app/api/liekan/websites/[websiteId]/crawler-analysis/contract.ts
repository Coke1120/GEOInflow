import { z } from 'zod';
import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
import { crawlerCriticalPathsSchema } from '@/lib/liekan/crawlers/analysis';
export const operations = [
  crawlerOperation(
    'get',
    '/api/liekan/websites/{websiteId}/crawler-analysis',
    'getLiekanCrawlerAnalysis',
    undefined,
    undefined,
    z.object({
      startAt: z.coerce.number().int().nonnegative().optional(),
      endAt: z.coerce.number().int().nonnegative().optional(),
      timezone: z.string().optional(),
      crawlerIdentityScope: z.enum(['all', 'verified_range']).optional(),
    }),
  ),
  crawlerOperation(
    'patch',
    '/api/liekan/websites/{websiteId}/crawler-analysis',
    'patchLiekanCrawlerAnalysis',
    crawlerCriticalPathsSchema,
  ),
] as const;
