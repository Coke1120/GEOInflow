import { createHash } from 'node:crypto';
import type {
  CrawlerConnection,
  CrawlerDeployment,
  CrawlerPolicy,
  CrawlerPolicyInput,
} from '../contracts/crawlers';
import { crawlerHostSchema, crawlerRuleRef } from '../crawlers/templates';
import { hostname } from '../log-ingestion/protocol';
import { openPlatformSecret } from '../log-ingestion/secrets';
import {
  authorizeCrawler,
  type CrawlerActor,
  type CrawlerAccessMode,
} from '../upstream/crawler-access';
import type { AiTx } from '../upstream/ai-db';
import { aiSpaceFromRow, authorizeAiSpace } from '../upstream/ai-access';
import { AiError } from '../ai/error';
import { LiekanError } from '../upstream/errors';

export interface PolicyRow {
  id: string;
  website_id: string;
  connection_id: string | null;
  generation: number;
  version: number;
  body: CrawlerPolicyInput;
  state: CrawlerPolicy['state'];
  ref: string;
  remote_ruleset_id: string | null;
  remote_rule_id: string | null;
  remote_hash: string | null;
  applied_version: number | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}
export interface ConnectionRow {
  id: string;
  website_id: string;
  created_by: string;
  owner_user_id: string | null;
  team_id: string | null;
  domain: string;
  zone_id: string;
  token_encrypted: string | null;
  state: CrawlerConnection['state'];
  capabilities: Record<string, boolean | number | string | null>;
  cleanup_until: Date | null;
  created_at: Date;
  updated_at: Date;
}
export interface DeploymentRow {
  id: string;
  website_id: string;
  policy_id: string;
  connection_id: string | null;
  preview_id: string;
  actor_id: string;
  generation: number;
  operation: CrawlerDeployment['operation'];
  policy_version: number;
  input_hash: string;
  state: CrawlerDeployment['state'];
  target: any;
  before_snapshot: any;
  result: any;
  error_code: string | null;
  lease_owner: string | null;
  lease_until: Date | null;
  attempts: number;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}
export async function authorizeCrawlerHandoff(
  tx: AiTx,
  actor: CrawlerActor,
  connection: ConnectionRow,
) {
  try {
    const space = aiSpaceFromRow(connection),
      [live] = await tx.query<{ role: string }>(
        'SELECT role FROM "user" WHERE user_id=$1::uuid AND deleted_at IS NULL FOR SHARE',
        actor.id,
      );
    if (live?.role === 'admin') {
      const [membership] =
        space.kind === 'team'
          ? await tx.query<{ role: string }>(
              'SELECT role FROM team_user WHERE team_id=$1::uuid AND user_id=$2::uuid FOR SHARE',
              space.id,
              actor.id,
            )
          : [];
      if (membership?.role === 'team-view-only')
        throw new LiekanError('只读身份可查看交接记录', 403);
      // Retained unknown facts remain recoverable after an original owner or team is deleted.
      return { canManage: true, canUse: true, role: live.role, teamRole: membership?.role ?? null };
    }
    return await authorizeAiSpace(tx, actor, space, 'manage');
  } catch (error) {
    if (error instanceof AiError) throw new LiekanError(error.message, error.status);
    throw error;
  }
}
export const iso = (value: Date | string | null) => (value ? new Date(value).toISOString() : null);
export function controlId(value: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value))
    throw new LiekanError('资源 ID 无效', 400);
  return value.toLowerCase();
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export const controlHash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
export const controlPurpose = (connection: Pick<ConnectionRow, 'id' | 'website_id'>) =>
  `crawler-control:${controlId(connection.id)}:${controlId(connection.website_id)}`;
