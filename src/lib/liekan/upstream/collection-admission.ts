import { normalizeCollectionHostname } from './collection-quality';

export interface CollectionAdmission {
  revision: string;
  mode: string;
  allowedHostnames: string[];
}
export function normalizeCollectionOrigin(value: string | null) {
  if (!value || value === 'null') return null;
  try {
    const origin = new URL(value);
    if (
      !['http:', 'https:'].includes(origin.protocol) ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash
    )
      return null;
    return normalizeCollectionHostname(origin.hostname);
  } catch {
    return null;
  }
}
export function conflictsWithCollectionHosts(
  policy: CollectionAdmission,
  hostname: string | null,
  originHostname: string | null,
) {
  return (
    policy.allowedHostnames.length > 0 &&
    (!hostname ||
      !policy.allowedHostnames.includes(hostname) ||
      (originHostname !== null && !policy.allowedHostnames.includes(originHostname)))
  );
}
export async function collectionAdmission(websiteId: string): Promise<CollectionAdmission> {
  const { default: prisma, getRawQueryClient, getSchema } = await import('@/lib/prisma');
  const schema = getSchema() || 'public';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema))
    throw new Error('Invalid collection database schema');
  const primary = getRawQueryClient(prisma.client, { write: true }) as any;
  return primary.$transaction(
    async (tx: any) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      const [row] = await tx.$queryRawUnsafe(
        'SELECT revision::text,mode,allowed_hostnames FROM liekan_collection_policy WHERE website_id=$1::uuid',
        websiteId,
      );
      return {
        revision: row?.revision ?? '0',
        mode: row?.mode ?? 'standard',
        allowedHostnames: row?.allowed_hostnames ?? [],
      };
    },
    { timeout: 10000, maxWait: 5000 },
  );
}
