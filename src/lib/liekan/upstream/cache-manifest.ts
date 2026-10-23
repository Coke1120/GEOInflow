import { createHash } from 'node:crypto';
import { checkAuth } from '@/lib/auth';
import { getBoardEntityIds } from '@/lib/boards';
import { ROLES } from '@/lib/constants';
import { isRelationalOnly } from '@/lib/db';
import type { BoardParameters } from '@/lib/types';
import {
  cacheManifestQuerySchema,
  cacheManifestResourcesSchema,
  type CacheManifestResponse,
  type CacheResource,
} from '../contracts/cache-manifest';
import { aiTransaction, type AiTx } from './ai-db';
import { readAnalyticsVersions } from './analytics-revision';
import { GEO_ALGORITHM } from '../geo-weight/policy';
import { GEO_SCOPE_HASH } from './geo-weight';
import { LiekanError } from './errors';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const resourceTables = {
  website: ['website', 'website_id'],
  link: ['link', 'link_id'],
  pixel: ['pixel', 'pixel_id'],
  board: ['board', 'board_id'],
} as const;
type ResourceRow = {
  id: string;
  userId: string | null;
  teamId: string | null;
  domain?: string | null;
  resetAt?: Date | null;
  type?: string;
  parameters?: BoardParameters;
  teamRole?: string;
};

/** Current primary ownership is checked before any private disk entry may be restored. */
export async function readCacheManifest(request: Request): Promise<CacheManifestResponse> {
  const auth = await checkAuth(request);
  if (auth?.authType !== 'session' || !auth.user || auth.user.deletedAt || auth.shareToken)
    throw new LiekanError('请完成登录后读取统计缓存', 401);
  if (!isRelationalOnly()) throw new LiekanError('当前数据库使用直接统计读取', 503);
  const parsed = cacheManifestQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) throw new LiekanError('缓存资源参数无效', 400);
  let resources: CacheResource[];
  try {
    resources = cacheManifestResourcesSchema.parse(JSON.parse(parsed.data.resources));
  } catch {
    throw new LiekanError('一次最多核验 20 个有效统计资源', 400);
  }
  resources = [
    ...new Map(resources.map(resource => [`${resource.type}:${resource.id}`, resource])).values(),
  ];
  const response = await aiTransaction(async tx => {
    const [live] = await tx.query<{ role: string }>(
      'SELECT role FROM "user" WHERE user_id=$1::uuid AND deleted_at IS NULL FOR SHARE',
      auth.user.id,
    );
    if (!live) throw new LiekanError('当前登录已失效', 401);
    const [meta] = await tx.query<{ instanceId: string }>(
      'SELECT instance_id::text AS "instanceId" FROM liekan_cache_meta WHERE id=true',
    );
    if (!meta) throw new LiekanError('统计缓存尚未初始化', 503);
    const rows = new Map<string, Promise<ResourceRow | null>>();
    const load = (resource: CacheResource) => {
      const key = `${resource.type}:${resource.id}`;
      if (!rows.has(key)) rows.set(key, authorizedResource(tx, resource, auth.user.id, live.role));
      return rows.get(key)!;
    };
    const versionsTx = {
      $queryRawUnsafe: (sql: string, ...args: unknown[]) => tx.query(sql, ...args),
    };
    const results: CacheManifestResponse['resources'] = [];
    for (const resource of resources) {
      const row = await load(resource);
      const denied = { ...resource, authorized: false as const };
      if (!row) {
        results.push(denied);
        continue;
      }
      const dependencies: Array<{ resource: CacheResource; row: ResourceRow }> = [];
      if (resource.type === 'board') {
        const ids = getBoardEntityIds({ type: row.type, parameters: row.parameters });
        const refs: CacheResource[] = [
          ...ids.websiteIds.map(id => ({ type: 'website' as const, id })),
          ...ids.linkIds.map(id => ({ type: 'link' as const, id })),
          ...ids.pixelIds.map(id => ({ type: 'pixel' as const, id })),
        ];
        // A malformed or unbounded saved layout must never authorize a partial cached board.
        if (refs.length > 200) {
          results.push(denied);
          continue;
        }
        let allowed = true;
        for (const ref of refs) {
          const valid = cacheManifestResourcesSchema.element.safeParse(ref);
          if (!valid.success) {
            allowed = false;
            break;
          }
          const dependency = await load(valid.data);
          if (!dependency) {
            allowed = false;
            break;
          }
          dependencies.push({ resource: valid.data, row: dependency });
        }
        if (!allowed) {
          results.push(denied);
          continue;
        }
      } else dependencies.push({ resource, row });
      const versions = await readAnalyticsVersions(
        versionsTx,
        dependencies.map(item => `${item.resource.type}:${item.resource.id}`),
      );
      const websiteIds = dependencies
        .filter(item => item.resource.type === 'website')
        .map(item => item.resource.id);
      const geo = websiteIds.length
        ? await tx.query(
            `SELECT DISTINCT ON (h.website_id) h.website_id::text AS "websiteId",s.id::text AS "snapshotId"
         FROM liekan_geo_weight_head h JOIN liekan_geo_weight_snapshot s ON s.id=h.snapshot_id
         WHERE h.website_id=ANY($1::uuid[]) AND s.expires_at>now()
         ORDER BY h.website_id,s.calculated_at DESC,s.id`,
            websiteIds,
          )
        : [];
      const geoBoundaries = websiteIds.length
        ? await tx.query(
            `SELECT w.website_id::text AS id,coalesce(l.epoch,1) AS epoch,
          coalesce((SELECT max(r.revision)::text FROM liekan_geo_weight_evidence_revision r WHERE r.website_id=w.website_id),'0') AS proof
         FROM website w LEFT JOIN liekan_log_state l ON l.website_id=w.website_id
         WHERE w.website_id=ANY($1::uuid[]) ORDER BY w.website_id`,
            websiteIds,
          )
        : [];
      results.push({
        ...resource,
        authorized: true,
        strongVersion: digest([
          'browser-cache-v1',
          live.role,
          row,
          versions.strong,
          dependencies.map(item => [item.resource, item.row]),
        ]),
        dataRevision: versions.data,
        // GEO omits ordinary report definitions and append-only revisions from its boundary.
        // Its dedicated status read still validates the exact requested date and snapshot.
        geoVersion: websiteIds.length
          ? digest([
              GEO_ALGORITHM,
              GEO_SCOPE_HASH,
              live.role,
              dependencies.map(item => [
                item.resource.id,
                item.row.domain,
                item.row.resetAt,
                item.row.userId,
                item.row.teamId,
                item.row.teamRole,
              ]),
              geoBoundaries,
            ])
          : null,
        geoSnapshotVersion: geo.length ? digest(geo) : null,
      });
    }
    return {
      userId: auth.user.id,
      instanceId: meta.instanceId,
      serverTime: Date.now(),
      resources: results,
    };
  });
  const fresh = await checkAuth(request);
  if (
    fresh?.authType !== 'session' ||
    fresh.shareToken ||
    fresh.user?.deletedAt ||
    fresh.user?.id !== auth.user.id
  )
    throw new LiekanError('当前登录已失效', 401);
  return response;
}

