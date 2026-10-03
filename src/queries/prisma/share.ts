import type { Prisma, Share } from '@/generated/prisma/client';
import prisma, { getRawQueryClient } from '@/lib/prisma';
import { secureShareParameters, safeManagedShare } from '@/lib/liekan/upstream/share-security';
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
  const previous = await getShare(shareId);
  return safeManagedShare(
    await prisma.client.share.update({
      where: {
        id: shareId,
      },
      data: {
        ...data,
        ...(data.parameters !== undefined
          ? { parameters: secureShareParameters(data.parameters, previous?.parameters) }
          : {}),
      },
    }),
  );
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
