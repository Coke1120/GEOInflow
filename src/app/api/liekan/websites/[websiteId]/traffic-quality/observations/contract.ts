import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
import { observationQuerySchema } from '@/lib/liekan/contracts/traffic-evidence';
import { observationsResponseSchema } from '@/lib/liekan/contracts/traffic-evidence';
export const operations = [
  crawlerOperation(
    'get',
    '/api/liekan/websites/{websiteId}/traffic-quality/observations',
    'getLiekanTrafficObservations',
    undefined,
    observationsResponseSchema,
    observationQuerySchema,
  ),
] as const;
