import { randomUUID } from 'node:crypto';
import { aiSpaceFromRow } from '../upstream/ai-access';
import { type AiTx, aiTransaction } from '../upstream/ai-db';
import type { AiConnectionRow } from './connections';
import { type AiEncryptionKey, decryptAiKey, encryptAiKey } from './crypto';
import { AiError } from './error';

const inactiveConversation =
  "NOT EXISTS(SELECT 1 FROM liekan_ai_run r WHERE r.conversation_id=c.id AND r.lease_until>now() AND r.state IN ('accepted','preparing','calling','validating','cancel_requested'))";
const expiredConversation = `c.expires_at<=now() AND ${inactiveConversation}`;
const expiredContent = (table: 'liekan_ai_message' | 'liekan_ai_context') =>
  `expires_at<=now() OR EXISTS(SELECT 1 FROM liekan_ai_conversation c WHERE c.id=${table}.conversation_id AND ${expiredConversation})`;
const expiredTitle = `c.expires_at>now() AND c.created_at<=now()-interval '90 days' AND c.title NOT IN ('新的分析','网站分析') AND ${inactiveConversation}`;
const expiredRunReference = `r.expires_at>now() AND EXISTS(SELECT 1 FROM liekan_ai_conversation c WHERE c.id=r.conversation_id AND ${expiredConversation})`;
const expiredEmptyConversation =
  'expires_at<=now() AND NOT EXISTS(SELECT 1 FROM liekan_ai_message m WHERE m.conversation_id=liekan_ai_conversation.id) AND NOT EXISTS(SELECT 1 FROM liekan_ai_context c WHERE c.conversation_id=liekan_ai_conversation.id) AND NOT EXISTS(SELECT 1 FROM liekan_ai_run r WHERE r.conversation_id=liekan_ai_conversation.id)';
const backlogSql =
  `(SELECT count(*) FROM liekan_ai_message WHERE ${expiredContent('liekan_ai_message')})+` +
  `(SELECT count(*) FROM liekan_ai_context WHERE ${expiredContent('liekan_ai_context')})+` +
  `(SELECT count(*) FROM liekan_ai_conversation c WHERE (${expiredConversation}) OR (${expiredTitle}))+` +
  `(SELECT count(*) FROM liekan_ai_run r WHERE r.expires_at<=now() OR (r.expires_at>now() AND r.result_expires_at<=now() AND r.test_result IS NOT NULL) OR (${expiredRunReference}))+` +
  `(SELECT count(*) FROM liekan_ai_audit WHERE expires_at<=now())`;

