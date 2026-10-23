import { z } from 'zod';

export const cacheResourceSchema = z.strictObject({
  type: z.enum(['website', 'link', 'pixel', 'board']),
  id: z.uuid().overwrite(id => id.toLowerCase()),
});
export type CacheResource = z.infer<typeof cacheResourceSchema>;
export const cacheManifestQuerySchema = z.strictObject({
  resources: z.string().max(4096),
});
export const cacheManifestResourcesSchema = z.array(cacheResourceSchema).max(20);
export const cacheManifestResponseSchema = z.object({
  userId: z.uuid(),
  instanceId: z.uuid(),
  serverTime: z.number().int().nonnegative(),
  resources: z.array(
    z.union([
      cacheResourceSchema.extend({ authorized: z.literal(false) }),
      cacheResourceSchema.extend({
        authorized: z.literal(true),
        strongVersion: z.string(),
        dataRevision: z.string(),
        geoVersion: z.string().nullable(),
        geoSnapshotVersion: z.string().nullable().optional(),
      }),
    ]),
  ),
});
export type CacheManifestResponse = z.infer<typeof cacheManifestResponseSchema>;
