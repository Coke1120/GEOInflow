import { z } from 'zod';
import { crawlerOperation } from '@/lib/liekan/upstream/crawler-operation';
export const operations = [crawlerOperation('get', '/api/liekan/catalog-version', 'getLiekanCatalogVersion', undefined, z.object({ version: z.uuid().nullable() }))] as const;
