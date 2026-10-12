import { TEAM_ROLE_RANK } from '@/lib/constants';
import prisma from '@/lib/prisma';
import { invalidateAiActorRunsInTransaction } from './ai-lifecycle';
import { LiekanError } from './errors';
import { canAssignTeamUserRole } from '../contracts/team-users';
import { uuid } from '@/lib/crypto';

async function membershipSchema(tx: any) {
  const schema = new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new LiekanError('数据库 schema 无效', 500);
  await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
}

export async function lockTeamMembership(tx: any, teamId: string) {
  await membershipSchema(tx);
  const rows = await tx.$queryRawUnsafe(
    'SELECT team_id FROM team WHERE team_id=$1::uuid AND deleted_at IS NULL FOR UPDATE',
    teamId,
  );
  if (!rows.length) throw new LiekanError('团队不存在或已删除', 404);
}
export async function lockMembershipUsers(tx: any, ...ids: string[]) {
  await membershipSchema(tx);
  return tx.$queryRawUnsafe(
    'SELECT user_id,role FROM "user" WHERE user_id=ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY user_id FOR SHARE',
    [...new Set(ids)].sort(),
  ) as Promise<{ user_id: string; role: string }[]>;
}

export async function mutateTeamMember(
  actorId: string,
  teamId: string,
  userId: string,
  mode: 'add' | 'edit' | 'remove',
  nextRole?: string,
) {
  actorId = actorId.toLowerCase();
  teamId = teamId.toLowerCase();
  userId = userId.toLowerCase();
  return prisma.transaction(async tx => {
    const users = await lockMembershipUsers(tx, actorId, userId);
    const actor = users.find(user => user.user_id === actorId);
    if (!actor) throw new LiekanError('需要重新登录', 401);
    if (!users.some(user => user.user_id === userId))
      throw new LiekanError('用户不存在或已删除', 404);
    await lockTeamMembership(tx, teamId);
    const [actorMember, target] = await Promise.all([
      tx.teamUser.findFirst({ where: { teamId, userId: actorId } }),
      tx.teamUser.findFirst({ where: { teamId, userId } }),
    ]);
    const isAdmin = actor.role === 'admin';
    const selfLeave = mode === 'remove' && actorId === userId && target?.role !== 'team-owner';
    if (target?.role === 'team-owner')
      throw new LiekanError('团队所有者身份需要通过独立移交流程管理');
    if (
      !selfLeave &&
      (actor.role === 'view-only' ||
        (!isAdmin && !['team-owner', 'team-manager'].includes(actorMember?.role)))
    )
      throw new LiekanError('团队管理权限已变更', 403);
    if (mode !== 'remove' && !canAssignTeamUserRole(isAdmin, actorMember?.role, nextRole || ''))
      throw new LiekanError('没有权限分配此团队角色', 403);
    if (mode !== 'add' && !target) throw new LiekanError('该用户已不在当前团队', 404);
    if (mode === 'add' && target) throw new LiekanError('用户已加入当前团队', 409);
    if (
      !isAdmin &&
      !selfLeave &&
      target &&
      (TEAM_ROLE_RANK[actorMember?.role] ?? -1) <= (TEAM_ROLE_RANK[target.role] ?? -1)
    )
      throw new LiekanError('没有权限修改此成员', 403);
    if (mode === 'add')
      return tx.teamUser.create({ data: { id: uuid(), teamId, userId, role: nextRole } });
    const result =
      mode === 'edit'
        ? await tx.teamUser.update({ where: { id: target.id }, data: { role: nextRole } })
        : await tx.teamUser.deleteMany({ where: { teamId, userId } });
    await invalidateAiActorRunsInTransaction(tx, userId, teamId);
    return result;
  });
}

export function memberWriteError(error: unknown) {
  if (!(error instanceof LiekanError)) throw error;
  return Response.json(
    { error: { message: error.message, status: error.status, code: 'team-member-error' } },
    { status: error.status },
  );
}
