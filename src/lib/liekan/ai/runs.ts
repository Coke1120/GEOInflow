import { aiProviderResponseSchema } from './contracts';
import { randomUUID } from 'node:crypto';
import {
  aiErrorCodeSchema,
  aiRunSchema,
  safeAiError,
  type AiRunState,
  type AiUsage,
} from './contracts';
import { AiError } from './error';
import { hashAiRequest } from './request';
import { loadAiConnection, requireAiEnabled, type AiConnectionRow } from './connections';
import { loadAiConversation } from './conversations';
import { aiTransaction, type AiTx } from '../upstream/ai-db';
import { aiId, aiSpaceFromRow, authorizeAiSpace, type AiActor } from '../upstream/ai-access';
export const AI_TERMINAL = new Set<AiRunState>([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
  'invalidated',
]);
export interface AiRunRow {
  id: string;
  creator_id: string | null;
  identity_id: string;
  owner_user_id: string | null;
  team_id: string | null;
  client_request_id: string;
  request_hash: string;
  operation: 'test' | 'analysis';
  connection_id: string | null;
  connection_snapshot: any;
  config_version: number;
  test_sequence: number | null;
  website_id: string | null;
  website_epoch: string | null;
  conversation_id: string | null;
  state: AiRunState;
  stage: string;
  lease_token: string | null;
  lease_until: Date | null;
  call_attempted: boolean;
  daily_reserved: boolean;
  error_code: string | null;
  error_message: string | null;
  usage: AiUsage | null;
  test_result: any;
  ttft_ms: number | null;
  latency_ms: number | null;
  created_at: Date;
  completed_at: Date | null;
  expires_at: Date;
  result_expires_at: Date;
}
export interface AiRunInput {
  operation: 'test' | 'analysis';
  targetId: string;
  clientRequestId: string;
  expectedConfigVersion: number;
  connectionId?: string;
  localOnly?: boolean;
  question?: string;
  startAt?: string;
  endAt?: string;
  timezone?: string;
}
export interface AiRunHandle {
  row: AiRunRow;
  token: string | null;
  connection: AiConnectionRow | null;
  fresh: boolean;
}
export async function loadOwnedAiRun(tx: AiTx, actor: AiActor, id: string) {
  id = aiId(id);
  const [row] = await tx.query<AiRunRow>(
    'SELECT * FROM liekan_ai_run WHERE id=$1::uuid AND creator_id=$2::uuid AND expires_at>now()',
    id,
    actor.id,
  );
  if (!row) throw new AiError('resource_unavailable', '任务不可访问或已到期', 404);
  if (row.operation === 'analysis') {
    if (!row.conversation_id) throw new AiError('resource_unavailable', '对话内容已清理', 404);
    await loadAiConversation(tx, actor, row.conversation_id);
  } else await authorizeAiSpace(tx, actor, aiSpaceFromRow(row));
  return row;
}
async function dto(tx: AiTx, row: AiRunRow) {
  let result: any;
  if (row.state === 'completed' && row.result_expires_at.getTime() > Date.now()) {
    if (row.operation === 'test') result = row.test_result ?? undefined;
    else if (row.conversation_id) {
      const [message] = await tx.query(
        'SELECT result,context_id AS "contextId",origin FROM liekan_ai_message WHERE run_id=$1::uuid AND conversation_id=$2::uuid AND expires_at>now()',
        row.id,
        row.conversation_id,
      );
      if (message?.result)
        result = { ...message.result, contextId: message.contextId, origin: message.origin };
    }
  }
  if (
    row.state !== 'completed' &&
    AI_TERMINAL.has(row.state) &&
    row.result_expires_at.getTime() > Date.now()
  ) {
    const metadata = aiProviderResponseSchema.safeParse(row.test_result?.providerResponse);
    if (metadata.success) result = { providerResponse: metadata.data };
  }
  const parsedCode = aiErrorCodeSchema.safeParse(row.error_code);
  const error = row.error_code
    ? safeAiError(parsedCode.success ? parsedCode.data : 'upstream')
    : null;
  return {
    ...aiRunSchema.parse({
      protocolVersion: 1,
      id: row.id,
      clientRequestId: row.client_request_id,
      operation: row.operation,
      state: row.state,
      connectionId: row.connection_id,
      configVersion: row.config_version,
      startedAt: row.created_at.toISOString(),
      completedAt: row.completed_at?.toISOString() ?? null,
      error,
      ttftMs: row.ttft_ms,
      latencyMs: row.latency_ms,
      callAttempted: row.call_attempted,
      usage: row.usage,
      result,
    }),
    stage: row.stage,
  };
}
export async function getAiRun(actor: AiActor, id: string) {
  return aiTransaction(async tx => dto(tx, await loadOwnedAiRun(tx, actor, id)));
}
export async function findAiRun(actor: AiActor, clientRequestId: string) {
  aiId(clientRequestId);
  return aiTransaction(async tx => {
    const [row] = await tx.query<AiRunRow>(
      'SELECT id FROM liekan_ai_run WHERE creator_id=$1::uuid AND client_request_id=$2::uuid AND expires_at>now()',
      actor.id,
      clientRequestId,
    );
    if (!row) throw new AiError('resource_unavailable', '未找到该请求', 404);
    return dto(tx, await loadOwnedAiRun(tx, actor, row.id));
  });
}
export async function expireAiRuns(tx: AiTx) {
  await tx.execute(
    "UPDATE liekan_ai_run SET state=CASE WHEN state='cancel_requested' THEN 'cancelled' ELSE 'interrupted' END,stage=CASE WHEN state='cancel_requested' THEN 'cancelled' ELSE 'interrupted' END,completed_at=now(),lease_until=NULL,error_code=CASE WHEN state='cancel_requested' THEN 'cancelled' ELSE 'interrupted' END WHERE state IN ('accepted','preparing','calling','validating','cancel_requested') AND (lease_until IS NULL OR lease_until<=now())",
  );
}
export async function acceptAiRun(actor: AiActor, input: AiRunInput): Promise<AiRunHandle> {
  requireAiEnabled();
  if (input.localOnly && (input.operation !== 'analysis' || input.connectionId))
    throw new AiError('invalid_request', '本地指引不能同时选择收费模型');
  input = {
    ...input,
    clientRequestId: aiId(input.clientRequestId),
    targetId: aiId(input.targetId),
    ...(input.connectionId ? { connectionId: aiId(input.connectionId) } : {}),
    ...(input.startAt ? { startAt: new Date(input.startAt).toISOString() } : {}),
    ...(input.endAt ? { endAt: new Date(input.endAt).toISOString() } : {}),
  };
  const requestHash = hashAiRequest({ ...input, clientRequestId: undefined });
  return aiTransaction(async tx => {
    const [prior] = await tx.query<AiRunRow>(
      'SELECT * FROM liekan_ai_run WHERE identity_id=$1::uuid AND client_request_id=$2::uuid',
      actor.id,
      input.clientRequestId,
    );
    if (prior) {
      if (prior.request_hash !== requestHash)
        throw new AiError('conflict', '相同请求标识对应的内容已变更，请重新发起', 409);
      return {
        row: await loadOwnedAiRun(tx, actor, prior.id),
        token: null,
        connection: null,
        fresh: false,
      };
    }
    let conversation: Awaited<ReturnType<typeof loadAiConversation>> | null = null;
    let connectionId = input.operation === 'test' ? input.targetId : input.connectionId;
    if (input.operation === 'analysis') {
      conversation = await loadAiConversation(tx, actor, input.targetId, true, true);
      if (!connectionId && !input.localOnly) {
        const [candidate] = await tx.query<{ id: string }>(
          'SELECT id FROM liekan_ai_connection WHERE is_default AND owner_user_id IS NOT DISTINCT FROM $1::uuid AND team_id IS NOT DISTINCT FROM $2::uuid',
          conversation.row.owner_user_id,
          conversation.row.team_id,
        );
        connectionId = candidate?.id;
      }
    }
    let connection: AiConnectionRow | null = null;
    let space = conversation?.space;
    if (connectionId) {
      const loaded = await loadAiConnection(
        tx,
        actor,
        connectionId,
        input.operation === 'test' ? 'manage' : 'use',
        true,
      );
      connection = loaded.row;
      if (space && (space.kind !== loaded.space.kind || space.id !== loaded.space.id))
        throw new AiError('resource_unavailable', '连接与网站所属空间不匹配', 404);
      space = loaded.space;
      if (connection.config_version !== input.expectedConfigVersion)
        throw new AiError('conflict', '模型配置已变更，请刷新后重试', 409);
      if (!connection.enabled || !connection.secret_envelope)
        throw new AiError('connection_disabled', '连接已停用或尚未填写 API Key', 409);
      if (
        input.operation === 'analysis' &&
        (connection.verified_config_version !== connection.config_version ||
          connection.test_state !== 'connected')
      )
        throw new AiError('test_required', '请先完成所选 API 的实时测试', 409);
    }
    if (!space) throw new AiError('invalid_request', '请求没有有效空间');
    await tx.execute('SELECT pg_advisory_xact_lock(12800071)');
    const [raced] = await tx.query<AiRunRow>(
      'SELECT * FROM liekan_ai_run WHERE identity_id=$1::uuid AND client_request_id=$2::uuid',
      actor.id,
      input.clientRequestId,
    );
    if (raced) {
      if (raced.request_hash !== requestHash)
        throw new AiError('conflict', '请求标识对应的内容已变更', 409);
      return {
        row: await loadOwnedAiRun(tx, actor, raced.id),
        token: null,
        connection: null,
        fresh: false,
      };
    }
    await expireAiRuns(tx);
    const [counts] = await tx.query<{ global: bigint; user: bigint; minute: bigint; day: bigint }>(
      "SELECT count(*) FILTER(WHERE state IN ('accepted','preparing','calling','validating','cancel_requested')) AS global,count(*) FILTER(WHERE identity_id=$1::uuid AND state IN ('accepted','preparing','calling','validating','cancel_requested')) AS user,count(*) FILTER(WHERE identity_id=$1::uuid AND created_at>now()-interval '1 minute') AS minute,count(*) FILTER(WHERE owner_user_id IS NOT DISTINCT FROM $2::uuid AND team_id IS NOT DISTINCT FROM $3::uuid AND daily_reserved AND created_at>=(date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')) AS day FROM liekan_ai_run WHERE (state IN ('accepted','preparing','calling','validating','cancel_requested')) OR created_at>=LEAST((date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),now()-interval '1 minute')",
      actor.id,
      space.kind === 'personal' ? space.id : null,
      space.kind === 'team' ? space.id : null,
    );
    if (Number(counts.global) >= 3 || Number(counts.user) >= 1)
      throw new AiError('busy', '已有 AI 任务正在运行，请稍后再试', 429, 10);
    if (Number(counts.minute) >= 10)
      throw new AiError('frequency_limit', '发起过于频繁，请稍后再试', 429, 60);
    if (Number(counts.day) >= 100)
      throw new AiError(
        'daily_limit',
        '当前空间今日 AI 次数已用完',
        429,
        Math.ceil(
          (Date.UTC(
            new Date().getUTCFullYear(),
            new Date().getUTCMonth(),
            new Date().getUTCDate() + 1,
          ) -
            Date.now()) /
            1000,
        ),
      );
    let testSequence: number | null = null;
    if (input.operation === 'test' && connection) {
      const [changed] = await tx.query<{ test_sequence: number }>(
        'UPDATE liekan_ai_connection SET test_sequence=test_sequence+1,row_version=row_version+1,updated_at=now() WHERE id=$1::uuid RETURNING test_sequence',
        connection.id,
      );
      testSequence = changed.test_sequence;
    }
    const id = randomUUID(),
      token = randomUUID();
    const snapshot = connection
      ? {
          provider: connection.provider,
          protocol: connection.protocol,
          baseUrl: connection.base_url,
          model: connection.model,
          name: connection.name,
        }
      : {};
    const [row] = await tx.query<AiRunRow>(
      "INSERT INTO liekan_ai_run(id,creator_id,identity_id,owner_user_id,team_id,client_request_id,request_hash,operation,connection_id,connection_snapshot,config_version,test_sequence,website_id,website_epoch,conversation_id,lease_token,lease_until) VALUES($1::uuid,$2::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8::uuid,$9::jsonb,$10,$11,$12::uuid,$13::uuid,$14::uuid,$15::uuid,now()+interval '10 seconds') RETURNING *",
      id,
      actor.id,
      space.kind === 'personal' ? space.id : null,
      space.kind === 'team' ? space.id : null,
      input.clientRequestId,
      requestHash,
      input.operation,
      connection?.id ?? null,
      JSON.stringify(snapshot),
      connection?.config_version ?? input.expectedConfigVersion,
      testSequence,
      conversation?.row.website_id ?? null,
      conversation?.row.website_epoch ?? null,
      conversation?.row.id ?? null,
      token,
    );
    if (conversation)
      await tx.execute(
        "INSERT INTO liekan_ai_message(id,conversation_id,run_id,question,origin) VALUES($1::uuid,$2::uuid,$3::uuid,$4,'local')",
        randomUUID(),
        conversation.row.id,
        id,
        input.question ?? '',
      );
    return { row, token, connection, fresh: true };
  });
}
async function validateLease(tx: AiTx, actor: AiActor, handle: AiRunHandle) {
  if (!handle.token) throw new AiError('interrupted', '任务执行权无效', 409);
  const initial = await loadOwnedAiRun(tx, actor, handle.row.id);
  if (initial.operation === 'analysis')
    await loadAiConversation(tx, actor, initial.conversation_id!, true, true);
  if (initial.connection_id)
    await loadAiConnection(
      tx,
      actor,
      initial.connection_id,
      initial.operation === 'test' ? 'manage' : 'use',
      true,
    );
  const [row] = await tx.query<AiRunRow>(
    'SELECT * FROM liekan_ai_run WHERE id=$1::uuid FOR UPDATE',
    initial.id,
  );
  if (!row) throw new AiError('interrupted', '任务已清理', 409);
  if (row.state === 'cancel_requested') throw new AiError('cancelled', 'AI 请求已取消', 499);
  if (
    AI_TERMINAL.has(row.state) ||
    row.lease_token !== handle.token ||
    !row.lease_until ||
    row.lease_until.getTime() <= Date.now()
  )
    throw new AiError('interrupted', '任务已中断', 409);
  if (row.connection_id) {
    const { row: connection } = await loadAiConnection(
      tx,
      actor,
      row.connection_id,
      row.operation === 'test' ? 'manage' : 'use',
    );
    if (!connection.enabled || connection.config_version !== row.config_version)
      throw new AiError('invalidated', 'AI 配置已变更', 409);
  } else if (row.operation === 'test' || handle.connection)
    throw new AiError('invalidated', 'AI 配置已删除', 409);
  if (row.operation === 'analysis') await loadAiConversation(tx, actor, row.conversation_id!, true);
  return row;
}
export async function heartbeatAiRun(actor: AiActor, handle: AiRunHandle) {
  return aiTransaction(async tx => {
    await validateLease(tx, actor, handle);
    const changed = await tx.execute(
      "UPDATE liekan_ai_run SET lease_until=now()+interval '10 seconds' WHERE id=$1::uuid AND lease_token=$2::uuid AND lease_until>clock_timestamp() AND state IN ('accepted','preparing','calling','validating')",
      handle.row.id,
      handle.token,
    );
    if (!changed) throw new AiError('interrupted', '任务执行权已失效', 409);
  });
}
export async function setAiRunStage(
  actor: AiActor,
  handle: AiRunHandle,
  state: 'preparing' | 'calling' | 'validating',
  stage = state,
) {
  return aiTransaction(async tx => {
    const current = await validateLease(tx, actor, handle);
    const allowed = {
      preparing: ['accepted', 'preparing'],
      calling: ['preparing', 'calling'],
      validating: ['preparing', 'calling', 'validating'],
    }[state];
    if (!allowed.includes(current.state)) throw new AiError('conflict', '任务阶段不可回退', 409);
    const changed = await tx.execute(
      "UPDATE liekan_ai_run SET state=$3,stage=$4,call_attempted=call_attempted OR $5 WHERE id=$1::uuid AND lease_token=$2::uuid AND lease_until>clock_timestamp() AND state IN ('accepted','preparing','calling','validating')",
      handle.row.id,
      handle.token,
      state,
      stage,
      state === 'calling',
    );
    if (!changed) throw new AiError('interrupted', '任务已失效', 409);
  });
}
export async function cancelAiRun(actor: AiActor, id: string) {
  return aiTransaction(async tx => {
    const row = await loadOwnedAiRun(tx, actor, id);
    if (!AI_TERMINAL.has(row.state))
      await tx.execute(
        "UPDATE liekan_ai_run SET state='cancel_requested',stage='cancel_requested' WHERE id=$1::uuid AND state IN ('accepted','preparing','calling','validating')",
        id,
      );
    const [next] = await tx.query<AiRunRow>('SELECT * FROM liekan_ai_run WHERE id=$1::uuid', id);
    return dto(tx, next);
  });
}
export async function failAiRun(
  handle: AiRunHandle,
  code: string,
  state: 'failed' | 'cancelled' | 'interrupted' = 'failed',
  providerResponse?: unknown,
) {
  return aiTransaction(async tx => {
    if (handle.row.operation === 'test' && handle.connection)
      await tx.query(
        'SELECT id FROM liekan_ai_connection WHERE id=$1::uuid FOR UPDATE',
        handle.connection.id,
      );
    const parsedCode = aiErrorCodeSchema.safeParse(code);
    const error = safeAiError(parsedCode.success ? parsedCode.data : 'upstream');
    const metadata = aiProviderResponseSchema.safeParse(providerResponse);
    const changed = await tx.execute(
      "UPDATE liekan_ai_run SET test_result=CASE WHEN $6::jsonb IS NULL THEN test_result ELSE $6::jsonb END,state=CASE WHEN state='cancel_requested' THEN 'cancelled' WHEN lease_until<=now() THEN 'interrupted' ELSE $3 END,stage=CASE WHEN state='cancel_requested' THEN 'cancelled' WHEN lease_until<=now() THEN 'interrupted' ELSE $3 END,error_code=CASE WHEN state='cancel_requested' THEN 'cancelled' WHEN lease_until<=now() THEN 'interrupted' ELSE $4 END,error_message=$5,completed_at=now(),lease_until=NULL,latency_ms=LEAST(2147483647,(extract(epoch FROM now()-created_at)*1000)::integer) WHERE id=$1::uuid AND lease_token=$2::uuid AND state IN ('accepted','preparing','calling','validating','cancel_requested')",
      handle.row.id,
      handle.token,
      state,
      error.code,
      error.message,
      metadata.success ? JSON.stringify({ providerResponse: metadata.data }) : null,
    );
    if (
      changed &&
      handle.row.operation === 'test' &&
      handle.connection &&
      ['credentials', 'model'].includes(code)
    )
      await tx.execute(
        "UPDATE liekan_ai_connection SET test_state='failed',verified_config_version=NULL,is_default=false,capabilities=jsonb_set(capabilities,'{keyVerified}', '{\"text\":null,\"stream\":null,\"structuredOutput\":null,\"tools\":null,\"usage\":null}'::jsonb),row_version=row_version+1,updated_at=now() WHERE id=$1::uuid AND config_version=$2 AND test_sequence=$3 AND EXISTS(SELECT 1 FROM liekan_ai_run WHERE id=$4::uuid AND state='failed' AND error_code IN ('credentials','model'))",
        handle.connection.id,
        handle.row.config_version,
        handle.row.test_sequence,
        handle.row.id,
      );
  });
}
export async function saveAiContext(actor: AiActor, handle: AiRunHandle, context: any) {
  return aiTransaction(async tx => {
    const row = await validateLease(tx, actor, handle);
    if (
      context.website.id !== row.website_id ||
      context.websiteEpoch !== row.website_epoch ||
      context.space.kind !== aiSpaceFromRow(row).kind ||
      context.space.id !== aiSpaceFromRow(row).id
    )
      throw new AiError('invalidated', '分析依据与当前网站不匹配', 409);
    if (!row.conversation_id) throw new AiError('invalidated', '对话已清理', 409);
    await tx.execute(
      'INSERT INTO liekan_ai_context(id,conversation_id,website_epoch,facts,checksum) VALUES($1::uuid,$2::uuid,$3::uuid,$4::jsonb,$5)',
      context.id,
      row.conversation_id,
      row.website_epoch,
      JSON.stringify(context),
      hashAiRequest(context),
    );
    const changed = await tx.execute(
      'UPDATE liekan_ai_message SET context_id=$2::uuid WHERE run_id=$1::uuid AND conversation_id=$3::uuid',
      row.id,
      context.id,
      row.conversation_id,
    );
    if (!changed) throw new AiError('invalidated', '对话已清理', 409);
    return context.id;
  });
}
export async function completeAiRun(
  actor: AiActor,
  handle: AiRunHandle,
  result: any,
  stats: {
    ttftMs: number | null;
    usage: AiUsage | null;
    local?: boolean;
    stream?: boolean;
    signal?: AbortSignal;
  },
) {
  stats.signal?.throwIfAborted();
  return aiTransaction(async tx => {
    const row = await validateLease(tx, actor, handle);
    stats.signal?.throwIfAborted();
    if (Buffer.byteLength(JSON.stringify(result)) > 32768)
      throw new AiError('oversize', '回答超过允许长度', 413);
    if (row.operation === 'analysis') {
      const changed = await tx.execute(
        'UPDATE liekan_ai_message SET result=$2::jsonb,origin=$3 WHERE run_id=$1::uuid AND conversation_id=$4::uuid AND expires_at>now()',
        row.id,
        JSON.stringify(result),
        stats.local ? 'local' : 'provider',
        row.conversation_id,
      );
      if (!changed) throw new AiError('invalidated', '对话已清理', 409);
      await tx.execute(
        "UPDATE liekan_ai_conversation SET updated_at=now(),expires_at=now()+interval '90 days',title=CASE WHEN title='新的分析' THEN COALESCE((SELECT left(question,100) FROM liekan_ai_message WHERE run_id=$2::uuid),'网站分析') ELSE title END WHERE id=$1::uuid",
        row.conversation_id,
        row.id,
      );
    }
    const changed = await tx.execute(
      "UPDATE liekan_ai_run SET state='completed',stage='completed',completed_at=now(),lease_until=NULL,test_result=$3::jsonb,usage=$4::jsonb,ttft_ms=$5,latency_ms=LEAST(2147483647,(extract(epoch FROM now()-created_at)*1000)::integer),daily_reserved=CASE WHEN $6 AND NOT call_attempted THEN false ELSE daily_reserved END WHERE id=$1::uuid AND lease_token=$2::uuid AND lease_until>clock_timestamp() AND state IN ('accepted','preparing','calling','validating')",
      row.id,
      handle.token,
      row.operation === 'test' ? JSON.stringify(result) : null,
      stats.usage ? JSON.stringify(stats.usage) : null,
      stats.ttftMs,
      Boolean(stats.local),
    );
    if (!changed) throw new AiError('interrupted', '结果保存时任务执行权已失效', 409);
    if (row.operation === 'test' && handle.connection) {
      const capabilities = {
        ...handle.connection.capabilities,
        keyVerified: {
          ...handle.connection.capabilities.keyVerified,
          text: true,
          stream: stats.stream === true ? true : handle.connection.capabilities.keyVerified.stream,
          usage: stats.usage !== null ? true : handle.connection.capabilities.keyVerified.usage,
        },
      };
      await tx.execute(
        "UPDATE liekan_ai_connection SET test_state='connected',tested_at=now(),verified_config_version=config_version,capabilities=$4::jsonb,row_version=row_version+1,updated_at=now() WHERE id=$1::uuid AND config_version=$2 AND test_sequence=$3",
        handle.connection.id,
        row.config_version,
        row.test_sequence,
        JSON.stringify(capabilities),
      );
    }
    const [saved] = await tx.query<AiRunRow>(
      'SELECT * FROM liekan_ai_run WHERE id=$1::uuid',
      row.id,
    );
    const output = await dto(tx, saved);
    stats.signal?.throwIfAborted();
    // PostgreSQL now() is fixed at transaction start; final fences use wall-clock time.
    const [fence] = await tx.query<{ leased: boolean; timely: boolean }>(
      "SELECT $2::timestamptz>clock_timestamp() AS leased,created_at+CASE WHEN operation='test' THEN interval '45 seconds' ELSE interval '120 seconds' END>clock_timestamp() AS timely FROM liekan_ai_run WHERE id=$1::uuid",
      row.id,
      row.lease_until,
    );
    stats.signal?.throwIfAborted();
    if (!fence?.timely) throw new AiError('timeout', 'AI 请求超时', 504);
    if (!fence.leased) throw new AiError('interrupted', '结果保存时任务执行权已失效', 409);
    return output;
  });
}
