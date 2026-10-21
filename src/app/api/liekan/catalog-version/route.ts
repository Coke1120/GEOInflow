import { api } from '@/lib/liekan/http';
import { checkAuth } from '@/lib/auth';
import { isRelationalOnly } from '@/lib/db';
import { ENTITY_TYPE } from '@/lib/constants';
import { canViewWebsite, canViewBoard, canViewLink, canViewPixel } from '@/permissions';
import { getPublishedCatalog } from '@/lib/liekan/crawlers/published';

/** Shares receive only the version identifier after live resource authorization. */
export async function GET(request: Request) {
  const auth = await checkAuth(request);
  const denied = (status: number) => Response.json({ error: { message: '统计目录访问权限无效', status } }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  if (!auth) return denied(401);
  if ('shareToken' in auth && auth.shareToken) {
    if (auth.user) return denied(403);
    const share = auth.shareToken;
    const allowed = share.shareType === ENTITY_TYPE.website ? await canViewWebsite(auth, share.websiteId)
      : share.shareType === ENTITY_TYPE.board ? await canViewBoard(auth, share.boardId)
      : share.shareType === ENTITY_TYPE.link ? await canViewLink(auth, share.linkId)
      : share.shareType === ENTITY_TYPE.pixel ? await canViewPixel(auth, share.pixelId) : false;
    if (!allowed) return denied(403);
  } else if (auth.authType !== 'session' || !auth.user || auth.user.deletedAt) return denied(401);
  // Non-PostgreSQL native analytics retain their existing independent policy.
  if (!isRelationalOnly()) return Response.json({ version: null }, { headers: { 'Cache-Control': 'private, no-store' } });
  return api(async () => ({ version: getPublishedCatalog().version }));
}
