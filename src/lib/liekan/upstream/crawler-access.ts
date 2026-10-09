import { checkAuth } from '@/lib/auth';
import { isRelationalOnly } from '@/lib/db';
import { ROLES } from '@/lib/constants';
import { authorizeAiWebsite, type AiActor } from './ai-access';
import { aiTransaction, type AiTx } from './ai-db';
import { AiError } from '../ai/error';
import { LiekanError } from './errors';
import { bindCacheRequest } from './cache-context';

export type CrawlerActor = AiActor;
export type CrawlerAccessMode = 'read' | 'draft' | 'control';

export async function authenticateCrawler(request: Request): Promise<CrawlerActor> {
  const auth = await checkAuth(request);
  if (auth?.authType !== 'session' || !auth.user || auth.user.deletedAt || auth.shareToken)
    throw new LiekanError('请完成登录后管理蜘蛛访问策略', 401);
  if (!isRelationalOnly()) throw new LiekanError('当前数据库暂不支持蜘蛛归因与控制', 503);
  if (!['GET', 'HEAD'].includes(request.method)) {
    const origin = request.headers.get('origin');
    if (origin) {
      const url = new URL(request.url);
      const protocol = request.headers.get('x-forwarded-proto') ?? url.protocol.slice(0, -1);
      const authority = request.headers.get('host') ?? url.host;
      // Host is the browser's HTTP authority; Next's standalone URL may use the container address.
      // TLS proxies must preserve Host and provide one canonical forwarding protocol.
      if (!['http', 'https'].includes(protocol) || /[\s,\/\\@?#]/u.test(authority))
        throw new LiekanError('写入请求来源无效', 403);
      let expected: string;
      try {
        expected = new URL(`${protocol}://${authority}`).origin;
      } catch {
        throw new LiekanError('写入请求来源无效', 403);
      }
      if (origin !== expected) throw new LiekanError('写入请求来源无效', 403);
    }
  }
  if (request.method === 'GET' && new URL(request.url).pathname.endsWith('/crawler-analysis'))
    bindCacheRequest(request, auth, undefined, async () => {
      const current = await checkAuth(request);
      return (
        current?.authType === 'session' &&
        !current.shareToken &&
        !current.user?.deletedAt &&
        current.user?.id === auth.user.id
      );
    });
  return { id: auth.user.id, role: auth.user.role };
}

export async function authorizeCrawler(
  tx: AiTx,
  actor: CrawlerActor,
  websiteId: string,
  mode: CrawlerAccessMode = 'read',
) {
  try {
    const website = await authorizeAiWebsite(tx, actor, websiteId);
    const canDraft =
      website.canUse &&
      (website.role === ROLES.admin ||
        website.ownerUserId === actor.id ||
        [ROLES.teamOwner, ROLES.teamManager, ROLES.teamMember].includes(website.teamRole as any));
    if (mode === 'draft' && !canDraft) throw new LiekanError('此操作需要网站编辑权限', 403);
    if (mode === 'control' && !website.canManage)
      throw new LiekanError('此操作需要网站所有者或团队管理员权限', 403);
    return { ...website, canDraft, canControl: website.canManage };
  } catch (error) {
    if (error instanceof AiError) throw new LiekanError(error.message, error.status);
    throw error;
  }
}

export async function crawlerTransaction<T>(
  work: (tx: AiTx) => Promise<T>,
  options: Parameters<typeof aiTransaction>[1] = {},
): Promise<T> {
  try {
    return await aiTransaction(work, options);
  } catch (error) {
    if (error instanceof AiError) throw new LiekanError(error.message, error.status);
    throw error;
  }
}
