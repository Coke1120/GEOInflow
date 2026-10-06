import { randomUUID } from 'node:crypto';
import { hasPermission } from '@/lib/auth';
import { PERMISSIONS, ROLES } from '@/lib/constants';
import prisma, { getRawQueryClient } from '@/lib/prisma';
import { AiError } from '../ai/error';
import { invalidateWebsiteAnalytics } from './query-cache';
import { bumpAnalyticsRevision } from './analytics-revision';
async function setAiSchema(tx: any) {
  const schema = new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema))
    throw new AiError('database_unavailable', '数据库设置无效', 503);
  await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
}
async function installed(tx: any) {
  await setAiSchema(tx);
  return Boolean(
    (
      await tx.$queryRawUnsafe(
        "SELECT to_regclass('liekan_ai_connection') IS NOT NULL AS installed",
      )
    )[0]?.installed,
  );
}
async function invalidateRuns(tx: any, condition: string, ...params: unknown[]) {
  await tx.$executeRawUnsafe(
    `UPDATE liekan_ai_run SET state=CASE WHEN state IN ('accepted','preparing','calling','validating','cancel_requested') THEN 'invalidated' ELSE state END,lease_until=NULL,completed_at=COALESCE(completed_at,now()),stage=CASE WHEN state IN ('accepted','preparing','calling','validating','cancel_requested') THEN 'invalidated' ELSE stage END,error_code=CASE WHEN state IN ('accepted','preparing','calling','validating','cancel_requested') THEN 'invalidated' ELSE error_code END WHERE ${condition}`,
    ...params,
  );
}
export async function invalidateAiActorRunsInTransaction(tx: any, userId: string, teamId?: string) {
  if (!(await installed(tx))) return;
  await invalidateRuns(
    tx,
    "identity_id=$1::uuid AND ($2::uuid IS NULL OR team_id=$2::uuid) AND state IN ('accepted','preparing','calling','validating','cancel_requested')",
    userId,
    teamId ?? null,
  );
}
export async function clearAiWebsiteInTransaction(tx: any, websiteId: string) {
  if (!(await installed(tx))) return;
  const [site] = await tx.$queryRawUnsafe(
    'SELECT user_id,team_id FROM website WHERE website_id=$1::uuid FOR UPDATE',
    websiteId,
  );
  if (!site) return;
  // The website lock fences final submissions before the derived content is removed.
  await invalidateRuns(tx, 'website_id=$1::uuid', websiteId);
  await tx.$executeRawUnsafe(
    'DELETE FROM liekan_ai_conversation WHERE website_id=$1::uuid',
    websiteId,
  );
  if (Boolean(site.user_id) !== Boolean(site.team_id))
    await tx.$executeRawUnsafe(
      'INSERT INTO liekan_ai_website_state(website_id,epoch,owner_user_id,team_id) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid) ON CONFLICT(website_id) DO UPDATE SET epoch=$2::uuid,owner_user_id=$3::uuid,team_id=$4::uuid,updated_at=now()',
      websiteId,
      randomUUID(),
      site.user_id,
      site.team_id,
    );
  else
    await tx.$executeRawUnsafe(
      'DELETE FROM liekan_ai_website_state WHERE website_id=$1::uuid',
      websiteId,
    );
}
export async function clearAiUserInTransaction(tx: any, userId: string, includeOwnedTeams = false) {
  if (!(await installed(tx))) return;
  const teams = includeOwnedTeams
    ? await tx.$queryRawUnsafe(
        "SELECT team_id FROM team_user WHERE user_id=$1::uuid AND role='team-owner' ORDER BY team_id",
        userId,
      )
    : [];
  const teamIds = teams.map((t: any) => t.team_id);
  const websites = await tx.$queryRawUnsafe(
    'SELECT website_id FROM website WHERE user_id=$1::uuid OR team_id=ANY($2::uuid[]) ORDER BY website_id FOR UPDATE',
    userId,
    teamIds,
  );
  for (const site of websites) await clearAiWebsiteInTransaction(tx, site.website_id);
  await tx.$queryRawUnsafe('SELECT user_id FROM "user" WHERE user_id=$1::uuid FOR UPDATE', userId);
  await invalidateRuns(
    tx,
    'identity_id=$1::uuid OR owner_user_id=$1::uuid OR team_id=ANY($2::uuid[])',
    userId,
    teamIds,
  );
  await tx.$executeRawUnsafe(
    'DELETE FROM liekan_ai_conversation WHERE creator_id=$1::uuid OR owner_user_id=$1::uuid OR team_id=ANY($2::uuid[])',
    userId,
    teamIds,
  );
  await tx.$executeRawUnsafe(
    'DELETE FROM liekan_ai_connection WHERE owner_user_id=$1::uuid OR team_id=ANY($2::uuid[])',
    userId,
    teamIds,
  );
  await tx.$executeRawUnsafe(
    'DELETE FROM liekan_ai_website_state WHERE owner_user_id=$1::uuid OR team_id=ANY($2::uuid[])',
    userId,
    teamIds,
  );
}
export async function clearAiTeamInTransaction(tx: any, teamId: string) {
  if (!(await installed(tx))) return;
  const websites = await tx.$queryRawUnsafe(
    'SELECT website_id FROM website WHERE team_id=$1::uuid ORDER BY website_id FOR UPDATE',
    teamId,
  );
  for (const site of websites) await clearAiWebsiteInTransaction(tx, site.website_id);
  await tx.$queryRawUnsafe('SELECT team_id FROM team WHERE team_id=$1::uuid FOR UPDATE', teamId);
  await invalidateRuns(tx, 'team_id=$1::uuid', teamId);
  await tx.$executeRawUnsafe('DELETE FROM liekan_ai_conversation WHERE team_id=$1::uuid', teamId);
  await tx.$executeRawUnsafe('DELETE FROM liekan_ai_connection WHERE team_id=$1::uuid', teamId);
  await tx.$executeRawUnsafe('DELETE FROM liekan_ai_website_state WHERE team_id=$1::uuid', teamId);
}
export async function transferWebsiteWithAi(
  websiteId: string,
  identity: { userId: string },
  target: { userId: string | null; teamId: string | null },
) {
  const primary: any = getRawQueryClient(prisma.client, { write: true });
  const transferred = await primary.$transaction(
    async (tx: any) => {
      await setAiSchema(tx);
      const [site] = await tx.$queryRawUnsafe(
        'SELECT user_id,team_id FROM website WHERE website_id=$1::uuid AND deleted_at IS NULL FOR UPDATE',
        websiteId,
      );
      if (!site) throw new AiError('resource_unavailable', '网站不可访问', 404);
      const [user] = await tx.$queryRawUnsafe(
        'SELECT role FROM "user" WHERE user_id=$1::uuid AND deleted_at IS NULL FOR SHARE',
        identity.userId,
      );
      if (!user) throw new AiError('session_required', '当前登录已失效', 401);
      if (target.userId) {
        const owner = await tx.$queryRawUnsafe(
          'SELECT user_id FROM "user" WHERE user_id=$1::uuid AND deleted_at IS NULL FOR SHARE',
          target.userId,
        );
        if (!owner.length) throw new AiError('resource_unavailable', '接收账户不可访问', 404);
        const [member] = site.team_id
          ? await tx.$queryRawUnsafe(
              'SELECT role FROM team_user WHERE team_id=$1::uuid AND user_id=$2::uuid FOR SHARE',
              site.team_id,
              identity.userId,
            )
          : [];
        if (
          user.role !== ROLES.admin &&
          (!site.team_id ||
            target.userId !== identity.userId ||
            !member ||
            !(await hasPermission(member.role, PERMISSIONS.websiteTransferToUser)))
        )
          throw new AiError('resource_unavailable', '转移权限已变更', 403);
      } else if (target.teamId) {
        const team = await tx.$queryRawUnsafe(
          'SELECT team_id FROM team WHERE team_id=$1::uuid AND deleted_at IS NULL FOR SHARE',
          target.teamId,
        );
        if (!team.length) throw new AiError('resource_unavailable', '接收团队不可访问', 404);
        const [member] = await tx.$queryRawUnsafe(
          'SELECT role FROM team_user WHERE team_id=$1::uuid AND user_id=$2::uuid FOR SHARE',
          target.teamId,
          identity.userId,
        );
        if (
          user.role !== ROLES.admin &&
          (site.user_id !== identity.userId ||
            !member ||
            !(await hasPermission(member.role, PERMISSIONS.websiteTransferToTeam)))
        )
          throw new AiError('resource_unavailable', '转移权限已变更', 403);
      } else throw new AiError('invalid_request', '请选择接收空间');
      await (await import('./lifecycle')).stopWebsiteSources(tx, websiteId);
      await clearAiWebsiteInTransaction(tx, websiteId);
      const result = await tx.website.update({ where: { id: websiteId }, data: target });
      await bumpAnalyticsRevision(tx, 'website', websiteId);
      if (await installed(tx))
        await tx.$executeRawUnsafe(
          'UPDATE liekan_ai_website_state SET epoch=$2::uuid,owner_user_id=$3::uuid,team_id=$4::uuid,updated_at=now() WHERE website_id=$1::uuid',
          websiteId,
          randomUUID(),
          target.userId,
          target.teamId,
        );
      return result;
    },
    { timeout: 30000 },
  );
  invalidateWebsiteAnalytics(websiteId);
  return transferred;
}
