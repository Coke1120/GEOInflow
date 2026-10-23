import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
import {
  cacheManifestQuerySchema,
  cacheManifestResponseSchema,
} from '@/lib/liekan/contracts/cache-manifest';

export const operations = [
  crawlerOperation(
    'get',
    '/api/liekan/cache-manifest',
    'getLiekanCacheManifest',
    undefined,
    cacheManifestResponseSchema,
    cacheManifestQuerySchema,
  ),
] as const;
