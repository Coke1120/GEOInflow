import { AsyncLocalStorage } from 'node:async_hooks';
import prisma, { getRawQueryClient, getSchema } from '@/lib/prisma';
import type { CollectionQuality } from './collection-quality';
import { processSingleton } from './process-singleton';

export interface CollectionWriteInput {
  websiteId: string;
  eventId?: string;
  fingerprint: string;
  quality?: CollectionQuality;
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

export async function recordEventQuality(
  tx: typeof prisma.client,
  eventId: string,
  websiteId: string,
): Promise<void> {
  const context = writes.getStore();
  if (!context) return;
  if (context.client !== tx || context.websiteId !== websiteId)
    throw new Error('Collection context does not match event');
  const quality = context.quality;
  if (quality) {
    await tx.$executeRawUnsafe(
      `INSERT INTO liekan_event_quality
        (event_id,website_id,classification,source,reasons,rule_version,range_version,range_status,hostname)
       VALUES($1::uuid,$2::uuid,$3,$4,$5::text[],$6,$7,$8,$9)`,
      eventId,
      websiteId,
      quality.classification,
      quality.source,
      quality.reasons,
      quality.ruleVersion,
      quality.rangeVersion,
      quality.rangeStatus,
      quality.hostname,
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

export async function withCollectionWrite<T>(
  input: CollectionWriteInput,
  work: () => Promise<T>,
): Promise<CollectionWriteResult<T>> {
  if (writes.getStore()) throw new Error('Nested collection writes are unsupported');
  const schema = getSchema() || 'public';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema))
    throw new Error('Invalid collection database schema');
  const primary = getRawQueryClient(prisma.client, { write: true }) as unknown as CollectionPrimary;
  return primary.$transaction<CollectionWriteResult<T>>(
    async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      if (input.eventId) {
        const inserted = await tx.$queryRawUnsafe<{ client_event_id: string }[]>(
          `INSERT INTO liekan_collection_receipt(website_id,client_event_id,payload_hash)
         VALUES($1::uuid,$2::uuid,$3)
         ON CONFLICT(website_id,client_event_id) DO NOTHING RETURNING client_event_id`,
          input.websiteId,
          input.eventId,
          input.fingerprint,
        );
        if (!inserted.length) {
          const receipt = await tx.$queryRawUnsafe<
            {
              payload_hash: string;
              session_id: string | null;
              visit_id: string | null;
            }[]
          >(
            `SELECT r.payload_hash,e.session_id::text,e.visit_id::text
             FROM liekan_collection_receipt r
             LEFT JOIN website_event e ON e.event_id=r.event_id AND e.website_id=r.website_id
             WHERE r.website_id=$1::uuid AND r.client_event_id=$2::uuid`,
            input.websiteId,
            input.eventId,
          );
          if (!receipt.length) throw new Error('Collection receipt is unavailable');
          if (receipt[0].payload_hash !== input.fingerprint) throw new CollectionConflictError();
          if (!receipt[0].session_id || !receipt[0].visit_id)
            throw new Error('Collection receipt is unavailable');
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
      const value = await writes.run(
        { ...input, quality, client: tx as typeof prisma.client },
        work,
      );
      return { status: 'written', value };
    },
    { isolationLevel: 'ReadCommitted', maxWait: 10000, timeout: 30000 },
  );
}
