import type { Prisma, PrismaClient, Share } from '@/generated/prisma/client';
import { safeManagedShare, secureShareParameters } from '@/lib/liekan/upstream/share-security';
import prisma, { getRawQueryClient, getSchema } from '@/lib/prisma';
import type { PageResult, QueryFilters } from '@/lib/types';

export async function findShare(criteria: Prisma.ShareFindUniqueArgs) {
  const primary = getRawQueryClient(prisma.client, { write: true }) as typeof prisma.client;
  return primary.share.findUnique(criteria);
}

export async function getShare(shareId: string) {
  return findShare({
    where: {
      id: shareId,
    },
  });
}

export async function getShareByCode(slug: string) {
  return findShare({
    where: {
      slug,
    },
  });
}

export async function getShareByEntityId(entityId: string) {
  return prisma.client.share.findFirst({
    where: {
      entityId,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
}

export async function getSharesByEntityId(
  entityId: string,
  filters?: QueryFilters,
): Promise<PageResult<Share[]>> {
  const { pagedQuery } = prisma;

  const result = await pagedQuery(
    'share',
    {
      where: {
        entityId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    },
    filters,
  );
  return { ...result, data: result.data.map(safeManagedShare) };
}

export async function createShare(
  data: Prisma.ShareCreateInput | Prisma.ShareUncheckedCreateInput,
) {
  return safeManagedShare(
    await prisma.client.share.create({
      data: { ...data, parameters: secureShareParameters(data.parameters) },
    }),
  );
}

export async function updateShare(
  shareId: string,
  data: Prisma.ShareUpdateInput | Prisma.ShareUncheckedUpdateInput,
) {
  const primary = getRawQueryClient(prisma.client, { write: true }) as PrismaClient;
  if (data.parameters === undefined) {
    return safeManagedShare(await primary.share.update({ where: { id: shareId }, data }));
  }
  return primary.$transaction(async tx => {
    const schema = getSchema();
    const table = schema ? `"${schema.replaceAll('"', '""')}"."share"` : '"share"';
    // Serialize secret-preserving edits with password rotation and removal.
    await tx.$queryRawUnsafe(
      `SELECT share_id FROM ${table} WHERE share_id = $1::uuid FOR UPDATE`,
      shareId,
    );
    const previous = await tx.share.findUnique({ where: { id: shareId } });
    return safeManagedShare(
      await tx.share.update({
        where: { id: shareId },
        data: { ...data, parameters: secureShareParameters(data.parameters, previous?.parameters) },
      }),
    );
  });
}

export async function deleteShare(shareId: string) {
  return prisma.client.share.delete({ where: { id: shareId } });
}

export async function deleteSharesByEntityId(entityId: string) {
  return prisma.client.share.deleteMany({
    where: {
      entityId,
    },
  });
}
