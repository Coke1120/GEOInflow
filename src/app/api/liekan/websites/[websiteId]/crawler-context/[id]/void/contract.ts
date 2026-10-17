import {
  workflowResponseSchema,
  contextResponseSchema,
  contextCreateResponseSchema,
  contextVoidResponseSchema,
} from '@/lib/liekan/contracts/crawler-workflow';
import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
import { contextVoidSchema } from '@/lib/liekan/contracts/crawler-workflow';
export const operations = [
  crawlerOperation(
    'post',
    '/api/liekan/websites/{websiteId}/crawler-context/{id}/void',
    'voidLiekanCrawlerContext',
    contextVoidSchema,
    contextVoidResponseSchema,
  ),
] as const;
