import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  CRAWLER_MAX_LOCAL_DRAFTS,
  crawlerConnectionInputSchema,
  crawlerPolicyCreateSchema,
  crawlerPolicyUpdateSchema,
} from '../contracts/crawlers';
import { crawlerRuleRef } from '../crawlers/templates';
import { sealPlatformSecret } from '../log-ingestion/secrets';
import { crawlerTransaction, type CrawlerActor } from '../upstream/crawler-access';
import { LiekanError } from '../upstream/errors';
import { readCrawlerCloudflare } from './cloudflare';
import {
  assertConnectionContext,
  authorizeCrawlerHandoff,
  assertPolicyContext,
  connectionDto,
  controlContext,
  controlHash,
  controlId,
  controlPolicy,
  controlPurpose,
  controlToken,
  deploymentDto,
  policyDto,
  type ConnectionRow,
  type DeploymentRow,
  type PolicyRow,
} from './control-store';
import { reconcileCrawlerDeployment } from './deployments';

export const crawlerControlInput = z.strictObject({ resume: z.boolean() });
export const crawlerDisconnectInput = z.strictObject({
  retainForConfirmedCleanup: z.boolean().default(false),
});
export async function listCrawlerPolicies(actor: CrawlerActor, websiteId: string) {
  return crawlerTransaction(async tx => {
    const context = await controlContext(tx, actor, websiteId);
    const policies = await tx.query<PolicyRow>(
      'SELECT * FROM liekan_crawler_policy WHERE website_id=$1::uuid ORDER BY created_at,id',
      websiteId,
    );
    const connections = await tx.query<ConnectionRow>(
      'SELECT * FROM liekan_crawler_connection WHERE website_id=$1::uuid ORDER BY created_at DESC,id',
      websiteId,
    );
    const deployments = await tx.query<DeploymentRow>(
      'SELECT * FROM liekan_crawler_deployment WHERE website_id=$1::uuid ORDER BY created_at DESC,id LIMIT 100',
      websiteId,
    );
    return {
      policies: policies.map(policy => ({
        ...policyDto(policy),
        contextCurrent: policy.generation === context.generation,
      })),
      connections: connections.map(connectionDto),
      deployments: deployments.map(deploymentDto),
      permissions: context.permissions,
      controlPaused: context.instance.control_paused,
    };
  });
}
export async function getCrawlerPolicy(actor: CrawlerActor, websiteId: string, policyId: string) {
  return crawlerTransaction(async tx => {
    const context = await controlContext(tx, actor, websiteId);
    const policy = await controlPolicy(tx, websiteId, policyId);
    const versions = await tx.query(
      'SELECT version,body,created_at AS "createdAt" FROM liekan_crawler_policy_version WHERE policy_id=$1::uuid ORDER BY version DESC',
      policy.id,
    );
    const operations = await tx.query<DeploymentRow>(
      'SELECT * FROM liekan_crawler_deployment WHERE policy_id=$1::uuid ORDER BY created_at DESC LIMIT 30',
      policy.id,
    );
    return {
      policy: policyDto(policy),
      versions,
      deployments: operations.map(deploymentDto),
      permissions: context.permissions,
      controlPaused: context.instance.control_paused,
      contextCurrent: policy.generation === context.generation,
    };
  });
}
export async function createCrawlerPolicy(
  actor: CrawlerActor,
  websiteId: string,
  input: z.infer<typeof crawlerPolicyCreateSchema>,
) {
  const body = crawlerPolicyCreateSchema.parse(input);
  return crawlerTransaction(async tx => {
    const context = await controlContext(tx, actor, websiteId, 'draft');
    const [count] = await tx.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM liekan_crawler_policy WHERE website_id=$1::uuid AND state='draft'",
      websiteId,
    );
    if (count.count >= CRAWLER_MAX_LOCAL_DRAFTS)
      throw new LiekanError('每个网站最多保存 20 个草稿', 409);
    const id = randomUUID(),
      ref = crawlerRuleRef(context.instance.id, websiteId, id);
    const [policy] = await tx.query<PolicyRow>(
      `INSERT INTO liekan_crawler_policy(id,website_id,generation,body,ref,created_by)
      VALUES($1::uuid,$2::uuid,$3,$4::jsonb,$5,$6::uuid) RETURNING *`,
      id,
      websiteId,
      context.generation,
      JSON.stringify(body),
      ref,
      actor.id,
    );
    await tx.execute(
      'INSERT INTO liekan_crawler_policy_version(policy_id,version,body,created_by) VALUES($1::uuid,1,$2::jsonb,$3::uuid)',
      id,
      JSON.stringify(body),
      actor.id,
    );
    return policyDto(policy);
  });
}
export async function updateCrawlerPolicy(
  actor: CrawlerActor,
  websiteId: string,
  policyId: string,
  input: z.infer<typeof crawlerPolicyUpdateSchema>,
) {
  const { version, ...body } = crawlerPolicyUpdateSchema.parse(input);
  return crawlerTransaction(async tx => {
    const context = await controlContext(tx, actor, websiteId, 'draft'),
      policy = await controlPolicy(tx, websiteId, policyId);
    assertPolicyContext(context, policy);
    if (policy.version !== version) throw new LiekanError('草稿已更新，请重新载入后修改', 409);
    const pending = await tx.query(
      "SELECT id FROM liekan_crawler_deployment WHERE policy_id=$1::uuid AND state IN('queued','running','unknown','cleanup') LIMIT 1",
      policy.id,
    );
    if (pending.length) throw new LiekanError('请先完成或核对当前操作后修改草稿', 409);
    const [updated] = await tx.query<PolicyRow>(
      'UPDATE liekan_crawler_policy SET body=$2::jsonb,version=version+1,updated_at=now() WHERE id=$1::uuid RETURNING *',
      policy.id,
      JSON.stringify(body),
    );
    await tx.execute(
      'INSERT INTO liekan_crawler_policy_version(policy_id,version,body,created_by) VALUES($1::uuid,$2,$3::jsonb,$4::uuid)',
      policy.id,
      updated.version,
      JSON.stringify(body),
      actor.id,
    );
    return policyDto(updated);
  });
}
export async function listCrawlerConnections(actor: CrawlerActor, websiteId: string) {
  const { connections, permissions, controlPaused } = await listCrawlerPolicies(actor, websiteId);
  return { connections, permissions, controlPaused };
}
export async function connectCrawlerConnection(
  actor: CrawlerActor,
  websiteId: string,
  input: z.infer<typeof crawlerConnectionInputSchema>,
) {
  const data = crawlerConnectionInputSchema.parse(input);
  const prepared = await crawlerTransaction(async tx => {
    const context = await controlContext(tx, actor, websiteId, 'control');
    const existing = await tx.query(
      "SELECT id FROM liekan_crawler_connection WHERE website_id=$1::uuid AND state IN('active','cleanup')",
      websiteId,
    );
    if (existing.length) throw new LiekanError('请先明确断开现有控制连接', 409);
    return context;
  });
  // Admission verifies Zone and entrypoint reads. WAF write permission is tested only by a confirmed write.
  const snapshot = await readCrawlerCloudflare(data.token, data.zoneId, prepared.host);
  const capabilities = {
    zoneReadable: true,
    rulesReadable: true,
    writeVerified: false,
    quota: snapshot.quota,
    used: snapshot.rules.length,
    plan: snapshot.zone.plan,
    testedAt: new Date().toISOString(),
  };
  return crawlerTransaction(async tx => {
    const context = await controlContext(tx, actor, websiteId, 'control');
    if (
      context.generation !== prepared.generation ||
      context.host !== prepared.host ||
      context.website.ownerUserId !== prepared.website.ownerUserId ||
      context.website.teamId !== prepared.website.teamId
    )
      throw new LiekanError('网站归属已变化，请重新连接', 409);
    const existing = await tx.query(
      "SELECT id FROM liekan_crawler_connection WHERE website_id=$1::uuid AND state IN('active','cleanup')",
      websiteId,
    );
    if (existing.length) throw new LiekanError('现有控制连接已变化，请重新载入', 409);
    const id = randomUUID();
    const encrypted = sealPlatformSecret(data.token, controlPurpose({ id, website_id: websiteId }));
    const [connection] = await tx.query<ConnectionRow>(
      `INSERT INTO liekan_crawler_connection(id,website_id,created_by,owner_user_id,team_id,domain,zone_id,token_encrypted,capabilities)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9::jsonb) RETURNING *`,
      id,
      websiteId,
      actor.id,
      context.website.ownerUserId,
      context.website.teamId,
      context.host,
      data.zoneId.toLowerCase(),
      encrypted,
      JSON.stringify(capabilities),
    );
    return connectionDto(connection);
  });
}
export async function disconnectCrawlerConnection(
  actor: CrawlerActor,
  websiteId: string,
  connectionId: string,
  input: z.infer<typeof crawlerDisconnectInput> = { retainForConfirmedCleanup: false },
) {
  const data = crawlerDisconnectInput.parse(input);
  return crawlerTransaction(async tx => {
    const context = await controlContext(tx, actor, websiteId, 'control');
    const [connection] = await tx.query<ConnectionRow>(
      'SELECT * FROM liekan_crawler_connection WHERE website_id=$1::uuid AND id=$2::uuid FOR UPDATE',
      websiteId,
      controlId(connectionId),
    );
    if (!connection) throw new LiekanError('控制连接不存在', 404);
    if (connection.state === 'disconnected')
      return {
        connection: connectionDto(connection),
        remoteTokenRevoked: false,
        rulesRetained: true,
      };
    assertConnectionContext(context, connection, true);
    const cleanup = await tx.query<DeploymentRow>(
      "SELECT * FROM liekan_crawler_deployment WHERE connection_id=$1::uuid AND operation='cleanup' AND state IN('queued','running','unknown','failed','conflict') ORDER BY created_at DESC",
      connection.id,
    );
    if (data.retainForConfirmedCleanup && !cleanup.length)
      throw new LiekanError('仅已明确确认的逐条清理操作可保留七天清理凭据', 409);
    const [updated] = await tx.query<ConnectionRow>(
      `UPDATE liekan_crawler_connection SET state=$2,token_encrypted=CASE WHEN $3 THEN token_encrypted ELSE NULL END,
      cleanup_until=CASE WHEN $3 THEN coalesce(cleanup_until,now()+interval '7 days') ELSE NULL END,updated_at=now() WHERE id=$1::uuid RETURNING *`,
      connection.id,
      data.retainForConfirmedCleanup ? 'cleanup' : 'disconnected',
      data.retainForConfirmedCleanup,
    );
    await tx.execute(
      `UPDATE liekan_crawler_deployment SET state='failed',error_code='connection-disconnected',completed_at=now(),updated_at=now()
      WHERE connection_id=$1::uuid AND state='queued' AND (NOT $2 OR operation!='cleanup')`,
      connection.id,
      data.retainForConfirmedCleanup,
    );
    return {
      connection: connectionDto(updated),
      remoteTokenRevoked: false,
      rulesRetained: true,
      cleanup: cleanup.map(deploymentDto),
    };
  });
}
export async function resumeCrawlerControl(
  actor: CrawlerActor,
  websiteId: string,
  input: z.infer<typeof crawlerControlInput>,
) {
  const { resume } = crawlerControlInput.parse(input);
  const prepared = await crawlerTransaction(async tx => {
    const context = await controlContext(tx, actor, websiteId, 'control');
    if (!context.permissions.isAdmin) throw new LiekanError('实例控制恢复需要系统管理员权限', 403);
    const connections = await tx.query<ConnectionRow>(
      "SELECT * FROM liekan_crawler_connection WHERE website_id=$1::uuid AND state='active'",
      websiteId,
    );
    for (const connection of connections) assertConnectionContext(context, connection);
    const unknown = await tx.query<{ id: string }>(
      "SELECT id FROM liekan_crawler_deployment WHERE website_id=$1::uuid AND state='unknown'",
      websiteId,
    );
    return { context, connections, unknown };
  });
  if (resume) {
    for (const connection of prepared.connections)
      await readCrawlerCloudflare(controlToken(connection), connection.zone_id, connection.domain);
    for (const job of prepared.unknown) await reconcileCrawlerDeployment(actor, websiteId, job.id);
  }
  return crawlerTransaction(async tx => {
    const context = await controlContext(tx, actor, websiteId, 'control');
    if (!context.permissions.isAdmin) throw new LiekanError('实例控制恢复需要系统管理员权限', 403);
    if (context.generation !== prepared.context.generation)
      throw new LiekanError('网站上下文已变化，请重新核对', 409);
    const connections = await tx.query<ConnectionRow>(
      "SELECT * FROM liekan_crawler_connection WHERE website_id=$1::uuid AND state='active' FOR UPDATE",
      websiteId,
    );
    if (
      controlHash(
        connections.map(c => [c.id, c.token_encrypted, c.domain, c.owner_user_id, c.team_id]),
      ) !==
      controlHash(
        prepared.connections.map(c => [
          c.id,
          c.token_encrypted,
          c.domain,
          c.owner_user_id,
          c.team_id,
        ]),
      )
    )
      throw new LiekanError('控制连接已变化，请重新核对', 409);
    // Recovery is a deliberate boundary: restored previews and queued jobs never acquire authority to execute.
    await tx.execute(
      "UPDATE liekan_crawler_deployment SET state='failed',error_code='instance-control-reset',completed_at=now(),updated_at=now() WHERE state='queued'",
    );
    await tx.execute('UPDATE liekan_crawler_preview SET expires_at=least(expires_at,now())');
    await tx.execute(
      'UPDATE liekan_crawler_instance SET control_paused=$1 WHERE singleton=true',
      !resume,
    );
    return { controlPaused: !resume, reconciledConnections: resume ? connections.length : 0 };
  });
}
/** Original space ownership remains readable for the handoff retention period after a website moves or is deleted. */
export async function listCrawlerHandoffs(actor: CrawlerActor) {
  return crawlerTransaction(async tx => {
    const [user] = await tx.query<{ role: string }>(
      'SELECT role FROM "user" WHERE user_id=$1::uuid AND deleted_at IS NULL FOR SHARE',
      actor.id,
    );
    if (!user) throw new LiekanError('当前登录已失效', 401);
    const connections = await tx.query<ConnectionRow>(
      `SELECT c.* FROM liekan_crawler_connection c WHERE (c.updated_at>now()-interval '180 days' OR
      ($2 AND EXISTS(SELECT 1 FROM liekan_crawler_deployment d WHERE d.connection_id=c.id AND d.state='unknown')))
      AND (c.state!='active' OR EXISTS(SELECT 1 FROM liekan_crawler_state s WHERE s.website_id=c.website_id AND s.deleted_at IS NOT NULL))
      AND ($2 OR c.owner_user_id=$1::uuid OR EXISTS(SELECT 1 FROM team_user tu JOIN team t ON t.team_id=tu.team_id WHERE tu.team_id=c.team_id AND tu.user_id=$1::uuid AND t.deleted_at IS NULL))
      ORDER BY c.updated_at DESC,c.id LIMIT 100`,
      actor.id,
      user.role === 'admin',
    );
    const candidates = connections.length
      ? await tx.query<ConnectionRow & { websiteName: string }>(
          `SELECT c.*,w.name AS "websiteName" FROM liekan_crawler_connection c
          JOIN website w ON w.website_id=c.website_id AND w.deleted_at IS NULL
          WHERE c.state='active' AND c.token_encrypted IS NOT NULL
          AND c.owner_user_id IS NOT DISTINCT FROM w.user_id AND c.team_id IS NOT DISTINCT FROM w.team_id
          AND EXISTS(SELECT 1 FROM liekan_crawler_connection old WHERE old.id=ANY($3::uuid[]) AND old.domain=c.domain AND old.zone_id=c.zone_id)
          AND ($2 OR w.user_id=$1::uuid OR EXISTS(SELECT 1 FROM team_user tu JOIN team t ON t.team_id=tu.team_id WHERE tu.team_id=w.team_id AND tu.user_id=$1::uuid AND t.deleted_at IS NULL))
          ORDER BY c.website_id,c.id LIMIT 100`,
          actor.id,
          user.role === 'admin',
          connections.map(connection => connection.id),
        )
      : [];
    const recoveryConnections = [];
    for (const candidate of candidates) {
      try {
        const context = await controlContext(tx, actor, candidate.website_id, 'control');
        assertConnectionContext(context, candidate);
        recoveryConnections.push({
          websiteId: candidate.website_id,
          connectionId: candidate.id,
          websiteName: candidate.websiteName,
          domain: candidate.domain,
          zoneId: candidate.zone_id,
        });
      } catch (error) {
        if (!(error instanceof LiekanError) || ![400, 403, 404, 409].includes(error.status))
          throw error;
      }
    }
    const result = [];
    for (const connection of connections) {
      const policies = await tx.query<PolicyRow>(
        'SELECT * FROM liekan_crawler_policy WHERE connection_id=$1::uuid ORDER BY created_at,id',
        connection.id,
      );
      const deployments = await tx.query<DeploymentRow>(
        'SELECT * FROM liekan_crawler_deployment WHERE connection_id=$1::uuid ORDER BY created_at DESC LIMIT 30',
        connection.id,
      );
      let canRecover = false;
      try {
        await authorizeCrawlerHandoff(tx, actor, connection);
        canRecover = true;
      } catch (error) {
        // Handoff viewing includes team readers; recovery additionally needs original-space management.
        if (!(error instanceof LiekanError) || ![401, 403, 404].includes(error.status)) throw error;
      }
      result.push({
        recoveryConnections: canRecover
          ? recoveryConnections.filter(
              candidate =>
                candidate.domain === connection.domain && candidate.zoneId === connection.zone_id,
            )
          : [],
        connection: connectionDto(connection),
        policies: policies.map(policyDto),
        deployments: deployments.map(deploymentDto),
        instruction:
          '本地断开不会撤销 Cloudflare Token，也不会删除远端规则。请在原 Zone 核对列出的规则 ID。',
      });
    }
    return { handoffs: result };
  });
}