export function controlToken(connection: ConnectionRow) {
  if (!connection.token_encrypted) throw new LiekanError('控制连接凭据已销毁，请重新连接', 409);
  try {
    return openPlatformSecret(connection.token_encrypted, controlPurpose(connection));
  } catch {
    throw new LiekanError('控制连接凭据暂不可用', 503);
  }
}
export async function controlContext(
  tx: AiTx,
  actor: CrawlerActor,
  websiteId: string,
  mode: CrawlerAccessMode = 'read',
) {
  websiteId = controlId(websiteId);
  const website = await authorizeCrawler(tx, actor, websiteId, mode);
  await tx.execute(
    'INSERT INTO liekan_crawler_state(website_id) VALUES($1::uuid) ON CONFLICT DO NOTHING',
    websiteId,
  );
  const [state] = await tx.query<{ generation: number; deleted_at: Date | null }>(
    'SELECT generation,deleted_at FROM liekan_crawler_state WHERE website_id=$1::uuid FOR UPDATE',
    websiteId,
  );
  const [instance] = await tx.query<{ id: string; control_paused: boolean }>(
    'SELECT id,control_paused FROM liekan_crawler_instance WHERE singleton=true FOR SHARE',
  );
  if (!instance || state.deleted_at) throw new LiekanError('蜘蛛控制上下文不可用', 409);
  return {
    website,
    host: controlHostname(website.domain),
    generation: state.generation,
    instance,
    permissions: {
      canDraft: website.canDraft,
      canControl: website.canControl,
      isAdmin: website.role === 'admin',
    },
  };
}
function controlHostname(domain: string) {
  try {
    return crawlerHostSchema.parse(hostname(domain));
  } catch {
    throw new LiekanError('请为网站设置有效的公开域名后管理蜘蛛策略', 400);
  }
}
export type ControlContext = Awaited<ReturnType<typeof controlContext>>;
export async function controlPolicy(tx: AiTx, websiteId: string, policyId: string) {
  const [policy] = await tx.query<PolicyRow>(
    'SELECT * FROM liekan_crawler_policy WHERE id=$1::uuid AND website_id=$2::uuid FOR UPDATE',
    controlId(policyId),
    controlId(websiteId),
  );
  if (!policy) throw new LiekanError('蜘蛛策略不存在', 404);
  return policy;
}
export function assertPolicyRegistry(context: ControlContext, policy: PolicyRow) {
  if (policy.ref !== crawlerRuleRef(context.instance.id, policy.website_id, policy.id))
    throw new LiekanError('策略登记身份不可用，请人工核对', 409);
}
export function assertPolicyContext(context: ControlContext, policy: PolicyRow) {
  assertPolicyRegistry(context, policy);
  if (policy.generation !== context.generation)
    throw new LiekanError('策略归属或域名已变化，请明确预览确认接管', 409);
}
export function assertConnectionContext(
  context: ControlContext,
  connection: ConnectionRow,
  cleanup = false,
) {
  if (
    connection.domain !== context.host ||
    connection.owner_user_id !== context.website.ownerUserId ||
    connection.team_id !== context.website.teamId ||
    (connection.state !== 'active' &&
      !(
        cleanup &&
        connection.state === 'cleanup' &&
        connection.cleanup_until &&
        +new Date(connection.cleanup_until) > Date.now()
      )) ||
    !connection.token_encrypted
  )
    throw new LiekanError('控制连接已冻结或归属变化，请核对交接记录', 409);
}
export async function controlConnection(
  tx: AiTx,
  context: ControlContext,
  websiteId: string,
  id?: string | null,
  cleanup = false,
) {
  const [connection] = id
    ? await tx.query<ConnectionRow>(
        'SELECT * FROM liekan_crawler_connection WHERE id=$1::uuid AND website_id=$2::uuid FOR UPDATE',
        controlId(id),
        controlId(websiteId),
      )
    : await tx.query<ConnectionRow>(
        "SELECT * FROM liekan_crawler_connection WHERE website_id=$1::uuid AND state='active' FOR UPDATE",
        controlId(websiteId),
      );
  if (!connection) throw new LiekanError('请先连接当前网站的 Cloudflare Zone', 409);
  assertConnectionContext(context, connection, cleanup);
  return connection;
}
export const policyDto = (row: PolicyRow): CrawlerPolicy => ({
  ...row.body,
  id: row.id,
  websiteId: row.website_id,
  connectionId: row.connection_id,
  version: row.version,
  state: row.state,
  ref: row.ref,
  remoteRuleId: row.remote_rule_id,
  remoteRulesetId: row.remote_ruleset_id,
  remoteHash: row.remote_hash,
  appliedVersion: row.applied_version,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});
export const connectionDto = (
  row: ConnectionRow,
): CrawlerConnection & { tokenMask: string | null; cleanupUntil: string | null } => ({
  id: row.id,
  websiteId: row.website_id,
  zoneId: row.zone_id,
  domain: row.domain,
  state: row.state,
  capabilities: row.capabilities,
  testedAt: typeof row.capabilities.testedAt === 'string' ? row.capabilities.testedAt : null,
  tokenMask: row.token_encrypted ? '••••••••' : null,
  cleanupUntil: iso(row.cleanup_until),
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});
export const deploymentDto = (
  row: DeploymentRow,
): CrawlerDeployment & {
  result: unknown;
  instructions: string | null;
  mode: 'apply' | 'adopt';
} => ({
  mode: row.target.mode === 'adopt' ? 'adopt' : 'apply',
  id: row.id,
  websiteId: row.website_id,
  policyId: row.policy_id,
  policyVersion: row.policy_version,
  operation: row.operation,
  state: row.state,
  ref: row.target.ref,
  ruleId: row.result?.ruleId ?? row.before_snapshot?.rule?.id ?? null,
  errorCode: row.error_code,
  result: row.result ?? null,
  instructions:
    row.state === 'unknown'
      ? '先重新核对远端规则。仅在远端与执行前完全一致时，可明确确认本次未应用后重新预览。'
      : row.state === 'conflict'
        ? '远端规则已变化，请人工核对；系统不会自动覆盖。'
        : null,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
  completedAt: iso(row.completed_at),
});
