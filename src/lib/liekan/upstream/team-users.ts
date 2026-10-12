import { checkAuth } from '@/lib/auth';
import { uuid } from '@/lib/crypto';
import { hashPassword } from '@/lib/password';
import prisma from '@/lib/prisma';
import {
  teamUserCreateSchema,
  teamUserReadQuery,
  type TeamUserResult,
} from '../contracts/team-users';
import { LiekanError } from './errors';
import { lockMembershipUsers, lockTeamMembership } from './team-member-access';

async function administrator(request: Request) {
  const auth = await checkAuth(request);
  if (auth?.authType !== 'session' || !auth.user || auth.user.deletedAt || auth.shareToken)
    throw new LiekanError('请完成登录后新建用户', 401);
  if (auth.user.role !== 'admin') throw new LiekanError('新建用户需要系统管理员权限', 403);
  return auth.user.id;
}
function teamId(value: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value))
    throw new LiekanError('团队 ID 无效');
  return value.toLowerCase();
}
async function recheckAdministrator(tx: any, request: Request, actorId: string) {
  const rows = await lockMembershipUsers(tx, actorId);
  if (rows[0]?.role !== 'admin') throw new LiekanError('系统管理权限已变更', 403);
  if ((await administrator(request)) !== actorId) throw new LiekanError('登录身份已变更', 401);
}
async function resultFor(tx: any, id: string, userId: string): Promise<TeamUserResult> {
  const user = await tx.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, username: true, role: true },
  });
  if (!user) return { state: 'unconfirmed' };
  const member = await tx.teamUser.findFirst({
    where: { teamId: id, userId, team: { deletedAt: null } },
  });
  if (
    !member?.createdAt ||
    !['team-manager', 'team-member', 'team-view-only'].includes(member.role)
  )
    return { state: 'changed', user };
  const count = await tx.teamUser.count({
    where: {
      teamId: id,
      user: { deletedAt: null },
      OR: [
        { createdAt: { lt: member.createdAt } },
        { createdAt: member.createdAt, id: { lte: member.id } },
      ],
    },
  });
  return {
    state: 'created',
    user,
    member: {
      id: member.id,
      userId: member.userId,
      teamId: member.teamId,
      role: member.role,
      createdAt: member.createdAt.toISOString(),
    },
    page: Math.max(1, Math.ceil(count / 20)),
  };
}
export async function createTeamUserAccount(request: Request, rawTeamId: string, input: unknown) {
  const actorId = await administrator(request),
    id = teamId(rawTeamId);
  const parsed = teamUserCreateSchema.safeParse(input);
  if (!parsed.success) throw new LiekanError(parsed.error.issues[0]?.message || '账户信息无效');
  const body = parsed.data,
    password = hashPassword(body.password);
  try {
    return await prisma.transaction(async tx => {
      await recheckAdministrator(tx, request, actorId);
      await lockTeamMembership(tx, id);
      const existing = await tx.user.findFirst({
        where: {
          OR: [{ id: body.userId }, { username: { equals: body.username, mode: 'insensitive' } }],
        },
        select: { id: true },
      });
      if (existing)
        throw new LiekanError(
          '用户名或账户 ID 已存在，请核对创建结果或添加已有用户',
          409,
          existing.id === body.userId ? 'account-id-conflict' : 'username-conflict',
        );
      await tx.user.create({
        data: { id: body.userId, username: body.username, password, role: 'user' },
        select: { id: true },
      });
      await tx.teamUser.create({
        data: {
          id: uuid(),
          userId: body.userId,
          teamId: id,
          role: body.teamRole,
          createdAt: new Date(),
        },
      });
      return resultFor(tx, id, body.userId);
    });
  } catch (error) {
    const constraint = (error as any)?.meta?.driverAdapterError?.cause?.constraint;
    if ((error as any)?.code === 'P2002')
      throw new LiekanError(
        '用户名或账户 ID 已存在，请核对创建结果或添加已有用户',
        409,
        (error as any)?.meta?.target?.includes?.('username') ||
          constraint?.fields?.includes?.('username') ||
          constraint?.index === 'user_username_key'
          ? 'username-conflict'
          : 'account-id-conflict',
      );
    throw error;
  }
}
export async function readTeamUserCreation(request: Request, rawTeamId: string, input: unknown) {
  const actorId = await administrator(request),
    id = teamId(rawTeamId);
  const parsed = teamUserReadQuery.safeParse(input);
  if (!parsed.success) throw new LiekanError('账户 ID 无效');
  return prisma.transaction(async tx => {
    await recheckAdministrator(tx, request, actorId);
    return resultFor(tx, id, parsed.data.userId);
  });
}
