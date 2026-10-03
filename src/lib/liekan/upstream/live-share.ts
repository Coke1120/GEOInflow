import { getBoardEntityIds } from '@/lib/boards';
import { ENTITY_TYPE, ROLES } from '@/lib/constants';
import prisma, { getRawQueryClient } from '@/lib/prisma';
import type { BoardParameters } from '@/lib/types';
import { getShare } from '@/queries/prisma';
import { publicShareParameters, sharePasswordProof } from './share-security';

const primary = (): any => getRawQueryClient(prisma.client, { write: true });
export async function loadShareEntity(type: number, id: string) {
  const model = {
    [ENTITY_TYPE.website]: 'website',
    [ENTITY_TYPE.pixel]: 'pixel',
    [ENTITY_TYPE.link]: 'link',
    [ENTITY_TYPE.board]: 'board',
  }[type];
  if (!model) return null;
  return primary()[model].findFirst({
    where: { id, ...(type === ENTITY_TYPE.board ? {} : { deletedAt: null }) },
  });
}
// Share authorization reads the primary so completed revocations and scope changes apply immediately.
export async function currentShareScope(share: any, previous?: any) {
  if (!share || share.parameters?.enabled === false) return null;
  const entity = await loadShareEntity(share.shareType, share.entityId);
  if (!entity) return null;
  const db = primary();
  const fresh: any = {
    shareId: share.id,
    shareType: share.shareType,
    parameters: publicShareParameters(share.parameters),
  };
  if (share.shareType === ENTITY_TYPE.board) {
    fresh.boardId = entity.id;
    const ids = getBoardEntityIds({
      type: entity.type,
      parameters: entity.parameters as BoardParameters,
    });
    let owner: any = null,
      teamUsers = new Set<string>();
    if (entity.teamId) {
      if (!(await db.team.findFirst({ where: { id: entity.teamId, deletedAt: null } })))
        return null;
      const members = await db.teamUser.findMany({
        where: { teamId: entity.teamId, user: { deletedAt: null } },
        select: { userId: true },
      });
      teamUsers = new Set(members.map((x: any) => x.userId));
    } else {
      owner = entity.userId
        ? await db.user.findFirst({ where: { id: entity.userId, deletedAt: null } })
        : null;
      if (!owner) return null;
    }
    for (const [key, type] of [
      ['websiteIds', ENTITY_TYPE.website],
      ['pixelIds', ENTITY_TYPE.pixel],
      ['linkIds', ENTITY_TYPE.link],
    ] as const) {
      const allowed = await Promise.all(
        ids[key]
          .filter(id => !previous || previous[key]?.includes(id))
          .map(async id => {
            const resource = await loadShareEntity(type, id);
            if (!resource) return null;
            if (entity.teamId)
              return resource.teamId === entity.teamId || teamUsers.has(resource.userId)
                ? id
                : null;
            if (owner.role === ROLES.admin || resource.userId === owner.id) return id;
            if (!resource.teamId) return null;
            const membership = await db.teamUser.findFirst({
              where: { teamId: resource.teamId, userId: owner.id, team: { deletedAt: null } },
            });
            return membership ? id : null;
          }),
      );
      fresh[key] = allowed.filter(Boolean);
    }
  } else {
    const field = {
      [ENTITY_TYPE.website]: 'websiteId',
      [ENTITY_TYPE.pixel]: 'pixelId',
      [ENTITY_TYPE.link]: 'linkId',
    }[share.shareType];
    if (!field) return null;
    fresh[field] = share.entityId;
    fresh.websiteId = share.entityId;
  }
  return fresh;
}
export async function validateLiveShare(token: any) {
  if (!token?.shareId) return null;
  const share = await getShare(token.shareId);
  if (
    !share ||
    share.shareType !== token.shareType ||
    sharePasswordProof(share.parameters) !== (token.passwordProof || null)
  )
    return null;
  const expected = {
    [ENTITY_TYPE.board]: 'boardId',
    [ENTITY_TYPE.website]: 'websiteId',
    [ENTITY_TYPE.pixel]: 'pixelId',
    [ENTITY_TYPE.link]: 'linkId',
  }[share.shareType];
  if (!expected || token[expected] !== share.entityId) return null;
  return currentShareScope(share, token);
}
