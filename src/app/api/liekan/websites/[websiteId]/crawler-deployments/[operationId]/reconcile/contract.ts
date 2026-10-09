import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
import { crawlerReconcileInput } from '@/lib/liekan/crawler-control/deployments';
export const operations = [
  crawlerOperation(
    'post',
    '/api/liekan/websites/{websiteId}/crawler-deployments/{operationId}/reconcile',
    'postLiekanCrawlerDeploymentReconcile',
    crawlerReconcileInput,
  ),
] as const;
