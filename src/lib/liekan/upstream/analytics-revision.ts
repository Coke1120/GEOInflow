import { HISTORY_REPAIR_CAMPAIGN, HISTORY_REPAIR_ENGINE } from '../contracts/history-repair';
import { getPublishedCatalog } from '../crawlers/published';
export type AnalyticsResource = 'website' | 'link' | 'pixel';
export const resourceCacheTag = (type: AnalyticsResource, id: string) =>
  `${type}:${id.toLowerCase()}`;

/** Call in the same primary transaction as the mutation. Missing resources begin at version zero. */
export async function bumpAnalyticsRevision(tx: any, type: AnalyticsResource, ...ids: string[]) {
  const schema = new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('Invalid database schema');
  await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
  for (const id of [...new Set(ids.filter(Boolean))].sort()) {
    await tx.$executeRawUnsafe(
      `INSERT INTO liekan_analytics_revision(resource_type,resource_id,revision)
       VALUES ($1,$2::uuid,1) ON CONFLICT (resource_type,resource_id)
       DO UPDATE SET revision=liekan_analytics_revision.revision+1,updated_at=now()`,
      type,
      id,
    );
  }
}

export interface AnalyticsVersions {
  strong: string;
  data: string;
}
export async function readAnalyticsVersions(tx: any, tags: string[]): Promise<AnalyticsVersions> {
  const ids = [...new Set(tags.map(tag => tag.split(':')[1]).filter(Boolean))].sort();
  if (!ids.length) return { strong: '[]', data: '[]' };
  // Read all resource types for these identifiers; native link/pixel statistics share the website API.
  const revisions = await tx.$queryRawUnsafe(
    `SELECT resource_type AS type,resource_id::text AS id,revision::text AS revision
     FROM liekan_analytics_revision WHERE resource_id=ANY($1::uuid[]) ORDER BY resource_type,resource_id`,
    ids,
  );
  const logs = await tx.$queryRawUnsafe(
    `SELECT website_id::text AS id,data_revision::text AS data,policy_revision::text AS policy
     FROM liekan_log_state WHERE website_id=ANY($1::uuid[]) ORDER BY website_id`,
    ids,
  );
  const repairs = await tx.$queryRawUnsafe(
    `SELECT website_id::text AS id,active_generation::text AS generation,active_revision::text AS revision
     FROM liekan_history_repair_run WHERE website_id=ANY($1::uuid[]) AND campaign_id=$2 ORDER BY website_id`,
    ids, HISTORY_REPAIR_CAMPAIGN,
  );
  return {
    strong: JSON.stringify([TRAFFIC_POLICY_VERSION,HISTORY_REPAIR_ENGINE,repairs,getPublishedCatalog()?.version || 'bundled',ids, revisions, logs.map(({ id, policy }: any) => ({ id, policy }))]),
    data: JSON.stringify(logs.map(({ id, data }: any) => ({ id, data }))),
  };
}
import { TRAFFIC_POLICY_VERSION } from './traffic-query';
