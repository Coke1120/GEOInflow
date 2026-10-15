import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
import { crawlerRecognitionResponseSchema } from '@/lib/liekan/contracts/crawler-maintenance';
export const operations = [
  crawlerOperation(
    'get',
    '/api/liekan/websites/{websiteId}/crawler-recognition',
    'getLiekanCrawlerRecognition',
    undefined,
    crawlerRecognitionResponseSchema,
  ),
] as const;
