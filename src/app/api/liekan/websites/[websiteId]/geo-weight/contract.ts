import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
import { geoWeightQuerySchema, geoWeightResponseSchema } from '@/lib/liekan/contracts/geo-weight';
export const operations = [
  crawlerOperation(
    'get',
    '/api/liekan/websites/{websiteId}/geo-weight',
    'getLiekanGeoWeight',
    undefined,
    geoWeightResponseSchema,
    geoWeightQuerySchema,
  ),
] as const;
