import { crawlerExportInputSchema } from '@/lib/liekan/crawler-control/exports';
import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
export const operations = [
  crawlerOperation(
    'post',
    '/api/liekan/websites/{websiteId}/crawler-exports',
    'postLiekanCrawlerExport',
    crawlerExportInputSchema,
  ),
] as const;
