import {
  workflowResponseSchema,
  contextResponseSchema,
  contextCreateResponseSchema,
  contextVoidResponseSchema,
} from '@/lib/liekan/contracts/crawler-workflow';
import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
import { workflowWriteSchema } from '@/lib/liekan/contracts/crawler-workflow';
export const operations = [
  crawlerOperation(
    'patch',
    '/api/liekan/websites/{websiteId}/crawler-findings/{findingKey}/workflow',
    'changeLiekanCrawlerWorkflow',
    workflowWriteSchema,
    workflowResponseSchema,
  ),
] as const;
