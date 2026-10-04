import { randomUUID } from 'node:crypto';
import {
  createAiConnectionSchema,
  updateAiConnectionSchema,
  toAiConnectionPublic,
  type AiSpace,
  type AiCapabilities,
} from './contracts';
import { encryptAiKey, getAiModuleState, type AiKeyEnvelope } from './crypto';
import { resolveAiTemplateConfig } from './templates';
import { AiError } from './error';
import { aiTransaction, type AiTx } from '../upstream/ai-db';
import { authorizeAiSpace, aiSpaceFromRow, aiId, type AiActor } from '../upstream/ai-access';
export interface AiConnectionRow {
  id: string;
  owner_user_id: string | null;
  team_id: string | null;
  name: string;
  provider: string;
  protocol: 'openai-chat' | 'anthropic-messages';
  base_url: string;
  model: string;
  workspace_id: string | null;
  last_call?: {
    state: string;
    operation: string;
    createdAt: string;
    completedAt: string | null;
    errorCode: string | null;
  } | null;
  secret_envelope: AiKeyEnvelope | null;
  enabled: boolean;
  is_default: boolean;
  row_version: number;
  config_version: number;
  test_state: string;
  tested_at: Date | null;
  verified_config_version: number | null;
  test_sequence: number;
  capabilities: AiCapabilities;
}
const unknownCapabilities = () => ({
  text: null,
  stream: null,
  structuredOutput: null,
  tools: null,
  usage: null,
});
export function initialAiCapabilities(config: {
  provider: string;
  protocol: 'openai-chat' | 'anthropic-messages';
  baseUrl: string;
  model: string;
}): AiCapabilities {
  return {
    documented: { ...(resolveAiTemplateConfig(config).documented ?? unknownCapabilities()) },
    protocolTested: unknownCapabilities(),
    keyVerified: unknownCapabilities(),
  };
}
export function requireAiEnabled() {
  const state = getAiModuleState();
  if (!state.enabled) throw new AiError('module_disabled', '请启用 AI 功能并配置独立加密密钥', 503);
}
export function publicAiConnection(row: AiConnectionRow) {
  const configuration = resolveAiTemplateConfig({
    provider: row.provider,
    protocol: row.protocol,
    baseUrl: row.base_url,
    model: row.model,
  });
  return toAiConnectionPublic({
    id: row.id,
    name: row.name,
    ownerUserId: row.owner_user_id,
    teamId: row.team_id,
    provider: row.provider,
    protocol: row.protocol,
    baseUrl: row.base_url,
    model: row.model,
    workspaceId: row.workspace_id,
    region: configuration.region,
    contextWindow: configuration.contextWindow,
    contextWindowSource: configuration.contextWindowSource,
    enabled: row.enabled,
    isDefault: row.is_default,
    rowVersion: row.row_version,
    configVersion: row.config_version,
    hasKey: Boolean(row.secret_envelope),
    testState: row.test_state,
    testedAt: row.tested_at?.toISOString() ?? null,
    capabilities: row.capabilities,
  });
}
export async function loadAiConnection(
  tx: AiTx,
  actor: AiActor,
  id: string,
  mode: 'read' | 'use' | 'manage' = 'read',
  lock = false,
) {
  aiId(id);
  const [metadata] = await tx.query<AiConnectionRow>(
    'SELECT * FROM liekan_ai_connection WHERE id=$1::uuid',
    id,
  );
  if (!metadata) throw new AiError('resource_unavailable', '连接不可访问', 404);
  const space = aiSpaceFromRow(metadata);
  const access = await authorizeAiSpace(tx, actor, space, mode);
  const [row] = lock
    ? await tx.query<AiConnectionRow>(
        'SELECT * FROM liekan_ai_connection WHERE id=$1::uuid FOR UPDATE',
        id,
      )
    : [metadata];
  if (!row) throw new AiError('resource_unavailable', '连接不可访问', 404);
  return { row, space, access };
}
async function auditAiConfig(
  tx: AiTx,
  actor: AiActor,
  row: AiConnectionRow,
  action: 'create' | 'update' | 'delete' | 'default',
) {
  await tx.execute(
    'INSERT INTO liekan_ai_audit(id,actor_id,owner_user_id,team_id,connection_id,action,config_version) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7)',
    randomUUID(),
    actor.id,
    row.owner_user_id,
    row.team_id,
    row.id,
    action,
    row.config_version,
  );
}
export async function listAiConnections(actor: AiActor, space: AiSpace) {
  requireAiEnabled();
  return aiTransaction(async tx => {
    const access = await authorizeAiSpace(tx, actor, space);
    const rows = await tx.query<AiConnectionRow>(
      "SELECT c.*,last.call AS last_call FROM liekan_ai_connection c LEFT JOIN LATERAL(SELECT jsonb_build_object('state',r.state,'operation',r.operation,'createdAt',r.created_at,'completedAt',r.completed_at,'errorCode',r.error_code) AS call FROM liekan_ai_run r WHERE r.connection_id=c.id AND $3::boolean AND r.expires_at>now() ORDER BY r.created_at DESC,r.id DESC LIMIT 1) last ON true WHERE c.owner_user_id IS NOT DISTINCT FROM $1::uuid AND c.team_id IS NOT DISTINCT FROM $2::uuid ORDER BY c.created_at,c.id LIMIT 20",
      space.kind === 'personal' ? space.id : null,
      space.kind === 'team' ? space.id : null,
      access.canManage,
    );
    return {
      protocolVersion: 1,
      items: rows.map(row => ({ ...publicAiConnection(row), lastCall: row.last_call ?? null })),
      ...access,
    };
  });
}
export async function createAiConnection(actor: AiActor, input: unknown) {
  requireAiEnabled();
  const parsed = createAiConnectionSchema.safeParse(input);
  if (!parsed.success) throw new AiError('invalid_request', 'API 配置填写不完整或格式无效');
  const p = parsed.data;
  p.space.id = aiId(p.space.id);
  if (p.isDefault) throw new AiError('test_required', '请先保存并完成实时测试，再设为默认连接');
  return aiTransaction(async tx => {
    await authorizeAiSpace(tx, actor, p.space, 'manage');
    await tx.execute(
      'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      `liekan-ai-space:${p.space.kind}:${p.space.id}`,
    );
    const [count] = await tx.query<{ count: bigint }>(
      'SELECT count(*) FROM liekan_ai_connection WHERE owner_user_id IS NOT DISTINCT FROM $1::uuid AND team_id IS NOT DISTINCT FROM $2::uuid',
      p.space.kind === 'personal' ? p.space.id : null,
      p.space.kind === 'team' ? p.space.id : null,
    );
    if (Number(count.count) >= 20)
      throw new AiError('connection_limit', '每个空间最多配置 20 个 API');
    const id = randomUUID(),
      secret = encryptAiKey(p.apiKey, { connectionId: id, space: p.space });
    const [row] = await tx.query<AiConnectionRow>(
      'INSERT INTO liekan_ai_connection(id,owner_user_id,team_id,name,provider,protocol,base_url,model,secret_envelope,enabled,capabilities,workspace_id) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12) RETURNING *',
      id,
      p.space.kind === 'personal' ? p.space.id : null,
      p.space.kind === 'team' ? p.space.id : null,
      p.name,
      p.provider,
      p.protocol,
      p.baseUrl,
      p.model,
      JSON.stringify(secret),
      p.enabled ?? true,
      JSON.stringify(initialAiCapabilities(p)),
      p.workspaceId ?? null,
    );
    await auditAiConfig(tx, actor, row, 'create');
    return publicAiConnection(row);
  });
}
export async function invalidateConnectionRuns(tx: AiTx, id: string) {
  await tx.execute(
    "UPDATE liekan_ai_run SET state='invalidated',stage='invalidated',completed_at=now(),lease_until=NULL,error_code='invalidated',error_message='AI 配置已变更，本次结果已失效。' WHERE connection_id=$1::uuid AND state IN ('accepted','preparing','calling','validating','cancel_requested')",
    id,
  );
}
export async function updateAiConnection(actor: AiActor, id: string, input: unknown) {
  id = aiId(id);
  requireAiEnabled();
  const parsed = updateAiConnectionSchema.safeParse(input);
  if (!parsed.success) throw new AiError('invalid_request', 'API 配置格式无效');
  const p = parsed.data;
  return aiTransaction(async tx => {
    const { row, space } = await loadAiConnection(tx, actor, id, 'manage');
    await tx.execute(
      'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      `liekan-ai-space:${space.kind}:${space.id}`,
    );
    const [locked] = await tx.query<AiConnectionRow>(
      'SELECT * FROM liekan_ai_connection WHERE id=$1::uuid FOR UPDATE',
      id,
    );
    if (!locked) throw new AiError('resource_unavailable', '连接不可访问', 404);
    if (locked.row_version !== p.rowVersion)
      throw new AiError('conflict', '配置已更新，请刷新后重试', 409);
    const enabled = p.enabled ?? locked.enabled;
    const workspaceId =
      p.provider !== 'anthropic'
        ? null
        : p.workspaceId === undefined
          ? locked.workspace_id
          : p.workspaceId;
    const configChanged =
      locked.provider !== p.provider ||
      locked.protocol !== p.protocol ||
      locked.base_url !== p.baseUrl ||
      locked.model !== p.model ||
      locked.workspace_id !== workspaceId ||
      enabled !== locked.enabled ||
      Boolean(p.apiKey);
    const originChanged =
      locked.provider !== p.provider ||
      locked.protocol !== p.protocol ||
      locked.workspace_id !== workspaceId ||
      new URL(locked.base_url).origin !== new URL(p.baseUrl).origin;
    if (originChanged && !p.apiKey)
      throw new AiError('key_required', '变更供应商、协议或接口域名后，请重新输入 API Key');
    const envelope = p.apiKey
      ? encryptAiKey(p.apiKey, { connectionId: id, space })
      : locked.secret_envelope;
    const version = locked.config_version + Number(configChanged);
    const setDefault = p.isDefault ?? locked.is_default;
    if (
      setDefault &&
      (configChanged ||
        !enabled ||
        !envelope ||
        locked.verified_config_version !== version ||
        locked.test_state !== 'connected')
    ) {
      if (p.isDefault === true)
        throw new AiError('test_required', '请完成当前配置的实时测试后再设为默认');
    }
    const isDefault = !configChanged && enabled && setDefault;
    if (isDefault)
      await tx.execute(
        'UPDATE liekan_ai_connection SET is_default=false,row_version=row_version+1,updated_at=now() WHERE id<>$1::uuid AND is_default AND owner_user_id IS NOT DISTINCT FROM $2::uuid AND team_id IS NOT DISTINCT FROM $3::uuid',
        id,
        row.owner_user_id,
        row.team_id,
      );
    if (configChanged) await invalidateConnectionRuns(tx, id);
    const [updated] = await tx.query<AiConnectionRow>(
      'UPDATE liekan_ai_connection SET name=$2,provider=$3,protocol=$4,base_url=$5,model=$6,secret_envelope=$7::jsonb,enabled=$8,is_default=$9,row_version=row_version+1,config_version=$10,test_state=$11,verified_config_version=$12,capabilities=$13::jsonb,tested_at=$14,workspace_id=$15,updated_at=now() WHERE id=$1::uuid RETURNING *',
      id,
      p.name,
      p.provider,
      p.protocol,
      p.baseUrl,
      p.model,
      envelope ? JSON.stringify(envelope) : null,
      enabled,
      isDefault,
      version,
      configChanged ? 'untested' : locked.test_state,
      configChanged ? null : locked.verified_config_version,
      JSON.stringify(configChanged ? initialAiCapabilities(p) : locked.capabilities),
      configChanged ? null : locked.tested_at,
      workspaceId,
    );
    await auditAiConfig(tx, actor, updated, p.isDefault === true ? 'default' : 'update');
    return publicAiConnection(updated);
  });
}
export async function deleteAiConnection(actor: AiActor, id: string, rowVersion: number) {
  requireAiEnabled();
  return aiTransaction(async tx => {
    const { row } = await loadAiConnection(tx, actor, id, 'manage', true);
    if (row.row_version !== rowVersion)
      throw new AiError('conflict', '配置已更新，请刷新后重试', 409);
    await auditAiConfig(tx, actor, row, 'delete');
    await invalidateConnectionRuns(tx, id);
    await tx.execute('DELETE FROM liekan_ai_connection WHERE id=$1::uuid', id);
    return { deleted: true };
  });
}
