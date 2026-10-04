import { Prisma } from '@/generated/prisma/client';
import { ROLES } from '@/lib/constants';
import { getRandomChars } from '@/lib/generate';
import prisma from '@/lib/prisma';
import redis from '@/lib/redis';
import { invalidateAiActorRunsInTransaction } from '@/lib/liekan/upstream/ai-lifecycle';
import { sanitizeSortFilters } from '@/lib/sort';
import type { PageResult, QueryFilters, Role } from '@/lib/types';

import UserFindManyArgs = Prisma.UserFindManyArgs;

const USER_SORT_FIELDS = ['username', 'role', 'createdAt'] as const;

export interface GetUserOptions {
  includePassword?: boolean;
  showDeleted?: boolean;
}

export interface UserSummary {
  id: string;
  username: string;
  role: string;
  createdAt: Date;
  twoFactorRequired: boolean;
  _count?: {
    websites: number;
  };
}

async function findUser(criteria: Prisma.UserFindUniqueArgs, options: GetUserOptions = {}) {
  const { includePassword = false, showDeleted = false } = options;

  return prisma.client.user.findUnique({
    ...criteria,
    where: {
      ...criteria.where,
      ...(showDeleted ? {} : { deletedAt: null }),
    },
    select: {
      id: true,
      username: true,
      password: includePassword,
      role: true,
      createdAt: true,
      twoFactorRequired: true,
    },
  });
}

export async function getUser(userId: string, options: GetUserOptions = {}) {
  return findUser(
    {
      where: {
        id: userId,
      },
    },
    options,
  );
}

export async function getUserByUsername(username: string, options: GetUserOptions = {}) {
  return findUser({ where: { username: username.toLowerCase() } }, options);
}

export async function getUsers(
  criteria: UserFindManyArgs,
  filters: QueryFilters = {},
): Promise<PageResult<UserSummary[]>> {
  const sortFilters = sanitizeSortFilters(filters, USER_SORT_FIELDS, {
    orderBy: 'createdAt',
    sortDescending: true,
  });
  const { search } = sortFilters;

  const where: Prisma.UserWhereInput = {
    ...criteria.where,
    ...prisma.getSearchParameters(search, [{ username: 'contains' }]),
    deletedAt: null,
  };

  return prisma.pagedQuery(
    'user',
    {
      ...criteria,
      where,
    },
    sortFilters,
  );
}

export async function createUser(data: {
  id: string;
  username: string;
  password: string;
  role: Role;
}) {
  return prisma.client.user.create({
    data,
    select: {
      id: true,
      username: true,
      role: true,
    },
  });
}

export async function updateUser(userId: string, data: Prisma.UserUpdateInput) {
  return prisma.transaction(async tx => {
    const result = await tx.user.update({
      where: {
        id: userId,
      },
      data,
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true,
      },
    });
    if (data.role !== undefined) await invalidateAiActorRunsInTransaction(tx, userId);
    return result;
  });
}

export async function deleteUser(userId: string) {
  const { client, transaction } = prisma;
  const cloudMode = !!process.env.CLOUD_MODE;

  const websites = await client.website.findMany({
    where: { userId },
  });

  let websiteIds = [];

  if (websites.length > 0) {
    websiteIds = websites.map(a => a.id);
  }

  const teams = await client.team.findMany({
    where: {
      members: {
        some: {
          userId,
          role: ROLES.teamOwner,
        },
      },
    },
  });

  const teamIds = teams.map(a => a.id);

  const ownedFilter = cloudMode ? { userId } : { OR: [{ userId }, { teamId: { in: teamIds } }] };

  const [links, pixels, boards] = await Promise.all([
    client.link.findMany({
      where: ownedFilter,
      select: { id: true, slug: true, deletedAt: true },
    }),
    client.pixel.findMany({
      where: ownedFilter,
      select: { id: true, slug: true, deletedAt: true },
    }),
    client.board.findMany({ where: ownedFilter, select: { id: true } }),
  ]);
  const entityIds = [...links.map(l => l.id), ...pixels.map(p => p.id), ...boards.map(b => b.id)];
  // Only invalidate Redis cache for slugs that are still live (not already soft-deleted).
  const linkSlugs = links.filter(l => !l.deletedAt).map(l => l.slug);
  const pixelSlugs = pixels.filter(p => !p.deletedAt).map(p => p.slug);

  const invalidateRedis = async () => {
    if (redis.enabled && (linkSlugs.length || pixelSlugs.length)) {
      await Promise.all([
        ...linkSlugs.map(slug => redis.client.del(`link:${slug}`)),
        ...pixelSlugs.map(slug => redis.client.del(`pixel:${slug}`)),
      ]);
    }
  };

  if (cloudMode) {
    return transaction(async tx => {
      await (await import('@/lib/liekan/upstream/ai-lifecycle')).clearAiUserInTransaction(
        tx,
        userId,
        !cloudMode,
      );
      return [
        await tx.website.updateMany({
          data: {
            deletedAt: new Date(),
          },
          where: { id: { in: websiteIds } },
        }),
        await tx.user.update({
          data: {
            username: getRandomChars(32),
            deletedAt: new Date(),
          },
          where: {
            id: userId,
          },
        }),
        await tx.share.deleteMany({ where: { entityId: { in: entityIds } } }),
        await tx.link.updateMany({
          data: { deletedAt: new Date() },
          where: { userId, deletedAt: null },
        }),
        await tx.pixel.updateMany({
          data: { deletedAt: new Date() },
          where: { userId, deletedAt: null },
        }),
        await tx.board.deleteMany({ where: { userId } }),
      ];
    }).then(async result => {
      await invalidateRedis();
      return result;
    });
  }

  return transaction(async tx => {
    await (await import('@/lib/liekan/upstream/ai-lifecycle')).clearAiUserInTransaction(
      tx,
      userId,
      !cloudMode,
    );
    return [
      await tx.eventData.deleteMany({
        where: { websiteId: { in: websiteIds } },
      }),
      await tx.sessionData.deleteMany({
        where: { websiteId: { in: websiteIds } },
      }),
      await tx.websiteEvent.deleteMany({
        where: { websiteId: { in: websiteIds } },
      }),
      await tx.session.deleteMany({
        where: { websiteId: { in: websiteIds } },
      }),
      await tx.teamUser.deleteMany({
        where: {
          OR: [
            {
              teamId: {
                in: teamIds,
              },
            },
            {
              userId,
            },
          ],
        },
      }),
      await tx.team.deleteMany({
        where: {
          id: {
            in: teamIds,
          },
        },
      }),
      await tx.report.deleteMany({
        where: {
          OR: [
            {
              websiteId: {
                in: websiteIds,
              },
            },
            {
              userId,
            },
          ],
        },
      }),
      await tx.share.deleteMany({ where: { entityId: { in: entityIds } } }),
      await tx.link.deleteMany({ where: ownedFilter }),
      await tx.pixel.deleteMany({ where: ownedFilter }),
      await tx.board.deleteMany({ where: ownedFilter }),
      await tx.website.deleteMany({
        where: { id: { in: websiteIds } },
      }),
      await tx.user.delete({
        where: {
          id: userId,
        },
      }),
    ];
  }).then(async result => {
    await invalidateRedis();
    return result;
  });
}
