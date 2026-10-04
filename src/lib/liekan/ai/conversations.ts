import { randomUUID } from 'node:crypto';
import type { AiFactsContext } from './facts-contracts';
import { z } from 'zod';
import { aiTransaction, type AiTx } from '../upstream/ai-db';
import { authorizeAiWebsite, aiSpaceFromRow, aiId, type AiActor } from '../upstream/ai-access';
import { AiError } from './error';
import { requireAiEnabled } from './connections';
export interface AiConversationRow {
  id: string;
  creator_id: string;
  owner_user_id: string | null;
  team_id: string | null;
  website_id: string;
  website_epoch: string;
  title: string;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
}
export async function loadAiConversation(
  tx: AiTx,
  actor: AiActor,
  id: string,
  paid = false,
  lock = false,
) {
  id = aiId(id);
  const [row] = await tx.query<AiConversationRow>(
    'SELECT * FROM liekan_ai_conversation WHERE id=$1::uuid AND creator_id=$2::uuid AND expires_at>now()',
    id,
    actor.id,
  );
  if (!row) throw new AiError('resource_unavailable', '对话不可访问或已到期', 404);
  const site = await authorizeAiWebsite(tx, actor, row.website_id, paid);
  const space = aiSpaceFromRow(row);
  if (space.kind !== site.space.kind || space.id !== site.space.id)
    throw new AiError('resource_unavailable', '对话归属已变更', 404);
  const [state] = await tx.query<{ epoch: string }>(
    'SELECT epoch FROM liekan_ai_website_state WHERE website_id=$1::uuid AND owner_user_id IS NOT DISTINCT FROM $2::uuid AND team_id IS NOT DISTINCT FROM $3::uuid FOR SHARE',
    row.website_id,
    row.owner_user_id,
    row.team_id,
  );
  if (!state || state.epoch !== row.website_epoch)
    throw new AiError('resource_unavailable', '网站数据已更新，请新建对话', 404);
  if (lock) {
    const [locked] = await tx.query<AiConversationRow>(
      'SELECT * FROM liekan_ai_conversation WHERE id=$1::uuid AND creator_id=$2::uuid AND expires_at>now() FOR UPDATE',
      id,
      actor.id,
    );
    if (!locked || locked.website_epoch !== state.epoch)
      throw new AiError('resource_unavailable', '对话已清理或到期', 404);
    return { row: locked, site, space };
  }
  return { row, site, space };
}
function publicConversation(row: AiConversationRow) {
  return {
    id: row.id,
    websiteId: row.website_id,
    // Continued activity preserves the original automatic question-title deadline.
    title: row.created_at.getTime() <= Date.now() - 90 * 86400000 ? '网站分析' : row.title,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  };
}
export async function createAiConversation(actor: AiActor, input: unknown) {
  requireAiEnabled();
  const p = z.strictObject({ websiteId: z.uuid() }).safeParse(input);
  if (!p.success) throw new AiError('invalid_request', '请选择明确的网站');
  return aiTransaction(async tx => {
    const site = await authorizeAiWebsite(tx, actor, p.data.websiteId);
    await tx.execute(
      'INSERT INTO liekan_ai_website_state(website_id,epoch,owner_user_id,team_id) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid) ON CONFLICT(website_id) DO NOTHING',
      site.id,
      randomUUID(),
      site.ownerUserId,
      site.teamId,
    );
    const [state] = await tx.query<{
      epoch: string;
      owner_user_id: string | null;
      team_id: string | null;
    }>(
      'SELECT epoch,owner_user_id,team_id FROM liekan_ai_website_state WHERE website_id=$1::uuid FOR SHARE',
      site.id,
    );
    if (!state || state.owner_user_id !== site.ownerUserId || state.team_id !== site.teamId)
      throw new AiError('resource_unavailable', '网站归属已更新，请刷新', 409);
    const [row] = await tx.query<AiConversationRow>(
      'INSERT INTO liekan_ai_conversation(id,creator_id,owner_user_id,team_id,website_id,website_epoch) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid) RETURNING *',
      randomUUID(),
      actor.id,
      site.ownerUserId,
      site.teamId,
      site.id,
      state.epoch,
    );
    return { protocolVersion: 1, ...publicConversation(row) };
  });
}
const cursorSchema = z.strictObject({ date: z.iso.datetime(), id: z.uuid() });
function cursorInput(cursor?: string) {
  if (!cursor) return null;
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString()));
  } catch {
    throw new AiError('invalid_cursor', '列表位置无效，请刷新');
  }
}
export async function listAiConversations(
  actor: AiActor,
  websiteId: string,
  cursor?: string,
  limit = 25,
) {
  requireAiEnabled();
  aiId(websiteId);
  limit = Math.min(50, Math.max(1, limit));
  const c = cursorInput(cursor);
  return aiTransaction(async tx => {
    await authorizeAiWebsite(tx, actor, websiteId);
    const rows = await tx.query<AiConversationRow>(
      'SELECT c.* FROM liekan_ai_conversation c JOIN liekan_ai_website_state s ON s.website_id=c.website_id AND s.epoch=c.website_epoch WHERE c.creator_id=$1::uuid AND c.website_id=$2::uuid AND c.expires_at>now() AND ($3::timestamptz IS NULL OR (c.updated_at,c.id)<($3::timestamptz,$4::uuid)) ORDER BY c.updated_at DESC,c.id DESC LIMIT $5',
      actor.id,
      websiteId,
      c?.date ?? null,
      c?.id ?? null,
      limit + 1,
    );
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      protocolVersion: 1,
      items: items.map(publicConversation),
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({ date: last.updated_at.toISOString(), id: last.id }),
            ).toString('base64url')
          : null,
    };
  });
}
export async function getAiConversation(actor: AiActor, id: string) {
  return aiTransaction(async tx => ({
    protocolVersion: 1,
    ...publicConversation((await loadAiConversation(tx, actor, id)).row),
  }));
}
export async function deleteAiConversation(actor: AiActor, id: string) {
  return aiTransaction(async tx => {
    await loadAiConversation(tx, actor, id, false, true);
    await tx.execute(
      "UPDATE liekan_ai_run SET state=CASE WHEN state IN ('accepted','preparing','calling','validating','cancel_requested') THEN 'invalidated' ELSE state END,completed_at=COALESCE(completed_at,now()),lease_until=NULL,stage=CASE WHEN state IN ('accepted','preparing','calling','validating','cancel_requested') THEN 'invalidated' ELSE stage END WHERE conversation_id=$1::uuid",
      id,
    );
    await tx.execute(
      'DELETE FROM liekan_ai_conversation WHERE id=$1::uuid AND creator_id=$2::uuid',
      id,
      actor.id,
    );
    return { deleted: true };
  });
}
export async function getAiMessages(actor: AiActor, id: string, cursor?: string, limit = 20) {
  const c = cursorInput(cursor);
  limit = Math.min(50, Math.max(1, limit));
  return aiTransaction(async tx => {
    await loadAiConversation(tx, actor, id);
    const rows = await tx.query<any>(
      'SELECT m.id,m.run_id AS "runId",m.context_id AS "contextId",m.question,m.result,m.origin,m.created_at AS "createdAt",m.expires_at AS "expiresAt",r.state FROM liekan_ai_message m LEFT JOIN liekan_ai_run r ON r.id=m.run_id WHERE m.conversation_id=$1::uuid AND m.expires_at>now() AND ($2::timestamptz IS NULL OR (m.created_at,m.id)<($2::timestamptz,$3::uuid)) ORDER BY m.created_at DESC,m.id DESC LIMIT $4',
      id,
      c?.date ?? null,
      c?.id ?? null,
      limit + 1,
    );
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    const body = {
      protocolVersion: 1,
      items,
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({ date: last.createdAt.toISOString(), id: last.id }),
            ).toString('base64url')
          : null,
    };
    if (Buffer.byteLength(JSON.stringify(body)) > 2 * 1024 * 1024)
      throw new AiError('response_limit', '历史内容较多，请减少每页条数', 413);
    return body;
  });
}
export async function getAiContext(actor: AiActor, conversationId: string, id: string) {
  aiId(id);
  return aiTransaction(async tx => {
    const { row } = await loadAiConversation(tx, actor, conversationId);
    const [context] = await tx.query<{
      id: string;
      facts: AiFactsContext;
      checksum: string;
      createdAt: Date;
      expiresAt: Date;
    }>(
      'SELECT id,facts,checksum,created_at AS "createdAt",expires_at AS "expiresAt" FROM liekan_ai_context WHERE id=$1::uuid AND conversation_id=$2::uuid AND website_epoch=$3::uuid AND expires_at>now()',
      id,
      conversationId,
      row.website_epoch,
    );
    if (!context) throw new AiError('context_expired', '生成时依据不可访问或已到期', 404);
    return { protocolVersion: 1, ...context };
  });
}
