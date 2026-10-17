import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
import {
  reconciliationQuerySchema,
  reconciliationResponseSchema,
} from '@/lib/liekan/contracts/traffic-evidence';
export const operations = [
  crawlerOperation(
    'get',
    '/api/liekan/websites/{websiteId}/traffic-quality/reconciliation',
    'getLiekanTrafficReconciliation',
    undefined,
    reconciliationResponseSchema,
    reconciliationQuerySchema,
  ),
] as const;
