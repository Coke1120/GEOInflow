import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
export const operations = [
  crawlerOperation(
    'get',
    '/api/liekan/websites/{websiteId}/crawler-deployments/{operationId}',
    'getLiekanCrawlerDeployment',
  ),
] as const;
