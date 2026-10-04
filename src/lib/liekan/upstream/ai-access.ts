import { checkAuth } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import type { AiSpace } from '../ai/contracts';
import { AiError } from '../ai/error';
import type { AiTx } from './ai-db';
export interface AiActor {
  id: string;
  role: string;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function aiId(value: string) {
  if (!uuid.test(value)) throw new AiError('invalid_id', '资源 ID 无效');
  return value.toLowerCase();
}
export async function authenticateAiRequest(request: Request): Promise<AiActor> {
  const auth = await checkAuth(request);
  if (
    auth?.authType !== 'session' ||
    !auth.user ||
    auth.user.deletedAt ||
    ('shareToken' in auth && auth.shareToken)
  )
    throw new AiError('session_required', '请完成登录后使用 AI 功能', 401);
  return { id: aiId(auth.user.id), role: auth.user.role };
}
/** Catalog and mutation authorization use the same combination of account and team roles. */
export function aiSpaceCapabilities(
  role: string,
  kind: 'personal' | 'team',
  ownPersonal: boolean,
  teamRole: string | null,
) {
  const readonly = role === ROLES.viewOnly || teamRole === ROLES.teamViewOnly;
  return {
    canUse: !readonly,
    canManage:
      !readonly &&
      (role === ROLES.admin ||
        (kind === 'personal' && ownPersonal) ||
        [ROLES.teamOwner, ROLES.teamManager].includes(teamRole as any)),
  };
}
export async function authorizeAiSpace(
  tx: AiTx,
  actor: AiActor,
  space: AiSpace,
  mode: 'read' | 'use' | 'manage' = 'read',
) {
  space = { ...space, id: aiId(space.id) };
  const [live] = await tx.query<{ role: string }>(
    'SELECT role FROM "user" WHERE user_id=$1::uuid AND deleted_at IS NULL FOR SHARE',
    actor.id,
  );
  if (!live) throw new AiError('session_required', '当前登录已失效', 401);
  const admin = live.role === ROLES.admin;
  let teamRole: string | null = null;
  if (space.kind === 'personal') {
    const owner = await tx.query(
      'SELECT user_id FROM "user" WHERE user_id=$1::uuid AND deleted_at IS NULL FOR SHARE',
      space.id,
    );
    if (!owner.length || (!admin && space.id !== actor.id))
      throw new AiError('resource_unavailable', '当前空间不可访问', 404);
  } else {
    const team = await tx.query(
      'SELECT team_id FROM team WHERE team_id=$1::uuid AND deleted_at IS NULL FOR SHARE',
      space.id,
    );
    const [member] = await tx.query<{ role: string }>(
      'SELECT role FROM team_user WHERE team_id=$1::uuid AND user_id=$2::uuid FOR SHARE',
      space.id,
      actor.id,
    );
    if (!team.length || (!admin && !member))
      throw new AiError('resource_unavailable', '当前空间不可访问', 404);
    teamRole = member?.role ?? null;
  }
  const { canManage, canUse } = aiSpaceCapabilities(
    live.role,
    space.kind,
    space.id === actor.id,
    teamRole,
  );
  const readonly = !canUse;
  if (mode !== 'read' && readonly) throw new AiError('read_only', '只读身份可查看已有记录', 403);
  if (mode === 'manage' && !canManage)
    throw new AiError('management_required', '此操作需要空间管理权限', 403);
  return { canManage, canUse, role: live.role, teamRole };
}
export async function authorizeAiWebsite(tx: AiTx, actor: AiActor, id: string, paid = false) {
  id = aiId(id);
  const [row] = await tx.query<{
    id: string;
    name: string;
    domain: string;
    ownerUserId: string | null;
    teamId: string | null;
    resetAt: Date | null;
  }>(
    'SELECT website_id AS id,name,domain,user_id AS "ownerUserId",team_id AS "teamId",reset_at AS "resetAt" FROM website WHERE website_id=$1::uuid AND deleted_at IS NULL FOR SHARE',
    id,
  );
  if (!row || Boolean(row.ownerUserId) === Boolean(row.teamId))
    throw new AiError('resource_unavailable', '当前网站不可访问', 404);
  const space: AiSpace = row.teamId
    ? { kind: 'team', id: row.teamId }
    : { kind: 'personal', id: row.ownerUserId! };
  const access = await authorizeAiSpace(tx, actor, space, paid ? 'use' : 'read');
  return { ...row, space, ...access };
}
export function aiSpaceFromRow(row: {
  owner_user_id: string | null;
  team_id: string | null;
}): AiSpace {
  if (Boolean(row.owner_user_id) === Boolean(row.team_id))
    throw new AiError('resource_unavailable', '资源归属无效', 404);
  return row.team_id
    ? { kind: 'team', id: row.team_id }
    : { kind: 'personal', id: row.owner_user_id! };
}
