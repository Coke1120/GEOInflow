import { bumpAnalyticsRevision } from './analytics-revision';
import { collectionRepairScope } from './history-repair-boundary';
import { analyticsCache, websiteCacheTag } from './query-cache';
import type { GeographyEvidence } from '../geography/evidence';
import { randomInt } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import prisma, { getRawQueryClient, getSchema } from '@/lib/prisma';
import type { CollectionQuality } from './collection-quality';
import type { CollectionObservation } from './collection-observation';
import { processSingleton } from './process-singleton';
import type { CollectionIdentity } from './collection-identity';

export interface CollectionWriteInput {
  websiteId: string;
  eventId?: string;
  fingerprint: string;
  quality?: CollectionQuality;
  geography?: GeographyEvidence;
  observation?: CollectionObservation;
  identity?: CollectionIdentity;
  identify?: boolean;
  expectedPolicyRevision?: string;
}
export type CollectionWriteResult<T> =
  | { status: 'written'; value: T }
  | { status: 'duplicate'; sessionId: string; visitId: string };
export class CollectionConflictError extends Error {
  constructor() {
    super('Collection event ID already has a different payload');
    this.name = 'CollectionConflictError';
  }
}
interface CollectionWriteContext extends CollectionWriteInput {
  client: typeof prisma.client;
  invalidateGeography?: boolean;
  invalidateIdentity?: boolean;
  repairScopeId?: string | null;
}
interface CollectionPrimary {
  $transaction<T>(
    work: (tx: typeof prisma.client) => Promise<T>,
    options: { isolationLevel: 'ReadCommitted'; maxWait: number; timeout: number },
  ): Promise<T>;
}
const writes = processSingleton(
  'liekan-collection-write',
  () => new AsyncLocalStorage<CollectionWriteContext>(),
);

export function collectionWriteClient(): typeof prisma.client {
  return writes.getStore()?.client || prisma.client;
}

export function currentCollectionTransaction() {
  return writes.getStore()?.client;
}

export async function recordCollectionIdentity(websiteId: string, identity: CollectionIdentity) {
  const context = writes.getStore();
  if (!context || context.websiteId !== websiteId || context.identity !== identity)
    throw new Error('Collection identity requires its owning transaction');
  const changed = await context.client.$executeRawUnsafe(
    `INSERT INTO liekan_session_source(website_id,session_id,source,scope,identity_version,identity_available)
     VALUES($1::uuid,$2::uuid,$3,$4,$5,$6)
     ON CONFLICT(website_id,session_id) DO UPDATE SET updated_at=clock_timestamp()
     WHERE liekan_session_source.source=EXCLUDED.source AND liekan_session_source.scope=EXCLUDED.scope`,
    websiteId,
    identity.sessionId,
    context.quality.source,
    identity.scope,
    identity.version,
    identity.available,
  );
  if (changed !== 1) throw new Error('Collection session belongs to another source');
}

export async function recordSessionPropertySource(
  websiteId: string,
  sessionId: string,
  dataKey: string,
) {
  const context = writes.getStore();
  if (!context?.identity) return;
  if (context.websiteId !== websiteId || context.identity.sessionId !== sessionId)
    throw new Error('Collection property crosses its source boundary');
  await context.client.$executeRawUnsafe(
    `INSERT INTO liekan_session_data_source(website_id,session_id,data_key,scope,hostname,origin_hostname,classification,row_digest)
     SELECT $1::uuid,$2::uuid,$3::varchar,$4,$5,$6,$7,liekan_session_data_digest(d)
     FROM session_data d WHERE d.website_id=$1::uuid AND d.session_id=$2::uuid AND d.data_key=$3
     ON CONFLICT(website_id,session_id,data_key) DO UPDATE SET scope=EXCLUDED.scope,hostname=EXCLUDED.hostname,
       origin_hostname=EXCLUDED.origin_hostname,classification=EXCLUDED.classification,row_digest=EXCLUDED.row_digest,updated_at=clock_timestamp()`,
    websiteId,
    sessionId,
    dataKey,
    context.identity.scope,
    context.identity.hostname,
    context.identity.originHostname,
    context.identity.classification,
  );
  if (context.identity.scope === 'browser') context.invalidateIdentity = true;
}

