import {
  workflowResponseSchema,
  contextResponseSchema,
  contextCreateResponseSchema,
  contextVoidResponseSchema,
} from '@/lib/liekan/contracts/crawler-workflow';
import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
import { contextWriteSchema, contextQuerySchema } from '@/lib/liekan/contracts/crawler-workflow';
export const operations = [
  crawlerOperation(
    'get',
    '/api/liekan/websites/{websiteId}/crawler-context',
    'getLiekanCrawlerContext',
    undefined,
    contextResponseSchema,
    contextQuerySchema,
  ),
  crawlerOperation(
    'post',
    '/api/liekan/websites/{websiteId}/crawler-context',
    'addLiekanCrawlerContext',
    contextWriteSchema,
    contextCreateResponseSchema,
  ),
] as const;