async function present(tx: AiTx) {
  const [row] = await tx.query<{ present: boolean }>(
    "SELECT to_regclass('liekan_ai_maintenance') IS NOT NULL AS present",
  );
  return row.present;
}
export async function aiMaintenanceCheck() {
  return aiTransaction(async tx => {
    if (!(await present(tx))) return { installed: false };
    const [row] = await tx.query(
      `SELECT (SELECT count(*) FROM liekan_ai_connection) AS connections,(SELECT count(*) FROM liekan_ai_connection WHERE secret_envelope IS NOT NULL) AS encryptedKeys,(SELECT count(*) FROM liekan_ai_message) AS messages,(SELECT count(*) FROM liekan_ai_context) AS contexts,(SELECT count(*) FROM liekan_ai_run WHERE state IN ('accepted','preparing','calling','validating','cancel_requested') AND lease_until>now()) AS activeRuns,${backlogSql} AS backlog`,
    );
    const [status] = await tx.query<{
      last_cleanup_at: Date | null;
      last_error_code: string | null;
      backlog: bigint;
      updated_at: Date;
    }>(
      'SELECT last_cleanup_at,last_error_code,backlog,updated_at FROM liekan_ai_maintenance WHERE id=1',
    );
    const maintenance = status
      ? {
          last_cleanup_at: status.last_cleanup_at,
          last_error_code: status.last_error_code,
          backlog: status.backlog.toString(),
          updated_at: status.updated_at,
        }
      : null;
    return {
      installed: true,
      ...Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          typeof value === 'bigint' ? value.toString() : value,
        ]),
      ),
      maintenance,
    };
  });
}
async function performAiCleanup(options: { apply?: boolean; requestBudget?: boolean } = {}) {
  if (!options.apply) return aiMaintenanceCheck();
  return aiTransaction(
    async tx => {
      if (!(await present(tx))) return { installed: false, deleted: 0 };
      const [lock] = await tx.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_xact_lock(12800072) AS locked',
      );
      if (!lock.locked) return { skipped: true, deleted: 0 };
      let deleted = 0,
        cleared = 0,
        detached = 0;
      const remaining = () => 500 - deleted - cleared - detached;
      const remove = async (table: string, condition: string) => {
        if (remaining() <= 0) return;
        deleted += await tx.execute(
          `DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} WHERE ${condition} ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED)`,
          remaining(),
        );
      };
      await tx.execute(
        "UPDATE liekan_ai_run SET state=CASE WHEN state='cancel_requested' THEN 'cancelled' ELSE 'interrupted' END,stage=CASE WHEN state='cancel_requested' THEN 'cancelled' ELSE 'interrupted' END,error_code=CASE WHEN state='cancel_requested' THEN 'cancelled' ELSE 'interrupted' END,completed_at=now(),lease_until=NULL WHERE id IN (SELECT id FROM liekan_ai_run WHERE state IN ('accepted','preparing','calling','validating','cancel_requested') AND lease_until<=now() ORDER BY lease_until LIMIT 3 FOR UPDATE SKIP LOCKED)",
      );
      await remove('liekan_ai_message', expiredContent('liekan_ai_message'));
      await remove('liekan_ai_context', expiredContent('liekan_ai_context'));
      if (remaining() > 0)
        cleared += await tx.execute(
          `UPDATE liekan_ai_conversation SET title='网站分析' WHERE id IN (SELECT c.id FROM liekan_ai_conversation c WHERE ${expiredTitle} ORDER BY c.created_at,c.id LIMIT $1 FOR UPDATE OF c SKIP LOCKED)`,
          remaining(),
        );
      await remove('liekan_ai_run', 'expires_at<=now()');
      if (remaining() > 0)
        detached += await tx.execute(
          `UPDATE liekan_ai_run SET conversation_id=NULL WHERE id IN (SELECT r.id FROM liekan_ai_run r WHERE ${expiredRunReference} ORDER BY r.created_at,r.id LIMIT $1 FOR UPDATE OF r SKIP LOCKED)`,
          remaining(),
        );
      await remove('liekan_ai_conversation', expiredEmptyConversation);
      await remove('liekan_ai_audit', 'expires_at<=now()');
      if (remaining() > 0)
        cleared += await tx.execute(
          'UPDATE liekan_ai_run SET test_result=NULL WHERE id IN (SELECT id FROM liekan_ai_run WHERE result_expires_at<=now() AND test_result IS NOT NULL LIMIT $1 FOR UPDATE SKIP LOCKED)',
          remaining(),
        );
      await tx.execute(
        `UPDATE liekan_ai_maintenance SET last_cleanup_at=now(),last_error_code=NULL,backlog=${backlogSql},updated_at=now() WHERE id=1`,
      );
      return { installed: true, deleted, cleared, detached };
    },
    {
      timeout: options.requestBudget ? 700 : 5000,
      ...(options.requestBudget ? { transactionTimeout: 750, maxWait: 50 } : {}),
    },
  );
}
export async function cleanupAiData(options: { apply?: boolean; requestBudget?: boolean } = {}) {
  try {
    return await performAiCleanup(options);
  } catch {
    if (options.apply)
      try {
        await aiTransaction(
          async tx => {
            if (await present(tx))
              await tx.execute(
                "UPDATE liekan_ai_maintenance SET last_error_code='cleanup_unavailable',updated_at=now() WHERE id=1",
              );
          },
          { timeout: 75, transactionTimeout: 100, maxWait: 25 },
        );
      } catch {
        /* A later maintenance check reports the overdue cleanup even when the database is unavailable. */
      }
    throw new AiError('cleanup_unavailable', 'AI 到期清理暂未完成，请检查维护状态', 503);
  }
}
async function requireOffline(tx: AiTx) {
  if (process.env.LIEKAN_AI_ENABLED === 'true')
    throw new AiError('maintenance_required', '请停用所有 AI 实例后执行维护');
  await tx.execute('SELECT pg_advisory_xact_lock(12800072)');
  await tx.execute(
    'LOCK TABLE liekan_ai_connection,liekan_ai_run,liekan_ai_conversation,liekan_ai_message,liekan_ai_context IN ACCESS EXCLUSIVE MODE',
  );
  const [row] = await tx.query<{ active: bigint }>(
    "SELECT count(*) AS active FROM liekan_ai_run WHERE state IN ('accepted','preparing','calling','validating','cancel_requested') AND lease_until>now()",
  );
  if (row.active > 0n)
    throw new AiError('maintenance_required', '仍有有效 AI 执行租约，请确认实例停用后等待租约到期');
}
export async function rotateAiKeys(newKey: AiEncryptionKey, oldKey?: AiEncryptionKey) {
  return aiTransaction(
    async tx => {
      await requireOffline(tx);
      let cursor: string | null = null,
        count = 0;
      for (;;) {
        const rows = await tx.query<AiConnectionRow>(
          'SELECT * FROM liekan_ai_connection WHERE secret_envelope IS NOT NULL AND ($1::uuid IS NULL OR id>$1::uuid) ORDER BY id LIMIT 100 FOR UPDATE',
          cursor,
        );
        if (!rows.length) break;
        for (const row of rows) {
          const binding = { connectionId: row.id, space: aiSpaceFromRow(row) };
          const plaintext = decryptAiKey(row.secret_envelope, binding, oldKey);
          const envelope = encryptAiKey(plaintext, binding, newKey);
          if (decryptAiKey(envelope, binding, newKey) !== plaintext)
            throw new AiError('rotation_failed', '新密钥校验失败，已撤销本次轮换', 500);
          await tx.execute(
            'UPDATE liekan_ai_connection SET secret_envelope=$2::jsonb WHERE id=$1::uuid',
            row.id,
            JSON.stringify(envelope),
          );
          count++;
        }
        cursor = rows[rows.length - 1].id;
      }
      return { rotated: count };
    },
    { timeout: 299000 },
  );
}
export async function resetRestoredAiData() {
  return aiTransaction(
    async tx => {
      await requireOffline(tx);
      await tx.execute(
        "UPDATE liekan_ai_run SET state=CASE WHEN state IN ('accepted','preparing','calling','validating','cancel_requested') THEN 'invalidated' ELSE state END,lease_until=NULL,completed_at=COALESCE(completed_at,now()),test_result=NULL,error_code=CASE WHEN state IN ('accepted','preparing','calling','validating','cancel_requested') THEN 'invalidated' ELSE error_code END",
      );
      await tx.execute('DELETE FROM liekan_ai_conversation');
      await tx.execute(
        'UPDATE liekan_ai_connection SET secret_envelope=NULL,is_default=false,test_state=\'untested\',verified_config_version=NULL,tested_at=NULL,config_version=config_version+1,row_version=row_version+1,capabilities=jsonb_set(capabilities,\'{keyVerified}\',\'{"text":null,"stream":null,"structuredOutput":null,"tools":null,"usage":null}\'::jsonb),updated_at=now()',
      );
      await tx.execute(
        'UPDATE liekan_ai_website_state SET epoch=gen_random_uuid(),updated_at=now()',
      );
      return { reset: true, restoreId: randomUUID() };
    },
    { timeout: 299000 },
  );
}