async function authorizedResource(
  tx: AiTx,
  resource: CacheResource,
  userId: string,
  role: string,
): Promise<ResourceRow | null> {
  const [table, column] = resourceTables[resource.type];
  const extra =
    resource.type === 'board'
      ? ',type,parameters'
      : resource.type === 'website'
        ? ',domain,reset_at AS "resetAt"'
        : '';
  const [row] = await tx.query<ResourceRow>(
    `SELECT ${column}::text AS id,user_id::text AS "userId",team_id::text AS "teamId"${extra}
     FROM ${table} WHERE ${column}=$1::uuid${resource.type === 'board' ? '' : ' AND deleted_at IS NULL'} FOR SHARE`,
    resource.id,
  );
  if (!row) return null;
  if (row.teamId) {
    const [team] = await tx.query(
      'SELECT team_id FROM team WHERE team_id=$1::uuid AND deleted_at IS NULL FOR SHARE',
      row.teamId,
    );
    if (!team) return null;
  }
  if (role === ROLES.admin || row.userId === userId) return row;
  if (!row.teamId) return null;
  const [member] = await tx.query(
    'SELECT role FROM team_user WHERE team_id=$1::uuid AND user_id=$2::uuid FOR SHARE',
    row.teamId,
    userId,
  );
  return member ? { ...row, teamRole: member.role } : null;
}
