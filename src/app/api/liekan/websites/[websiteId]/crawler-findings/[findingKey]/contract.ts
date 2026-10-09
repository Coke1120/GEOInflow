import { z } from 'zod';
import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
export const operations = [
  crawlerOperation(
    'patch',
    '/api/liekan/websites/{websiteId}/crawler-findings/{findingKey}',
    'patchLiekanCrawlerFinding',
    z.strictObject({ ignored: z.boolean() }),
    z.object({ key: z.string(), state: z.enum(['active', 'ignored']) }),
  ),
] as const;
