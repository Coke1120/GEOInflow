import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
import { crawlerHandoffReconcileInput } from '@/lib/liekan/crawler-control/deployments';
export const operations = [
  crawlerOperation(
    'post',
    '/api/liekan/crawler-handoffs/reconcile',
    'postLiekanCrawlerHandoffReconcile',
    crawlerHandoffReconcileInput,
  ),
] as const;
