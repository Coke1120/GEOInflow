import { checkAuth, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/lib/constants';
import prisma, { getRawQueryClient } from '@/lib/prisma';
import type { Auth } from '@/lib/types';
import { canUpdateWebsite, canViewWebsite } from '@/permissions';
import { getWebsiteStats } from '@/queries/sql';
import { getQuerySnapshot, withinQuerySnapshot } from './query-snapshot';

import { LiekanError } from './errors';
import {
  bindCacheRequest,
  prepareAnalyticsVersions,
  runCacheAuthorization,
  cacheHeadersEnabled,
} from './cache-context';
import { primaryMetadataClient } from './analytics-deadline';
export { LiekanError } from './errors';
export async function authorize(request: Request, websiteId: string, write = false) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(websiteId))
    throw new LiekanError('站点 ID 无效');
  const auth = await runCacheAuthorization(() => checkAuth(request));
  if (!auth?.user || ('shareToken' in auth && auth.shareToken) || auth.user.deletedAt)
    throw new LiekanError('需要完整登录', 401);
  bindCacheRequest(request, auth);
  await prepareAnalyticsVersions([`website:${websiteId.toLowerCase()}`]);
  const website = await runCacheAuthorization<any>(() =>
    primary().website.findFirst({
      where: { id: websiteId, deletedAt: null },
      select: { id: true, name: true, domain: true },
    }),
  );
  if (!website) throw new LiekanError('站点不存在', 404);
  const allowed = write
    ? await canUpdateWebsite(auth as Auth, websiteId)
    : await canViewWebsite(auth as Auth, websiteId);
  if (!allowed) throw new LiekanError('无权访问该站点', 403);
  bindCacheRequest(
    request,
    auth,
    Object.fromEntries(new URL(request.url).searchParams),
    async () => {
      const fresh = await checkAuth(request);
      if (
        !fresh?.user ||
        fresh.user.deletedAt ||
        ('shareToken' in fresh && fresh.shareToken) ||
        fresh.user.id !== auth.user.id ||
        fresh.user.role !== auth.user.role
      )
        return false;
      const client = primaryMetadataClient() || primary();
      const current = await client.website.findFirst({
        where: { id: websiteId, deletedAt: null },
        select: { userId: true, teamId: true },
      });
      if (!current) return false;
      if (await hasPermission(fresh.user.role, PERMISSIONS.all)) return true;
      if (current.userId) return current.userId === fresh.user.id;
      if (!current.teamId) return false;
      const member = await client.teamUser.findFirst({
        where: { teamId: current.teamId, userId: fresh.user.id, team: { deletedAt: null } },
        select: { role: true },
      });
      return !!member && (!write || (await hasPermission(member.role, PERMISSIONS.websiteUpdate)));
    },
  );
  return {
    website,
    auth,
    writeIdentity: { userId: auth.user.id },
    canManage: Boolean(await canUpdateWebsite(auth as Auth, websiteId)),
  };
}
export type WriteIdentity = { userId: string };
export async function lockWritableWebsite(tx: any, id: string, identity?: WriteIdentity) {
  const rows = await tx.$queryRawUnsafe(
    'SELECT user_id,team_id FROM website WHERE website_id=$1::uuid AND deleted_at IS NULL FOR UPDATE',
    id,
  );
  if (!rows.length) throw new LiekanError('站点不存在', 404);
  if (!identity) return;
  const users = await tx.$queryRawUnsafe(
    'SELECT role FROM "user" WHERE user_id=$1::uuid AND deleted_at IS NULL FOR SHARE',
    identity.userId,
  );
  if (!users.length) throw new LiekanError('账户无效', 401);
  if (await hasPermission(users[0].role, PERMISSIONS.all)) return;
  if (rows[0].user_id === identity.userId) return;
  const members = rows[0].team_id
    ? await tx.$queryRawUnsafe(
        'SELECT tu.role FROM team_user tu JOIN team t ON t.team_id=tu.team_id WHERE tu.team_id=$1::uuid AND tu.user_id=$2::uuid AND t.deleted_at IS NULL FOR SHARE OF tu,t',
        rows[0].team_id,
        identity.userId,
      )
    : [];
  if (!members.length || !(await hasPermission(members[0].role, PERMISSIONS.websiteUpdate)))
    throw new LiekanError('站点管理权限已变更', 403);
}
const primary = (): any => getRawQueryClient(prisma.client, { write: true });
export async function query<T = any>(sql: string, ...params: unknown[]): Promise<T[]> {
  const snapshot = getQuerySnapshot() || primaryMetadataClient();
  if (snapshot) return snapshot.$queryRawUnsafe(sql, ...params) as Promise<T[]>;
  if (cacheHeadersEnabled())
    return runCacheAuthorization(() => primaryMetadataClient().$queryRawUnsafe(sql, ...params));
  return transaction(tx => tx.$queryRawUnsafe(sql, ...params));
}
export async function sourceWebsite(tx: any, id: string, identity: WriteIdentity) {
  await lockWritableWebsite(tx, id, identity);
  return (
    await tx.$queryRawUnsafe(
      'SELECT domain,user_id,team_id,reset_at FROM website WHERE website_id=$1::uuid',
      id,
    )
  )[0];
}
export async function reportSnapshot<T>(work: () => Promise<T>): Promise<T> {
  if (getQuerySnapshot()) return work();
  const schema = new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new LiekanError('数据库 schema 无效', 500);
  return primary().$transaction(
    async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      return withinQuerySnapshot(tx, work);
    },
    { isolationLevel: 'RepeatableRead', timeout: 60000, maxWait: 10000 },
  );
}
export async function transaction<T>(work: (tx: any) => Promise<T>): Promise<T> {
  const schema = new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new LiekanError('数据库 schema 无效', 500);
  return (await primary().$transaction(
    async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      return work(tx);
    },
    { timeout: 60000, maxWait: 60000 },
  )) as T;
}
export async function humanTotals(websiteId: string, startDate: Date, endDate: Date) {
  const raw: unknown = await getWebsiteStats(websiteId, { startDate, endDate });
  const incompatible = () => new LiekanError('统计数据契约不兼容', 500);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw incompatible();
  const totals = {} as {
    pageviews: number;
    visitors: number;
    visits: number;
    bounces: number;
    totaltime: number;
  };
  for (const field of ['pageviews', 'visitors', 'visits', 'bounces', 'totaltime'] as const) {
    if (!Object.hasOwn(raw, field)) throw incompatible();
    let value = raw[field];
    // PostgreSQL aggregate counts are bigint. Normalize only exactly representable values.
    if (typeof value === 'bigint') {
      if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw incompatible();
      value = Number(value);
    }
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      (field !== 'totaltime' && !Number.isSafeInteger(value))
    )
      throw incompatible();
    totals[field] = value;
  }
  return totals;
}
