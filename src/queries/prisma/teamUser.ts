import { Prisma, type TeamUser } from '@/generated/prisma/client';
import { uuid } from '@/lib/crypto';
import prisma from '@/lib/prisma';
import { invalidateAiActorRunsInTransaction } from '@/lib/liekan/upstream/ai-lifecycle';
import { lockMembershipUsers, lockTeamMembership } from '@/lib/liekan/upstream/team-member-access';
import { LiekanError } from '@/lib/liekan/upstream/errors';
import type { PageResult, QueryFilters } from '@/lib/types';

import TeamUserFindManyArgs = Prisma.TeamUserFindManyArgs;

export type TeamUserListItem = TeamUser & {
  user?: {
    id: string;
    username: string;
  };
};

export async function findTeamUser(criteria: Prisma.TeamUserFindUniqueArgs) {
  return prisma.client.teamUser.findUnique(criteria);
}

export async function getTeamUser(teamId: string, userId: string) {
  return prisma.client.teamUser.findFirst({
    where: {
      teamId,
      userId,
      team: { deletedAt: null },
    },
  });
}

export async function getTeamUsers(
  criteria: TeamUserFindManyArgs,
  filters?: QueryFilters,
): Promise<PageResult<TeamUserListItem[]>> {
  const { search } = filters;

  const where: Prisma.TeamUserWhereInput = {
    ...criteria.where,
    ...prisma.getSearchParameters(search, [{ user: { username: 'contains' } }]),
  };

  return prisma.pagedQuery(
    'teamUser',
    {
      ...criteria,
      where,
    },
    filters,
  );
}

export async function createTeamUser(userId: string, teamId: string, role: string) {
  return prisma.transaction(async tx => {
    if (!(await lockMembershipUsers(tx, userId)).length) throw new LiekanError('用户不存在或已删除', 404);
    await lockTeamMembership(tx, teamId);
    if (await tx.teamUser.findFirst({where: {teamId, userId}})) throw new LiekanError('用户已加入当前团队', 409);
    return tx.teamUser.create({data: {id: uuid(), userId, teamId, role}});
  });
}

export async function updateTeamUser(teamUserId: string, data: Prisma.TeamUserUpdateInput) {
  return prisma.transaction(async tx => {
    const result = await tx.teamUser.update({ where: { id: teamUserId }, data });
    if (data.role !== undefined)
      await invalidateAiActorRunsInTransaction(tx, result.userId, result.teamId);
    return result;
  });
}
export async function deleteTeamUser(teamId: string, userId: string) {
  return prisma.transaction(async tx => {
    const result = await tx.teamUser.deleteMany({ where: { teamId, userId } });
    await invalidateAiActorRunsInTransaction(tx, userId, teamId);
    return result;
  });
}