export async function recordSessionLinkSource(
  websiteId: string,
  sessionId: string,
  distinctId: string,
) {
  const context = writes.getStore();
  if (!context?.identity) return;
  if (context.websiteId !== websiteId || context.identity.sessionId !== sessionId)
    throw new Error('Collection identity link crosses its source boundary');
  await context.client.$executeRawUnsafe(
    `INSERT INTO liekan_session_link_source(website_id,session_id,distinct_id,scope,hostname,origin_hostname,classification)
     VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7) ON CONFLICT(website_id,session_id,distinct_id) DO UPDATE SET
       hostname=EXCLUDED.hostname,origin_hostname=EXCLUDED.origin_hostname,classification=EXCLUDED.classification`,
    websiteId,
    sessionId,
    distinctId,
    context.identity.scope,
    context.identity.hostname,
    context.identity.originHostname,
    context.identity.classification,
  );
  if (context.identity.scope === 'browser') context.invalidateIdentity = true;
}

export async function recordEventQuality(
  tx: typeof prisma.client,
  eventId: string,
  websiteId: string,
): Promise<void> {
  const context = writes.getStore();
  if (!context) return;
  if (context.client !== tx || context.websiteId !== websiteId)
    throw new Error('Collection context does not match event');
  if (context.identity) {
    const i = context.identity;
    await tx.$executeRawUnsafe(
      `INSERT INTO liekan_event_environment(event_id,website_id,scope,identity_version,identity_available,browser,os,device,screen,language,origin_hostname,distinct_id)
       VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      eventId,
      websiteId,
      i.scope,
      i.version,
      i.available,
      i.browser,
      i.os,
      i.device,
      i.screen,
      i.language,
      i.originHostname,
      i.distinctId,
    );
  }
  if (context.geography) {
    const g = context.geography;
    await tx.$executeRawUnsafe(
      `INSERT INTO liekan_event_geography(event_id,website_id,country,region,city,source,trust,ip_family,precision,reason,rule_version,data_version,city_id,accuracy_radius,country_basis,processed_at,shadow)
       VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::timestamptz,$17::jsonb)`,
      eventId,
      websiteId,
      g.location.country || null,
      g.location.region || null,
      g.location.city?.slice(0, 80) || null,
      g.source,
      g.trust,
      g.ipFamily,
      g.precision,
      g.reason,
      g.ruleVersion,
      g.dataVersion,
      g.cityId,
      g.accuracyRadius,
      g.countryBasis,
      g.processedAt,
      g.shadow ? JSON.stringify(g.shadow) : null,
    );
  }
  if (context.geography) {
    // Live data retains the existing short TTL. Late data and earlier visit anchors invalidate closed windows.
    const changed = await tx.$executeRawUnsafe(
      `INSERT INTO liekan_analytics_revision(resource_type,resource_id,revision)
       SELECT 'website',$1::uuid,1 WHERE EXISTS(
         SELECT 1 FROM website_event current WHERE current.event_id=$2::uuid AND current.website_id=$1::uuid AND
           (current.created_at<clock_timestamp()-interval '60 seconds' OR EXISTS(
             SELECT 1 FROM website_event later WHERE later.website_id=current.website_id
             AND later.session_id=current.session_id AND later.visit_id=current.visit_id AND later.event_type NOT IN(2,5)
             AND (later.created_at,later.event_id)>(current.created_at,current.event_id)
           ))
       ) ON CONFLICT(resource_type,resource_id) DO UPDATE SET revision=liekan_analytics_revision.revision+1,updated_at=now()`,
      websiteId,
      eventId,
    );
    context.invalidateGeography = changed > 0;
  }
  const quality = context.quality;
  if (quality) {
    await tx.$executeRawUnsafe(
      `INSERT INTO liekan_event_quality
        (event_id,website_id,classification,source,reasons,rule_version,range_version,range_status,hostname,catalog_version,repair_scope_id)
       VALUES($1::uuid,$2::uuid,$3,$4,$5::text[],$6,$7,$8,$9,$10::uuid,$11::uuid)`,
      eventId,
      websiteId,
      quality.classification,
      quality.source,
      quality.reasons,
      quality.ruleVersion,
      quality.rangeVersion,
      quality.rangeStatus,
      quality.hostname,
      quality.catalogVersion ?? null,
      context.repairScopeId ?? null,
    );
  }
  if (context.observation && quality && ['browser', 'legacy_override'].includes(quality.source)) {
    const observation = context.observation;
    const inserted = await tx.$executeRawUnsafe(
      `INSERT INTO liekan_event_observation(event_id,website_id,epoch,version,event_at,received_at,features)
       SELECT e.event_id,e.website_id,coalesce(s.epoch,1),$3,e.created_at,$4::timestamptz,$5::jsonb
       FROM website_event e LEFT JOIN liekan_log_state s ON s.website_id=e.website_id
       WHERE e.event_id=$1::uuid AND e.website_id=$2::uuid AND e.event_type=1`,
      eventId,
      websiteId,
      observation.version,
      observation.receivedAt,
      JSON.stringify(observation.features),
    );
    if (inserted)
      await tx.$executeRawUnsafe(
        `INSERT INTO liekan_observation_state(website_id,epoch,first_received_at,last_received_at,last_version)
       SELECT website_id,epoch,received_at,received_at,version FROM liekan_event_observation WHERE event_id=$1::uuid
       ON CONFLICT(website_id) DO UPDATE SET
       first_received_at=CASE WHEN liekan_observation_state.epoch=EXCLUDED.epoch THEN least(liekan_observation_state.first_received_at,EXCLUDED.first_received_at) ELSE EXCLUDED.first_received_at END,
       last_received_at=greatest(liekan_observation_state.last_received_at,EXCLUDED.last_received_at),
       last_version=EXCLUDED.last_version,epoch=EXCLUDED.epoch`,
        eventId,
      );
  }
  if (context.eventId) {
    const updated = await tx.$executeRawUnsafe(
      `UPDATE liekan_collection_receipt SET event_id=$1::uuid
       WHERE website_id=$2::uuid AND client_event_id=$3::uuid`,
      eventId,
      websiteId,
      context.eventId,
    );
    if (updated !== 1) throw new Error('Collection receipt could not be linked');
  }
}

async function recordDiagnostic(tx: any, input: CollectionWriteInput, duplicate: boolean) {
  await tx.$executeRawUnsafe(
    `INSERT INTO liekan_collection_diagnostic_state(website_id) VALUES($1::uuid) ON CONFLICT DO NOTHING`,
    input.websiteId,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO liekan_collection_diagnostic(website_id,bucket,shard,written,with_uuid,duplicate)
     VALUES($1::uuid,date_trunc('minute',clock_timestamp()),$2,$3,$4,$5)
     ON CONFLICT(website_id,bucket,shard) DO UPDATE SET
       written=liekan_collection_diagnostic.written+EXCLUDED.written,
       with_uuid=liekan_collection_diagnostic.with_uuid+EXCLUDED.with_uuid,
       duplicate=liekan_collection_diagnostic.duplicate+EXCLUDED.duplicate,last_at=clock_timestamp()`,
    input.websiteId,
    randomInt(32),
    duplicate ? 0 : 1,
    !duplicate && input.eventId ? 1 : 0,
    duplicate ? 1 : 0,
  );
}

