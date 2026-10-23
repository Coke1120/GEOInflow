import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
import {
  geoWeightSnapshotQuerySchema,
  geoWeightSnapshotResponseSchema,
} from '@/lib/liekan/contracts/geo-weight';
const operation = crawlerOperation(
  'get',
  '/api/liekan/websites/{websiteId}/geo-weight/snapshot',
  'getLiekanGeoWeightSnapshot',
  undefined,
  geoWeightSnapshotResponseSchema,
  geoWeightSnapshotQuerySchema,
);
export const operations = [
  {
    ...operation,
    operation: {
      ...operation.operation,
      responses: {
        ...operation.operation.responses,
        '410': { description: 'Exact saved snapshot expired or evicted' },
      },
    },
  },
] as const;