export async function withCollectionWrite<T>(
  input: CollectionWriteInput,
  work: () => Promise<T>,
): Promise<CollectionWriteResult<T>> {
  if (writes.getStore()) throw new Error('Nested collection writes are unsupported');
  const schema = getSchema() || 'public';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema))
    throw new Error('Invalid collection database schema');
  const primary = getRawQueryClient(prisma.client, { write: true }) as unknown as CollectionPrimary;
  let invalidateGeography = false;
  const result = await primary.$transaction<CollectionWriteResult<T>>(
    async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      // Shared readers serialize with website reset/deletion while allowing parallel collection.
      const websites = await tx.$queryRawUnsafe<any[]>(
        'SELECT website_id FROM website WHERE website_id=$1::uuid AND deleted_at IS NULL FOR SHARE',
        input.websiteId,
      );
      if (!websites.length) throw new Error('Collection website is unavailable');
      if (input.expectedPolicyRevision !== undefined) {
        const [policy] = await tx.$queryRawUnsafe<{ revision: string }[]>(
          'SELECT revision::text FROM liekan_collection_policy WHERE website_id=$1::uuid',
          input.websiteId,
        );
        if ((policy?.revision ?? '0') !== input.expectedPolicyRevision)
          throw new CollectionConflictError();
      }
      if (input.eventId) {
        const inserted = await tx.$queryRawUnsafe<{ client_event_id: string }[]>(
          `INSERT INTO liekan_collection_receipt(website_id,client_event_id,payload_hash,collection_source,collection_scope)
         VALUES($1::uuid,$2::uuid,$3,$4,$5)
         ON CONFLICT(website_id,client_event_id) DO NOTHING RETURNING client_event_id`,
          input.websiteId,
          input.eventId,
          input.fingerprint,
          input.quality?.source ?? null,
          input.identity?.scope ?? input.quality?.source ?? null,
        );
        if (!inserted.length) {
          const receipt = await tx.$queryRawUnsafe<
            {
              payload_hash: string;
              session_id: string | null;
              visit_id: string | null;
              collection_source: string | null;
              collection_scope: string | null;
            }[]
          >(
            `SELECT r.payload_hash,e.session_id::text,e.visit_id::text,coalesce(r.collection_source,q.source) AS collection_source,
              coalesce(r.collection_scope,env.scope,q.source) AS collection_scope
             FROM liekan_collection_receipt r
             LEFT JOIN website_event e ON e.event_id=r.event_id AND e.website_id=r.website_id
             LEFT JOIN liekan_event_quality q ON q.event_id=r.event_id AND q.website_id=r.website_id
             LEFT JOIN liekan_event_environment env ON env.event_id=r.event_id AND env.website_id=r.website_id
             WHERE r.website_id=$1::uuid AND r.client_event_id=$2::uuid`,
            input.websiteId,
            input.eventId,
          );
          if (!receipt.length) throw new Error('Collection receipt is unavailable');
          if (receipt[0].payload_hash !== input.fingerprint) throw new CollectionConflictError();
          if (input.quality && receipt[0].collection_source !== input.quality.source)
            throw new CollectionConflictError();
          if (input.identity && receipt[0].collection_scope !== input.identity.scope)
            throw new CollectionConflictError();
          if (!receipt[0].session_id || !receipt[0].visit_id)
            throw new Error('Collection receipt is unavailable');
          await recordDiagnostic(tx, input, true);
          return {
            status: 'duplicate',
            sessionId: receipt[0].session_id,
            visitId: receipt[0].visit_id,
          };
        }
      }
      const quality = input.quality
        ? { ...input.quality, reasons: [...input.quality.reasons] }
        : undefined;
      const context: CollectionWriteContext = {
        ...input,
        quality,
        client: tx as typeof prisma.client,
        repairScopeId: await collectionRepairScope(tx, input.websiteId),
      };
      const value = await writes.run(context, work);
      if (context.invalidateIdentity) await bumpAnalyticsRevision(tx, 'website', input.websiteId);
      invalidateGeography = !!(context.invalidateGeography || context.invalidateIdentity);
      if (!input.identify) await recordDiagnostic(tx, input, false);
      return { status: 'written', value };
    },
    { isolationLevel: 'ReadCommitted', maxWait: 10000, timeout: 30000 },
  );
  if (result.status === 'written' && invalidateGeography)
    analyticsCache.invalidate(websiteCacheTag(input.websiteId));
  return result;
}
