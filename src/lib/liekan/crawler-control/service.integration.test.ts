// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { aiTransaction } from '../upstream/ai-db';
import { CrawlerProviderError, type CloudflareCrawlerSnapshot } from './cloudflare';
import { openPlatformSecret } from '../log-ingestion/secrets';
import {
  connectCrawlerConnection,
  createCrawlerPolicy,
  disconnectCrawlerConnection,
  getCrawlerPolicy,
  listCrawlerHandoffs,
  listCrawlerPolicies,
  resumeCrawlerControl,
  updateCrawlerPolicy,
} from './service';
import {
  confirmCrawlerPolicy,
  previewCrawlerAdoption,
  confirmCrawlerAdoption,
  getCrawlerDeployment,
  previewCrawlerPolicy,
  processCrawlerDeployment,
  reconcileCrawlerDeployment,
  reconcileCrawlerHandoffDeployment,
} from './deployments';
import { POST as connectPOST } from '@/app/api/liekan/websites/[websiteId]/control-connections/route';
import { POST as handoffPOST } from '@/app/api/liekan/crawler-handoffs/reconcile/route';
import type { CrawlerPolicyInput } from '../contracts/crawlers';
const h = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), auth: null as any }));
vi.mock('@/lib/auth', () => ({ checkAuth: vi.fn(async () => h.auth) }));
vi.mock('./cloudflare', async original => ({
  ...(await original<any>()),
  readCrawlerCloudflare: h.read,
  writeCrawlerCloudflare: h.write,
}));
const enabled = process.env.LIEKAN_CRAWLER_TEST === '1';
describe.skipIf(!enabled)('persistent crawler control on isolated PostgreSQL', () => {
  const owner = randomUUID(),
    admin = randomUUID(),
    other = randomUUID(),
    member = randomUUID();
  const actor = { id: owner, role: 'user' },
    administrator = { id: admin, role: 'admin' };
  const q = <T = any>(sql: string, ...params: unknown[]) =>
    aiTransaction(tx => tx.query<T>(sql, ...params));
  let site: string,
    zone: string,
    team: string | null,
    initialPaused: boolean,
    snapshot: CloudflareCrawlerSnapshot;
  const ids: string[] = [];
  const extraSites: string[] = [];
  const policyBody = (overrides: Partial<CrawlerPolicyInput> = {}): CrawlerPolicyInput => ({
    name: 'test-demo-block',
    botIds: ['gptbot'],
    paths: [{ value: '/docs', match: 'prefix' }],
    action: 'block',
    expectedAccess: 'block',
    ...overrides,
  });
  const create = (body = policyBody()) => createCrawlerPolicy(actor, site, body);
  const connect = () =>
    connectCrawlerConnection(actor, site, {
      zoneId: zone,
      token: 'test-only-independent-control-token',
    });
  const preview = (
    policyId: string,
    operation: 'deploy' | 'stop' | 'cleanup' | 'rollback' = 'deploy',
    targetVersion?: number,
  ) =>
    previewCrawlerPolicy(actor, site, policyId, {
      operation,
      ...(targetVersion ? { targetVersion } : {}),
    });
  async function queued(
    policyId: string,
    operation: 'deploy' | 'stop' | 'cleanup' | 'rollback' = 'deploy',
    targetVersion?: number,
  ) {
    const p = await preview(policyId, operation, targetVersion),
      id = randomUUID();
    await confirmCrawlerPolicy(actor, site, policyId, operation, {
      operationId: id,
      previewId: p.id,
    });
    return { id, preview: p };
  }
  async function run() {
    const id = randomUUID();
    ids.push(id);
    return processCrawlerDeployment(id);
  }
  const getWrite = () => {
    const implementation = h.write.getMockImplementation();
    if (!implementation) throw new Error('Expected provider stub');
    return implementation;
  };
  async function applied() {
    await connect();
    const policy = await create(),
      job = await queued(policy.id);
    await run();
    return { policy, job };
  }
  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL || 'http://invalid');
    if (
      target.hostname !== '127.0.0.1' ||
      target.port !== '15440' ||
      target.pathname !== '/liekan_crawler_acceptance'
    )
      throw new Error('Only the named isolated crawler acceptance database is permitted');
    process.env.LIEKAN_LOG_CREDENTIALS_KEY = Buffer.alloc(32, 17).toString('base64');
    initialPaused = (
      await q('SELECT control_paused FROM liekan_crawler_instance WHERE singleton=true')
    )[0].control_paused;
    for (const [id, role] of [
      [owner, 'user'],
      [admin, 'admin'],
      [other, 'user'],
      [member, 'user'],
    ])
      await q(
        'INSERT INTO "user"(user_id,username,password,role) VALUES($1::uuid,$2,$3,$4)',
        id,
        `test-demo-control-${id}`,
        'test-demo-no-login',
        role,
      );
  });
  beforeEach(async () => {
    site = randomUUID();
    zone = randomUUID().replaceAll('-', '');
    team = null;
    await q(
      'INSERT INTO website(website_id,name,domain,user_id) VALUES($1::uuid,$2,$3,$4::uuid)',
      site,
      'test-demo-control',
      'example.com',
      owner,
    );
    await q('UPDATE liekan_crawler_instance SET control_paused=false');
    snapshot = {
      rulesetId: 'a'.repeat(32),
      rules: [],
      zone: { name: 'example.com', plan: 'Free' },
      quota: 5,
    };
    h.auth = { authType: 'session', user: actor };
    h.read.mockReset();
    h.write.mockReset();
    h.read.mockImplementation(async () => structuredClone(snapshot));
    h.write.mockImplementation(async (_token, _zone, _snapshot, previous, target) => {
      if (previous) {
        const index = snapshot.rules.findIndex(r => r.id === previous.id);
        if (target) snapshot.rules[index] = { ...target, id: previous.id };
        else snapshot.rules.splice(index, 1);
      } else if (target) snapshot.rules.push({ ...target, id: randomUUID().replaceAll('-', '') });
    });
  });
  afterEach(async () => {
    for (const fixtureSite of [site, ...extraSites.splice(0)]) {
      for (const table of ['liekan_crawler_deployment', 'liekan_crawler_preview'])
        await q(`DELETE FROM ${table} WHERE website_id=$1::uuid`, fixtureSite);
      await q(
        'DELETE FROM liekan_crawler_policy_version WHERE policy_id IN(SELECT id FROM liekan_crawler_policy WHERE website_id=$1::uuid)',
        fixtureSite,
      );
      for (const table of [
        'liekan_crawler_policy',
        'liekan_crawler_connection',
        'liekan_crawler_state',
      ])
        await q(`DELETE FROM ${table} WHERE website_id=$1::uuid`, fixtureSite);
      await q('DELETE FROM website WHERE website_id=$1::uuid', fixtureSite);
    }
    if (team) {
      await q('DELETE FROM team_user WHERE team_id=$1::uuid', team);
      await q('DELETE FROM team WHERE team_id=$1::uuid', team);
    }
    await q(
      'DELETE FROM liekan_crawler_lease WHERE name=$1 OR name=$2',
      `crawler:${zone}`,
      `crawler-local:${site}`,
    );
    await q('UPDATE "user" SET role=$2 WHERE user_id=$1::uuid', owner, 'user');
  });
  afterAll(async () => {
    if (!enabled) return;
    await q('UPDATE liekan_crawler_instance SET control_paused=$1', initialPaused);
    for (const id of [owner, admin, other, member])
      await q('DELETE FROM "user" WHERE user_id=$1::uuid', id);
    await prisma.client.$disconnect();
  });
  it('connects by reads, seals independent credentials with exact AAD and masks every response', async () => {
    const connection = await connect();
    expect(h.write).not.toHaveBeenCalled();
    expect(connection.capabilities).toMatchObject({
      quota: 5,
      used: 0,
      plan: 'Free',
      rulesReadable: true,
      writeVerified: false,
    });
    expect(connection.testedAt).toEqual(expect.any(String));
    expect(connection.tokenMask).toBe('••••••••');
    expect(JSON.stringify(connection)).not.toContain('test-only-independent');
    const [stored] = await q(
      'SELECT token_encrypted FROM liekan_crawler_connection WHERE id=$1::uuid',
      connection.id,
    );
    expect(
      openPlatformSecret(stored.token_encrypted, `crawler-control:${connection.id}:${site}`),
    ).toBe('test-only-independent-control-token');
    expect(() =>
      openPlatformSecret(
        stored.token_encrypted,
        `crawler-control:${connection.id}:${randomUUID()}`,
      ),
    ).toThrow();
    await expect(connect()).rejects.toMatchObject({ status: 409 });
    expect(h.read).toHaveBeenCalledTimes(1);
  });
  it('rejects partial, public-share, API-key and foreign-website requests at the real route', async () => {
    for (const value of [
      { authType: 'partial' },
      { authType: 'api-key', user: actor },
      { authType: 'session', shareToken: {}, user: actor },
      { authType: 'session', user: { id: other, role: 'admin' } },
    ]) {
      h.auth = value;
      const result = await connectPOST(
        new Request(`http://localhost/api/liekan/websites/${site}/control-connections`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ zoneId: zone, token: 'test-only-token' }),
        }),
        { params: Promise.resolve({ websiteId: site }) },
      );
      expect(result.status).toBe(value.user?.id === other ? 404 : 401);
    }
    expect(h.read).not.toHaveBeenCalled();
  });
  it('keeps local observe available to team members while instance control is paused', async () => {
    team = randomUUID();
    await q('INSERT INTO team(team_id,name) VALUES($1::uuid,$2)', team, 'test-demo-control-team');
    await q(
      'INSERT INTO team_user(team_user_id,team_id,user_id,role) VALUES($1::uuid,$2::uuid,$3::uuid,$4)',
      randomUUID(),
      team,
      member,
      'team-member',
    );
    await q(
      'UPDATE website SET user_id=NULL,team_id=$2::uuid WHERE website_id=$1::uuid',
      site,
      team,
    );
    await q('UPDATE liekan_crawler_instance SET control_paused=true');
    const memberActor = { id: member, role: 'user' },
      policy = await createCrawlerPolicy(memberActor, site, policyBody({ action: 'observe' }));
    const p = await previewCrawlerPolicy(memberActor, site, policy.id, { operation: 'deploy' });
    expect(p.localOnly).toBe(true);
    expect(p.expression).toBeNull();
    const id = randomUUID();
    await confirmCrawlerPolicy(memberActor, site, policy.id, 'deploy', {
      operationId: id,
      previewId: p.id,
    });
    await run();
    expect(await getCrawlerDeployment(memberActor, site, id)).toMatchObject({
      state: 'confirmed',
      result: { localOnly: true },
    });
    expect(h.read).not.toHaveBeenCalled();
    expect(h.write).not.toHaveBeenCalled();
    await expect(
      connectCrawlerConnection(memberActor, site, { zoneId: zone, token: 'test-only-token' }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('enforces twenty drafts, optimistic versions and immutable version history', async () => {
    const policy = await create();
    const updated = await updateCrawlerPolicy(actor, site, policy.id, {
      ...policyBody({ name: 'v2' }),
      version: 1,
    });
    expect(updated.version).toBe(2);
    await expect(
      updateCrawlerPolicy(actor, site, policy.id, { ...policyBody(), version: 1 }),
    ).rejects.toMatchObject({ status: 409 });
    const detail = await getCrawlerPolicy(actor, site, policy.id);
    expect(detail.versions.map(row => row.version)).toEqual([2, 1]);
    expect(detail.versions[1].body.name).toBe('test-demo-block');
    for (let i = 1; i < 20; i++) await create();
    await expect(create()).rejects.toMatchObject({ status: 409 });
  });
  it('binds concrete preview to exact host and path, exposes search/full-site impact and unknown other-rule effects', async () => {
    await connect();
    const policy = await create(
      policyBody({
        botIds: ['googlebot', 'oai-searchbot'],
        paths: [{ value: '/', match: 'prefix' }],
      }),
    );
    const p = await preview(policy.id);
    expect(p.expression).toContain('http.host eq "example.com"');
    expect(p.expression).toContain('raw.http.request.uri.path');
    expect(p.impact).toMatchObject({
      searchBots: ['googlebot', 'oai-searchbot'],
      fullSite: true,
      otherRules: 'unknown',
      historicalRequests7d: {
        basis: 'historical_estimate',
        requests: null,
        unclassified: 0,
        state: 'missing',
      },
    });
    expect(h.write).not.toHaveBeenCalled();
    expect(p.capabilities.quota).toBe(5);
  });
  it('uses operation UUID idempotency and rejects changed payload and reused previews', async () => {
    await connect();
    const policy = await create(),
      p = await preview(policy.id),
      operationId = randomUUID(),
      input = { operationId, previewId: p.id };
    const values = await Promise.all([
      confirmCrawlerPolicy(actor, site, policy.id, 'deploy', input),
      confirmCrawlerPolicy(actor, site, policy.id, 'deploy', input),
    ]);
    expect(values[0].id).toBe(values[1].id);
    expect(
      (
        await q(
          'SELECT count(*)::int AS count FROM liekan_crawler_deployment WHERE website_id=$1::uuid',
          site,
        )
      )[0].count,
    ).toBe(1);
    await expect(confirmCrawlerPolicy(actor, site, policy.id, 'stop', input)).rejects.toMatchObject(
      { status: 409 },
    );
    await expect(
      confirmCrawlerPolicy(actor, site, policy.id, 'deploy', {
        operationId: randomUUID(),
        previewId: p.id,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await run();
    await expect(
      confirmCrawlerPolicy(actor, site, policy.id, 'deploy', input),
    ).resolves.toMatchObject({ state: 'confirmed' });
  });
  it.each(['expired', 'version', 'generation', 'actor'] as const)(
    'rejects %s stale previews before queueing',
    async change => {
      await connect();
      const policy = await create(),
        p = await preview(policy.id);
      if (change === 'expired')
        await q(
          "UPDATE liekan_crawler_preview SET expires_at=now()-interval '1 second' WHERE id=$1::uuid",
          p.id,
        );
      if (change === 'version')
        await updateCrawlerPolicy(actor, site, policy.id, {
          ...policyBody({ name: 'changed' }),
          version: 1,
        });
      if (change === 'generation')
        await q(
          'UPDATE liekan_crawler_state SET generation=generation+1 WHERE website_id=$1::uuid',
          site,
        );
      if (change === 'actor')
        await q(
          'UPDATE liekan_crawler_preview SET actor_id=$2::uuid WHERE id=$1::uuid',
          p.id,
          other,
        );
      await expect(
        confirmCrawlerPolicy(actor, site, policy.id, 'deploy', {
          operationId: randomUUID(),
          previewId: p.id,
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(h.write).not.toHaveBeenCalled();
    },
  );
  it('does not execute a queued preview after expiry or revoked current role', async () => {
    await connect();
    const policy = await create(),
      job = await queued(policy.id);
    await q(
      "UPDATE liekan_crawler_preview SET expires_at=now()-interval '1 second' WHERE id=$1::uuid",
      job.preview.id,
    );
    await run();
    expect(await getCrawlerDeployment(actor, site, job.id)).toMatchObject({ state: 'conflict' });
    expect(h.write).not.toHaveBeenCalled();
    const second = await queued(policy.id);
    await q('UPDATE "user" SET role=$2 WHERE user_id=$1::uuid', owner, 'view-only');
    await run();
    expect(await getCrawlerDeployment(actor, site, second.id)).toMatchObject({ state: 'failed' });
    expect(h.write).not.toHaveBeenCalled();
  });
  it('allows one worker write across concurrent replicas and preserves unrelated rule order', async () => {
    snapshot.rules = [
      {
        id: 'b'.repeat(32),
        ref: 'other-owner',
        action: 'skip',
        enabled: true,
        description: 'keep',
        expression: 'true',
      },
    ];
    await connect();
    const policy = await create(),
      job = await queued(policy.id),
      otherRule = structuredClone(snapshot.rules[0]);
    await Promise.all([run(), run(), run()]);
    expect(h.write).toHaveBeenCalledTimes(1);
    expect(await getCrawlerDeployment(actor, site, job.id)).toMatchObject({
      state: 'confirmed',
      result: { ruleId: expect.any(String), rulesetId: 'a'.repeat(32) },
    });
    expect(snapshot.rules[0]).toEqual(otherRule);
  });
  it('holds a zone lease across sites and executes no provider calls when the lease is occupied', async () => {
    await connect();
    const policy = await create(),
      job = await queued(policy.id);
    await q(
      "INSERT INTO liekan_crawler_lease(name,owner,expires_at) VALUES($1,$2::uuid,now()+interval '2 minutes')",
      `crawler:${zone}`,
      randomUUID(),
    );
    h.read.mockClear();
    await run();
    expect(h.read).not.toHaveBeenCalled();
    expect(h.write).not.toHaveBeenCalled();
    expect(await getCrawlerDeployment(actor, site, job.id)).toMatchObject({ state: 'queued' });
  });
  it('detects manual edits including description and never overwrites the changed rule', async () => {
    const { policy } = await applied();
    const job = await queued(policy.id, 'stop');
    h.write.mockClear();
    snapshot.rules[0].description += ' manual';
    await run();
    expect(await getCrawlerDeployment(actor, site, job.id)).toMatchObject({ state: 'conflict' });
    expect(h.write).not.toHaveBeenCalled();
  });
  it('rejects collisions with a registered ref when no remote ID was previously owned', async () => {
    await connect();
    const policy = await create();
    snapshot.rules.push({
      id: 'c'.repeat(32),
      ref: policy.ref,
      action: 'block',
      expression: 'true',
      description: 'manual',
      enabled: true,
    });
    await expect(preview(policy.id)).rejects.toMatchObject({ status: 409 });
    expect(h.write).not.toHaveBeenCalled();
  });
  it('distinguishes draft version from the applied version and rolls back immutable earlier bodies', async () => {
    const { policy } = await applied();
    const v2 = await updateCrawlerPolicy(actor, site, policy.id, {
      ...policyBody({ name: 'v2', paths: [{ value: '/v2', match: 'exact' }] }),
      version: 1,
    });
    expect(v2).toMatchObject({ version: 2, appliedVersion: 1, state: 'enabled' });
    expect(snapshot.rules[0].expression).toContain('/docs');
    const deploy = await queued(policy.id);
    await run();
    expect(await getCrawlerDeployment(actor, site, deploy.id)).toMatchObject({
      state: 'confirmed',
    });
    expect(snapshot.rules[0].expression).toContain('/v2');
    const rollback = await queued(policy.id, 'rollback', 1);
    await run();
    expect(await getCrawlerDeployment(actor, site, rollback.id)).toMatchObject({
      state: 'confirmed',
    });
    expect((await getCrawlerPolicy(actor, site, policy.id)).policy).toMatchObject({
      version: 2,
      appliedVersion: 1,
      name: 'v2',
    });
    expect(snapshot.rules[0].expression).toContain('/docs');
  });
  it('disables exactly the owned rule on stop and deletes only that rule on cleanup', async () => {
    const { policy } = await applied();
    const stop = await queued(policy.id, 'stop');
    await run();
    expect(snapshot.rules[0].enabled).toBe(false);
    expect(await getCrawlerDeployment(actor, site, stop.id)).toMatchObject({ state: 'confirmed' });
    const previousId = snapshot.rules[0].id,
      cleanup = await queued(policy.id, 'cleanup');
    await run();
    expect(snapshot.rules).toEqual([]);
    expect(await getCrawlerDeployment(actor, site, cleanup.id)).toMatchObject({
      state: 'confirmed',
      result: { ruleId: previousId },
    });
    expect((await getCrawlerPolicy(actor, site, policy.id)).policy).toMatchObject({
      state: 'stopped',
      remoteRuleId: null,
    });
  });
  it('requires cleanup before switching an existing remote rule to local observe', async () => {
    const { policy } = await applied();
    await updateCrawlerPolicy(actor, site, policy.id, {
      ...policyBody({ action: 'observe' }),
      version: 1,
    });
    await expect(preview(policy.id)).rejects.toMatchObject({ status: 409 });
    expect(snapshot.rules[0].enabled).toBe(true);
  });
  it('reconciles an uncertain accepted create by readback without issuing another mutation', async () => {
    await connect();
    const policy = await create(),
      job = await queued(policy.id),
      normal = getWrite();
    h.write.mockImplementation(async (...args) => {
      await normal(...args);
      throw new CrawlerProviderError('provider-network', true);
    });
    await run();
    expect(await getCrawlerDeployment(actor, site, job.id)).toMatchObject({ state: 'unknown' });
    expect(h.write).toHaveBeenCalledTimes(1);
    expect(await reconcileCrawlerDeployment(actor, site, job.id)).toMatchObject({
      state: 'confirmed',
    });
    expect(h.write).toHaveBeenCalledTimes(1);
  });
  it('keeps uncertain absent creates unknown, then permits an explicit read-verified not-applied resolution', async () => {
    await connect();
    const policy = await create(),
      job = await queued(policy.id);
    h.write.mockRejectedValue(new CrawlerProviderError('provider-network', true));
    await run();
    expect(await reconcileCrawlerDeployment(actor, site, job.id)).toMatchObject({
      state: 'unknown',
    });
    await expect(preview(policy.id)).rejects.toMatchObject({ status: 409 });
    expect(
      await reconcileCrawlerDeployment(actor, site, job.id, { acknowledgeNotApplied: true }),
    ).toMatchObject({ state: 'failed', errorCode: 'operator-confirmed-not-applied' });
    expect(h.write).toHaveBeenCalledTimes(1);
    await expect(preview(policy.id)).resolves.toMatchObject({ localOnly: false });
  });
  it('keeps post-write read failures unknown and reads before any future mutation', async () => {
    await connect();
    const policy = await create(),
      job = await queued(policy.id),
      normal = getWrite();
    h.write.mockImplementation(async (...args) => {
      await normal(...args);
      h.read.mockRejectedValue(new CrawlerProviderError('provider-rejected', false, 503));
    });
    await run();
    expect(await getCrawlerDeployment(actor, site, job.id)).toMatchObject({ state: 'unknown' });
    await q(
      "UPDATE liekan_crawler_deployment SET updated_at=now()-interval '2 minutes' WHERE id=$1::uuid",
      job.id,
    );
    await run();
    expect(await getCrawlerDeployment(actor, site, job.id)).toMatchObject({ state: 'unknown' });
    expect(h.write).toHaveBeenCalledTimes(1);
    h.read.mockImplementation(async () => structuredClone(snapshot));
    expect(await reconcileCrawlerDeployment(actor, site, job.id)).toMatchObject({
      state: 'confirmed',
    });
  });
  it('treats mismatching readback as conflict without an automatic overwrite', async () => {
    await connect();
    const policy = await create(),
      job = await queued(policy.id),
      normal = getWrite();
    h.write.mockImplementation(async (...args) => {
      await normal(...args);
      snapshot.rules[0].enabled = false;
    });
    await run();
    expect(await getCrawlerDeployment(actor, site, job.id)).toMatchObject({ state: 'conflict' });
    expect(h.write).toHaveBeenCalledTimes(1);
  });
  it('recovers an expired running create as unknown and never retries its mutation', async () => {
    await connect();
    const policy = await create(),
      job = await queued(policy.id);
    await q(
      "UPDATE liekan_crawler_deployment SET state='running',attempts=1,lease_until=now()-interval '1 second' WHERE id=$1::uuid",
      job.id,
    );
    await run();
    expect(await getCrawlerDeployment(actor, site, job.id)).toMatchObject({ state: 'unknown' });
    expect(h.write).not.toHaveBeenCalled();
  });
  it('records accepted provider facts even when the actor loses control permission during the write', async () => {
    await connect();
    const policy = await create(),
      job = await queued(policy.id),
      normal = getWrite();
    h.write.mockImplementation(async (...args) => {
      await normal(...args);
      await q('UPDATE "user" SET role=$2 WHERE user_id=$1::uuid', owner, 'view-only');
    });
    await run();
    expect(await getCrawlerDeployment(actor, site, job.id)).toMatchObject({
      state: 'confirmed',
      result: { ruleId: expect.any(String) },
    });
  });
  it('destroys credentials immediately on normal disconnect and cancels queued writes while preserving handoffs', async () => {
    const connection = await connect(),
      policy = await create(),
      job = await queued(policy.id);
    const disconnected = await disconnectCrawlerConnection(actor, site, connection.id);
    expect(disconnected).toMatchObject({
      remoteTokenRevoked: false,
      rulesRetained: true,
      connection: { state: 'disconnected', tokenMask: null },
    });
    expect(
      (
        await q(
          'SELECT token_encrypted FROM liekan_crawler_connection WHERE id=$1::uuid',
          connection.id,
        )
      )[0].token_encrypted,
    ).toBeNull();
    await run();
    expect(h.write).not.toHaveBeenCalled();
    expect(await getCrawlerDeployment(actor, site, job.id)).toMatchObject({ state: 'failed' });
    expect(
      (await listCrawlerHandoffs(actor)).handoffs.some(h => h.connection.id === connection.id),
    ).toBe(true);
    expect(
      (await listCrawlerHandoffs({ id: other, role: 'admin' })).handoffs.some(
        h => h.connection.id === connection.id,
      ),
    ).toBe(false);
  });
  it('does not retain credentials for ordinary unknown writes or for cleanup that was only previewed', async () => {
    const connection = await connect(),
      policy = await create(),
      job = await queued(policy.id);
    h.write.mockRejectedValue(new CrawlerProviderError('provider-network', true));
    await run();
    await expect(
      disconnectCrawlerConnection(actor, site, connection.id, { retainForConfirmedCleanup: true }),
    ).rejects.toMatchObject({ status: 409 });
    await disconnectCrawlerConnection(actor, site, connection.id);
    expect(
      (
        await q(
          'SELECT token_encrypted FROM liekan_crawler_connection WHERE id=$1::uuid',
          connection.id,
        )
      )[0].token_encrypted,
    ).toBeNull();
    expect(await getCrawlerDeployment(actor, site, job.id)).toMatchObject({ state: 'unknown' });
  });
  it('retains seven-day credentials only for a confirmed per-rule cleanup and still executes the explicit cleanup', async () => {
    const { policy } = await applied(),
      connection = (await listCrawlerPolicies(actor, site)).connections[0],
      cleanup = await queued(policy.id, 'cleanup');
    const result = await disconnectCrawlerConnection(actor, site, connection.id, {
      retainForConfirmedCleanup: true,
    });
    expect(result.connection).toMatchObject({ state: 'cleanup', tokenMask: '••••••••' });
    expect(+new Date(result.connection.cleanupUntil || 0) - Date.now()).toBeLessThanOrEqual(
      7 * 86400000,
    );
    await run();
    expect(await getCrawlerDeployment(actor, site, cleanup.id)).toMatchObject({
      state: 'confirmed',
    });
    expect(snapshot.rules).toEqual([]);
  });
  it('requires fresh administrator resume, invalidates stale previews and cancels restored queued jobs', async () => {
    await connect();
    const policy = await create(),
      job = await queued(policy.id);
    await q('UPDATE liekan_crawler_instance SET control_paused=true');
    await run();
    expect(h.write).not.toHaveBeenCalled();
    await expect(resumeCrawlerControl(actor, site, { resume: true })).rejects.toMatchObject({
      status: 403,
    });
    expect(await resumeCrawlerControl(administrator, site, { resume: true })).toMatchObject({
      controlPaused: false,
      reconciledConnections: 1,
    });
    expect(await getCrawlerDeployment(actor, site, job.id)).toMatchObject({
      state: 'failed',
      errorCode: 'instance-control-reset',
    });
    await expect(
      confirmCrawlerPolicy(actor, site, policy.id, 'deploy', {
        operationId: randomUUID(),
        previewId: job.preview.id,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(preview(policy.id)).resolves.toMatchObject({ operation: 'deploy' });
  });

  it('rejects a consumed terminal preview with a new operation ID', async () => {
    await connect();
    const policy = await create(),
      job = await queued(policy.id);
    await run();
    await expect(
      confirmCrawlerPolicy(actor, site, policy.id, 'deploy', {
        operationId: randomUUID(),
        previewId: job.preview.id,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('estimates seven-day historical literal segment matches and reports unclassified evidence separately', async () => {
    const imported = randomUUID();
    await q(
      'INSERT INTO liekan_import(id,website_id,digest,accepted,rejected) VALUES($1::uuid,$2::uuid,$3,5,0)',
      imported,
      site,
      randomUUID(),
    );
    for (const [, path, bot] of [
      [0, '/docs', 'gptbot'],
      [1, '/docs/a', 'gptbot'],
      [2, '/docs-private', 'gptbot'],
      [3, '/docs', 'googlebot'],
      [4, '/docs', null],
    ] as const) {
      const id = randomUUID();
      await q(
        `INSERT INTO liekan_log(id,website_id,import_id,created_at,path,method,status,bytes,ip_masked,ip_hash,user_agent,location,bot,vendor,bot_type,verification)
        VALUES($1,$2::uuid,$3::uuid,now()-interval '1 hour',$4,'GET',200,0,'','','test-demo','','test-demo','','','unverified')`,
        id,
        site,
        imported,
        path,
      );
      if (bot)
        await q(
          'INSERT INTO liekan_crawler_evidence(website_id,log_id,crawler_id) VALUES($1::uuid,$2,$3)',
          site,
          id,
          bot,
        );
    }
    await connect();
    const policy = await create(),
      p = await preview(policy.id);
    expect(p.impact.historicalRequests7d).toMatchObject({
      requests: 2,
      unclassified: 1,
      observedRequests: 5,
      state: 'partial',
      basis: 'historical_estimate',
    });
  });
  it('invalidates a preview when current capability or quota facts change', async () => {
    const connection = await connect(),
      policy = await create(),
      p = await preview(policy.id);
    await q(
      `UPDATE liekan_crawler_connection SET capabilities=capabilities||'{"quota":20}'::jsonb WHERE id=$1::uuid`,
      connection.id,
    );
    await expect(
      confirmCrawlerPolicy(actor, site, policy.id, 'deploy', {
        operationId: randomUUID(),
        previewId: p.id,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('destroys retained cleanup credentials immediately after the last confirmed rule cleanup', async () => {
    const { policy } = await applied(),
      connection = (await listCrawlerPolicies(actor, site)).connections[0];
    await queued(policy.id, 'cleanup');
    await disconnectCrawlerConnection(actor, site, connection.id, {
      retainForConfirmedCleanup: true,
    });
    await run();
    expect((await listCrawlerPolicies(actor, site)).connections[0]).toMatchObject({
      state: 'disconnected',
      tokenMask: null,
      cleanupUntil: null,
    });
  });

  it('uses separate zone leases even for concurrent calls from the same worker process', async () => {
    await connect();
    const first = await create(),
      second = await create();
    const a = await queued(first.id),
      b = await queued(second.id);
    let notify: () => void = () => {},
      release: () => void = () => {};
    const started = new Promise<void>(resolve => {
        notify = resolve;
      }),
      blocked = new Promise<void>(resolve => {
        release = resolve;
      });
    h.read.mockImplementationOnce(async () => {
      notify();
      await blocked;
      return structuredClone(snapshot);
    });
    const workerId = randomUUID(),
      running = processCrawlerDeployment(workerId);
    await started;
    try {
      await processCrawlerDeployment(workerId);
      expect(h.write).not.toHaveBeenCalled();
    } finally {
      release();
      await running;
    }
    expect(h.write).toHaveBeenCalledTimes(1);
    expect(await getCrawlerDeployment(actor, site, a.id)).toMatchObject({ state: 'confirmed' });
    expect(await getCrawlerDeployment(actor, site, b.id)).toMatchObject({ state: 'queued' });
  });
  it('quarantines new mutations in a zone until an unknown operation is read-reconciled', async () => {
    const connection = await connect(),
      first = await create(),
      second = await create(),
      unknown = await queued(first.id);
    h.write.mockRejectedValue(new CrawlerProviderError('provider-network', true));
    await run();
    const p = await preview(second.id);
    await expect(
      confirmCrawlerPolicy(actor, site, second.id, 'deploy', {
        operationId: randomUUID(),
        previewId: p.id,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await q(
      `UPDATE liekan_crawler_connection SET capabilities=capabilities||'{"quota":20}'::jsonb WHERE id=$1::uuid`,
      connection.id,
    );
    expect(
      await reconcileCrawlerDeployment(actor, site, unknown.id, { acknowledgeNotApplied: true }),
    ).toMatchObject({ state: 'failed' });
    await expect(queued(second.id)).resolves.toMatchObject({ id: expect.any(String) });
    expect(h.write).toHaveBeenCalledTimes(1);
  });

  it.each(['disconnected', 'frozen'] as const)(
    'preserves unknown Zone quarantine after %s connection replacement on the same website',
    async state => {
      const connection = await connect(),
        policy = await create(),
        unknown = await queued(policy.id);
      h.write.mockRejectedValue(new CrawlerProviderError('provider-network', true));
      await run();
      if (state === 'disconnected') await disconnectCrawlerConnection(actor, site, connection.id);
      else
        await q(
          "UPDATE liekan_crawler_connection SET state='frozen',token_encrypted=NULL WHERE id=$1::uuid",
          connection.id,
        );
      await connect();
      const replacementPolicy = await create(),
        p = await preview(replacementPolicy.id);
      await expect(
        confirmCrawlerPolicy(actor, site, replacementPolicy.id, 'deploy', {
          operationId: randomUUID(),
          previewId: p.id,
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(await getCrawlerDeployment(actor, site, unknown.id)).toMatchObject({
        state: 'unknown',
      });
      expect(h.write).toHaveBeenCalledTimes(1);
      await reconcileCrawlerDeployment(actor, site, unknown.id, { acknowledgeNotApplied: true });
      await expect(queued(replacementPolicy.id)).resolves.toMatchObject({ id: expect.any(String) });
    },
  );
  it.each(['disconnected', 'frozen'] as const)(
    'preserves unknown Zone quarantine across websites after the originating connection is %s',
    async state => {
      const connection = await connect(),
        policy = await create(),
        unknown = await queued(policy.id);
      h.write.mockRejectedValue(new CrawlerProviderError('provider-network', true));
      await run();
      if (state === 'disconnected') await disconnectCrawlerConnection(actor, site, connection.id);
      else
        await q(
          "UPDATE liekan_crawler_connection SET state='frozen',token_encrypted=NULL WHERE id=$1::uuid",
          connection.id,
        );
      const secondSite = randomUUID(),
        secondActor = { id: other, role: 'user' };
      extraSites.push(secondSite);
      await q(
        'INSERT INTO website(website_id,name,domain,user_id) VALUES($1::uuid,$2,$3,$4::uuid)',
        secondSite,
        'test-demo-shared-zone',
        'docs.example.com',
        other,
      );
      await connectCrawlerConnection(secondActor, secondSite, {
        zoneId: zone,
        token: 'test-only-second-owner-independent-token',
      });
      const replacementPolicy = await createCrawlerPolicy(secondActor, secondSite, policyBody()),
        p = await previewCrawlerPolicy(secondActor, secondSite, replacementPolicy.id, {
          operation: 'deploy',
        });
      await expect(
        confirmCrawlerPolicy(secondActor, secondSite, replacementPolicy.id, 'deploy', {
          operationId: randomUUID(),
          previewId: p.id,
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(await getCrawlerDeployment(actor, site, unknown.id)).toMatchObject({
        state: 'unknown',
      });
      expect(h.write).toHaveBeenCalledTimes(1);
      expect(
        await q('SELECT id FROM liekan_crawler_deployment WHERE website_id=$1::uuid', secondSite),
      ).toHaveLength(0);
    },
  );

  it.each(['disconnected', 'frozen'] as const)(
    'blocks already queued shared-Zone work after an unknown originating connection becomes %s',
    async state => {
      const connection = await connect(),
        policy = await create();
      await queued(policy.id);
      const secondSite = randomUUID(),
        secondActor = { id: other, role: 'user' };
      extraSites.push(secondSite);
      await q(
        'INSERT INTO website(website_id,name,domain,user_id) VALUES($1::uuid,$2,$3,$4::uuid)',
        secondSite,
        'test-demo-shared-zone-queued',
        'docs.example.com',
        other,
      );
      await connectCrawlerConnection(secondActor, secondSite, {
        zoneId: zone,
        token: 'test-only-second-owner-independent-token',
      });
      const secondPolicy = await createCrawlerPolicy(secondActor, secondSite, policyBody()),
        p = await previewCrawlerPolicy(secondActor, secondSite, secondPolicy.id, {
          operation: 'deploy',
        }),
        operationId = randomUUID();
      await confirmCrawlerPolicy(secondActor, secondSite, secondPolicy.id, 'deploy', {
        operationId,
        previewId: p.id,
      });
      h.write.mockRejectedValue(new CrawlerProviderError('provider-network', true));
      await run();
      if (state === 'disconnected') await disconnectCrawlerConnection(actor, site, connection.id);
      else
        await q(
          "UPDATE liekan_crawler_connection SET state='frozen',token_encrypted=NULL WHERE id=$1::uuid",
          connection.id,
        );
      await run();
      expect(await getCrawlerDeployment(secondActor, secondSite, operationId)).toMatchObject({
        state: 'conflict',
      });
      expect(h.write).toHaveBeenCalledTimes(1);
    },
  );

  it('can read-reconcile a disconnected uncertain create using a freshly admitted token for the same original Zone', async () => {
    const connection = await connect(),
      policy = await create(),
      job = await queued(policy.id);
    h.write.mockRejectedValue(new CrawlerProviderError('provider-network', true));
    await run();
    await disconnectCrawlerConnection(actor, site, connection.id);
    await connect();
    expect(
      await reconcileCrawlerDeployment(actor, site, job.id, { acknowledgeNotApplied: true }),
    ).toMatchObject({ state: 'failed' });
    await expect(preview(policy.id)).resolves.toMatchObject({ operation: 'deploy' });
    expect(h.write).toHaveBeenCalledTimes(1);
  });
  it('reports oversized expressions and invalid current hostnames as actionable validation errors', async () => {
    await connect();
    const policy = await create(
      policyBody({
        paths: Array.from({ length: 10 }, (_, i) => ({
          value: '/' + String(i) + 'a'.repeat(500),
          match: 'exact' as const,
        })),
      }),
    );
    await expect(preview(policy.id)).rejects.toMatchObject({ status: 400 });
    await q('UPDATE website SET domain=NULL WHERE website_id=$1::uuid', site);
    await expect(listCrawlerPolicies(actor, site)).rejects.toMatchObject({ status: 400 });
    expect(h.write).not.toHaveBeenCalled();
  });
  async function moveWebsiteToOtherOwner() {
    await q('UPDATE website SET user_id=$2::uuid WHERE website_id=$1::uuid', site, other);
    await q(
      'UPDATE liekan_crawler_state SET generation=generation+1 WHERE website_id=$1::uuid',
      site,
    );
    await q(
      "UPDATE liekan_crawler_connection SET state='frozen',token_encrypted=NULL WHERE website_id=$1::uuid AND state='active'",
      site,
    );
    const nextActor = { id: other, role: 'user' },
      connection = await connectCrawlerConnection(nextActor, site, {
        zoneId: zone,
        token: 'test-only-new-owner-independent-token',
      });
    return { nextActor, connection };
  }
  async function adopt(policyId: string, nextActor: { id: string; role: string }) {
    const p = await previewCrawlerAdoption(nextActor, site, policyId),
      id = randomUUID();
    await confirmCrawlerAdoption(nextActor, site, policyId, { operationId: id, previewId: p.id });
    await run();
    return { id, preview: p };
  }
  it('binds a same-generation replacement credential only after an explicit normal preview confirmation', async () => {
    const { policy } = await applied(),
      old = (await listCrawlerPolicies(actor, site)).connections[0];
    await disconnectCrawlerConnection(actor, site, old.id);
    const next = await connect();
    expect((await getCrawlerPolicy(actor, site, policy.id)).policy.connectionId).toBe(old.id);
    h.write.mockClear();
    const p = await preview(policy.id, 'stop');
    expect(p).toMatchObject({
      mode: 'apply',
      transfer: {
        previous: { connectionId: old.id, generation: 1 },
        next: { connectionId: next.id, generation: 1 },
      },
    });
    expect((await getCrawlerPolicy(actor, site, policy.id)).policy.connectionId).toBe(old.id);
    await confirmCrawlerPolicy(actor, site, policy.id, 'stop', {
      operationId: randomUUID(),
      previewId: p.id,
    });
    await run();
    expect((await getCrawlerPolicy(actor, site, policy.id)).policy).toMatchObject({
      connectionId: next.id,
      state: 'stopped',
      remoteRuleId: snapshot.rules[0].id,
    });
    expect(h.write).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])(
    'read-reconciles an uncertain replacement after a second credential rotation (accepted=%s)',
    async accepted => {
      const { policy } = await applied(),
        original = (await listCrawlerPolicies(actor, site)).connections[0],
        normal = getWrite();
      await disconnectCrawlerConnection(actor, site, original.id);
      const replacement = await connect(),
        job = await queued(policy.id, 'stop');
      expect(job.preview.transfer).toMatchObject({
        previous: { connectionId: original.id },
        next: { connectionId: replacement.id },
      });
      h.write.mockClear();
      h.write.mockImplementation(async (...args) => {
        if (accepted) await normal(...args);
        throw new CrawlerProviderError('provider-network', true);
      });
      await run();
      expect(await getCrawlerDeployment(actor, site, job.id)).toMatchObject({ state: 'unknown' });
      await disconnectCrawlerConnection(actor, site, replacement.id);
      const current = await connect();
      expect(await reconcileCrawlerDeployment(actor, site, job.id)).toMatchObject({
        state: accepted ? 'confirmed' : 'unknown',
      });
      if (!accepted)
        expect(
          await reconcileCrawlerDeployment(actor, site, job.id, { acknowledgeNotApplied: true }),
        ).toMatchObject({ state: 'failed' });
      const registered = accepted ? replacement.id : original.id;
      expect((await getCrawlerPolicy(actor, site, policy.id)).policy.connectionId).toBe(registered);
      expect(
        (await listCrawlerPolicies(actor, site)).connections.find(c => c.id === current.id),
      ).toMatchObject({ capabilities: { writeVerified: false } });
      expect(h.write).toHaveBeenCalledTimes(1);
      const next = await preview(policy.id);
      expect(next.transfer).toMatchObject({
        previous: { connectionId: registered },
        next: { connectionId: current.id },
      });
      expect((await getCrawlerPolicy(actor, site, policy.id)).policy.connectionId).toBe(registered);
      h.write.mockImplementation(normal);
      await confirmCrawlerPolicy(actor, site, policy.id, 'deploy', {
        operationId: randomUUID(),
        previewId: next.id,
      });
      await run();
      expect((await getCrawlerPolicy(actor, site, policy.id)).policy.connectionId).toBe(current.id);
      expect(h.write).toHaveBeenCalledTimes(2);
    },
  );
  it('requires a dedicated explicit adoption before the new owner can manage an old registered rule', async () => {
    const { policy } = await applied(),
      old = (await listCrawlerPolicies(actor, site)).connections[0],
      ruleId = snapshot.rules[0].id,
      { nextActor, connection } = await moveWebsiteToOtherOwner();
    h.write.mockClear();
    await expect(
      previewCrawlerPolicy(nextActor, site, policy.id, { operation: 'stop' }),
    ).rejects.toMatchObject({ status: 409 });
    const p = await previewCrawlerAdoption(nextActor, site, policy.id);
    expect(p).toMatchObject({
      mode: 'adopt',
      transfer: {
        previous: { connectionId: old.id, generation: 1, ownerUserId: owner },
        next: { connectionId: connection.id, generation: 2, ownerUserId: other },
      },
    });
    expect((await getCrawlerPolicy(nextActor, site, policy.id)).contextCurrent).toBe(false);
    await expect(
      confirmCrawlerPolicy(nextActor, site, policy.id, 'deploy', {
        operationId: randomUUID(),
        previewId: p.id,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const id = randomUUID();
    await confirmCrawlerAdoption(nextActor, site, policy.id, { operationId: id, previewId: p.id });
    await run();
    expect(await getCrawlerDeployment(nextActor, site, id)).toMatchObject({
      state: 'confirmed',
      mode: 'adopt',
      result: { mode: 'adopt', providerMutation: false, ruleId },
    });
    expect(h.write).not.toHaveBeenCalled();
    expect(await getCrawlerPolicy(nextActor, site, policy.id)).toMatchObject({
      contextCurrent: true,
      policy: { connectionId: connection.id, state: 'enabled', remoteRuleId: ruleId },
    });
    const stop = await previewCrawlerPolicy(nextActor, site, policy.id, { operation: 'stop' });
    await confirmCrawlerPolicy(nextActor, site, policy.id, 'stop', {
      operationId: randomUUID(),
      previewId: stop.id,
    });
    await run();
    expect(snapshot.rules[0].enabled).toBe(false);
    expect(h.write).toHaveBeenCalledTimes(1);
  });
  it.each(['hostname', 'zone', 'ref', 'rule-id', 'hash'] as const)(
    'rejects adoption when the original %s proof does not match',
    async change => {
      const { policy } = await applied();
      const { nextActor, connection } = await moveWebsiteToOtherOwner();
      h.write.mockClear();
      if (change === 'hostname')
        await q("UPDATE website SET domain='docs.example.com' WHERE website_id=$1::uuid", site);
      if (change === 'zone')
        await q(
          'UPDATE liekan_crawler_connection SET zone_id=$2 WHERE id=$1::uuid',
          connection.id,
          randomUUID().replaceAll('-', ''),
        );
      if (change === 'ref') snapshot.rules[0].ref = 'manually-reassigned-ref';
      if (change === 'rule-id') snapshot.rules[0].id = randomUUID().replaceAll('-', '');
      if (change === 'hash') snapshot.rules[0].logging = { enabled: true };
      await expect(previewCrawlerAdoption(nextActor, site, policy.id)).rejects.toMatchObject({
        status: 409,
      });
      expect(h.write).not.toHaveBeenCalled();
    },
  );
  it('rechecks generation at adoption confirmation and permissions immediately before local adoption', async () => {
    const { policy } = await applied(),
      { nextActor } = await moveWebsiteToOtherOwner(),
      p = await previewCrawlerAdoption(nextActor, site, policy.id);
    h.write.mockClear();
    await q(
      'UPDATE liekan_crawler_state SET generation=generation+1 WHERE website_id=$1::uuid',
      site,
    );
    await expect(
      confirmCrawlerAdoption(nextActor, site, policy.id, {
        operationId: randomUUID(),
        previewId: p.id,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const fresh = await previewCrawlerAdoption(nextActor, site, policy.id),
      id = randomUUID();
    await confirmCrawlerAdoption(nextActor, site, policy.id, {
      operationId: id,
      previewId: fresh.id,
    });
    await q('UPDATE "user" SET role=$2 WHERE user_id=$1::uuid', other, 'view-only');
    await run();
    expect(await getCrawlerDeployment(administrator, site, id)).toMatchObject({ state: 'failed' });
    expect((await getCrawlerPolicy(administrator, site, policy.id)).contextCurrent).toBe(false);
    expect(h.write).not.toHaveBeenCalled();
    await q('UPDATE "user" SET role=$2 WHERE user_id=$1::uuid', other, 'user');
  });
  it('rejects manual changes between adoption preview and worker readback without modifying the provider', async () => {
    const { policy } = await applied(),
      { nextActor } = await moveWebsiteToOtherOwner(),
      p = await previewCrawlerAdoption(nextActor, site, policy.id),
      id = randomUUID();
    h.write.mockClear();
    await confirmCrawlerAdoption(nextActor, site, policy.id, { operationId: id, previewId: p.id });
    snapshot.rules[0].action_parameters = { response: { status_code: 451, content: 'manual' } };
    await run();
    expect(await getCrawlerDeployment(nextActor, site, id)).toMatchObject({ state: 'conflict' });
    expect(h.write).not.toHaveBeenCalled();
    expect((await getCrawlerPolicy(nextActor, site, policy.id)).contextCurrent).toBe(false);
  });
  it('requires explicit handoff acknowledgement to resolve an old uncertain operation before separate adoption', async () => {
    const { policy } = await applied(),
      unknown = await queued(policy.id, 'stop');
    h.write.mockClear();
    h.write.mockRejectedValue(new CrawlerProviderError('provider-network', true));
    await run();
    const { nextActor, connection } = await moveWebsiteToOtherOwner();
    await expect(previewCrawlerAdoption(nextActor, site, policy.id)).rejects.toMatchObject({
      status: 409,
    });
    await expect(reconcileCrawlerDeployment(nextActor, site, unknown.id)).rejects.toMatchObject({
      status: 409,
    });
    expect(
      await reconcileCrawlerDeployment(nextActor, site, unknown.id, {
        acknowledgeNotApplied: true,
        acknowledgeHandoff: true,
        connectionId: connection.id,
      }),
    ).toMatchObject({ state: 'failed' });
    expect((await getCrawlerPolicy(nextActor, site, policy.id)).contextCurrent).toBe(false);
    const adopted = await adopt(policy.id, nextActor);
    expect(await getCrawlerDeployment(nextActor, site, adopted.id)).toMatchObject({
      state: 'confirmed',
      mode: 'adopt',
    });
    expect(h.write).toHaveBeenCalledTimes(1);
  });
  it('records read-confirmed old-generation provider facts without granting current-generation write authority', async () => {
    const { policy } = await applied(),
      unknown = await queued(policy.id, 'stop'),
      normal = getWrite();
    h.write.mockClear();
    h.write.mockImplementation(async (...args) => {
      await normal(...args);
      throw new CrawlerProviderError('provider-network', true);
    });
    await run();
    const { nextActor, connection } = await moveWebsiteToOtherOwner();
    expect(
      await reconcileCrawlerDeployment(nextActor, site, unknown.id, {
        acknowledgeNotApplied: false,
        acknowledgeHandoff: true,
        connectionId: connection.id,
      }),
    ).toMatchObject({ state: 'confirmed' });
    expect(await getCrawlerPolicy(nextActor, site, policy.id)).toMatchObject({
      contextCurrent: false,
      policy: { connectionId: expect.any(String), state: 'stopped' },
    });
    const adopted = await adopt(policy.id, nextActor);
    expect(await getCrawlerDeployment(nextActor, site, adopted.id)).toMatchObject({
      state: 'confirmed',
      mode: 'adopt',
    });
    expect((await getCrawlerPolicy(nextActor, site, policy.id)).policy.state).toBe('stopped');
    expect(h.write).toHaveBeenCalledTimes(1);
  });
  it.each(['logging', 'action_parameters'] as const)(
    'treats raced %s readback additions as conflict',
    async key => {
      await connect();
      const policy = await create(),
        job = await queued(policy.id),
        normal = getWrite();
      h.write.mockImplementation(async (...args) => {
        await normal(...args);
        snapshot.rules[0][key] =
          key === 'logging' ? { enabled: true } : { response: { status_code: 451 } };
      });
      await run();
      expect(await getCrawlerDeployment(actor, site, job.id)).toMatchObject({ state: 'conflict' });
      expect(h.write).toHaveBeenCalledTimes(1);
    },
  );

  it('registers an uncertain old-generation create only from read-confirmed operation facts before explicit adoption', async () => {
    await connect();
    const policy = await create(),
      unknown = await queued(policy.id),
      normal = getWrite();
    h.write.mockImplementation(async (...args) => {
      await normal(...args);
      throw new CrawlerProviderError('provider-network', true);
    });
    await run();
    const { nextActor, connection } = await moveWebsiteToOtherOwner();
    expect((await getCrawlerPolicy(nextActor, site, policy.id)).policy.remoteRuleId).toBeNull();
    expect(
      await reconcileCrawlerDeployment(nextActor, site, unknown.id, {
        acknowledgeNotApplied: false,
        acknowledgeHandoff: true,
        connectionId: connection.id,
      }),
    ).toMatchObject({ state: 'confirmed', result: { ruleId: snapshot.rules[0].id } });
    expect(await getCrawlerPolicy(nextActor, site, policy.id)).toMatchObject({
      contextCurrent: false,
      policy: { remoteRuleId: snapshot.rules[0].id },
    });
    const adopted = await adopt(policy.id, nextActor);
    expect(await getCrawlerDeployment(nextActor, site, adopted.id)).toMatchObject({
      state: 'confirmed',
      mode: 'adopt',
    });
    expect(h.write).toHaveBeenCalledTimes(1);
  });
  it('read-reconciles an interrupted adoption as unadopted and requires a fresh adoption preview', async () => {
    const { policy } = await applied(),
      { nextActor } = await moveWebsiteToOtherOwner(),
      p = await previewCrawlerAdoption(nextActor, site, policy.id),
      id = randomUUID();
    h.write.mockClear();
    await confirmCrawlerAdoption(nextActor, site, policy.id, { operationId: id, previewId: p.id });
    await q(
      "UPDATE liekan_crawler_deployment SET state='running',lease_until=now()-interval '1 second' WHERE id=$1::uuid",
      id,
    );
    await run();
    expect(await getCrawlerDeployment(nextActor, site, id)).toMatchObject({
      state: 'failed',
      errorCode: 'adoption-interrupted',
    });
    expect((await getCrawlerPolicy(nextActor, site, policy.id)).contextCurrent).toBe(false);
    expect(h.write).not.toHaveBeenCalled();
    const fresh = await adopt(policy.id, nextActor);
    expect(await getCrawlerDeployment(nextActor, site, fresh.id)).toMatchObject({
      state: 'confirmed',
      mode: 'adopt',
    });
    expect(h.write).not.toHaveBeenCalled();
  });

  async function deletedUnknown(accepted: boolean, operation: 'deploy' | 'stop' = 'stop') {
    if (operation === 'deploy') await connect();
    const { policy } = operation === 'stop' ? await applied() : { policy: await create() },
      original = (await listCrawlerPolicies(actor, site)).connections[0],
      job = await queued(policy.id, operation),
      normal = getWrite();
    h.write.mockClear();
    h.write.mockImplementation(async (...args) => {
      if (accepted) await normal(...args);
      throw new CrawlerProviderError('provider-network', true);
    });
    await run();
    await q(
      'UPDATE liekan_crawler_state SET generation=generation+1,deleted_at=now() WHERE website_id=$1::uuid',
      site,
    );
    await q(
      "UPDATE liekan_crawler_connection SET state='frozen',token_encrypted=NULL WHERE id=$1::uuid",
      original.id,
    );
    await q('DELETE FROM website WHERE website_id=$1::uuid', site);
    const currentSite = randomUUID();
    extraSites.push(currentSite);
    await q(
      'INSERT INTO website(website_id,name,domain,user_id) VALUES($1::uuid,$2,$3,$4::uuid)',
      currentSite,
      'test-demo-handoff-recovery',
      'example.com',
      owner,
    );
    const current = await connectCrawlerConnection(actor, currentSite, {
      zoneId: zone,
      token: 'test-only-handoff-read-credential',
    });
    return {
      policy,
      original,
      job,
      current,
      input: {
        deploymentId: job.id,
        websiteId: currentSite,
        connectionId: current.id,
        acknowledgeHandoff: true as const,
        acknowledgeNotApplied: false,
      },
    };
  }
  it.each([
    [true, 'deploy'],
    [true, 'stop'],
    [false, 'stop'],
  ] as const)(
    'read-reconciles deleted-site handoffs using current same-Zone credentials (accepted=%s, operation=%s)',
    async (accepted, operation) => {
      const { policy, original, job, current, input } = await deletedUnknown(accepted, operation);
      await expect(reconcileCrawlerDeployment(actor, site, job.id)).rejects.toMatchObject({
        status: 404,
      });
      const fresh = await createCrawlerPolicy(actor, input.websiteId, policyBody());
      const blocked = await previewCrawlerPolicy(actor, input.websiteId, fresh.id, {
        operation: 'deploy',
      });
      await expect(
        confirmCrawlerPolicy(actor, input.websiteId, fresh.id, 'deploy', {
          operationId: randomUUID(),
          previewId: blocked.id,
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(await reconcileCrawlerHandoffDeployment(actor, input)).toMatchObject({
        state: accepted ? 'confirmed' : 'unknown',
      });
      if (!accepted)
        expect(
          await reconcileCrawlerHandoffDeployment(actor, { ...input, acknowledgeNotApplied: true }),
        ).toMatchObject({ state: 'failed' });
      const [historical] = await q(
        'SELECT * FROM liekan_crawler_policy WHERE id=$1::uuid',
        policy.id,
      );
      expect(historical).toMatchObject({ generation: 1, connection_id: original.id });
      expect((await listCrawlerPolicies(actor, input.websiteId)).policies).toMatchObject([
        { id: fresh.id, connectionId: null, remoteRuleId: null },
      ]);
      expect((await listCrawlerPolicies(actor, input.websiteId)).connections[0]).toMatchObject({
        id: current.id,
        capabilities: { writeVerified: false },
      });
      expect(h.write).toHaveBeenCalledTimes(1);
      expect(
        await previewCrawlerPolicy(actor, input.websiteId, fresh.id, { operation: 'deploy' }),
      ).toMatchObject({ operation: 'deploy', transfer: null });
    },
  );
  it('requires full sessions and explicit handoff acknowledgement at the global recovery route', async () => {
    const { input } = await deletedUnknown(false);
    h.read.mockClear();
    for (const auth of [
      { authType: 'partial' },
      { authType: 'api-key', user: actor },
      { authType: 'session', shareToken: {}, user: actor },
    ]) {
      h.auth = auth;
      expect(
        (
          await handoffPOST(
            new Request('http://localhost/api/liekan/crawler-handoffs/reconcile', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(input),
            }),
          )
        ).status,
      ).toBe(401);
    }
    h.auth = { authType: 'session', user: actor };
    expect(
      (
        await handoffPOST(
          new Request('http://localhost/api/liekan/crawler-handoffs/reconcile', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...input, acknowledgeHandoff: false }),
          }),
        )
      ).status,
    ).toBe(400);
    expect(h.read).not.toHaveBeenCalled();
    const response = await handoffPOST(
      new Request('http://localhost/api/liekan/crawler-handoffs/reconcile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, acknowledgeNotApplied: true }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: 'failed' });
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.write).toHaveBeenCalledTimes(1);
  });
  it('requires both original-space authority and current website control from live roles', async () => {
    const { input } = await deletedUnknown(false),
      stranger = { id: other, role: 'admin' };
    await q(
      'UPDATE website SET user_id=$2::uuid WHERE website_id=$1::uuid',
      input.websiteId,
      other,
    );
    await q(
      'UPDATE liekan_crawler_connection SET owner_user_id=$2::uuid WHERE id=$1::uuid',
      input.connectionId,
      other,
    );
    h.read.mockClear();
    await expect(reconcileCrawlerHandoffDeployment(stranger, input)).rejects.toMatchObject({
      status: 404,
    });
    await expect(reconcileCrawlerHandoffDeployment(actor, input)).rejects.toMatchObject({
      status: 404,
    });
    expect(h.read).not.toHaveBeenCalled();
    expect(
      await reconcileCrawlerHandoffDeployment(administrator, {
        ...input,
        acknowledgeNotApplied: true,
      }),
    ).toMatchObject({ state: 'failed' });
    expect(h.write).toHaveBeenCalledTimes(1);
  });
  it.each(['team-member', 'team-view-only'] as const)(
    'rejects original-team %s handoff resolution, including the admin read-only veto',
    async role => {
      team = randomUUID();
      await q('INSERT INTO team(team_id,name) VALUES($1::uuid,$2)', team, 'test-demo-handoff-team');
      await q(
        'INSERT INTO team_user(team_user_id,team_id,user_id,role) VALUES($1::uuid,$2::uuid,$3::uuid,$4)',
        randomUUID(),
        team,
        owner,
        'team-owner',
      );
      await q(
        'UPDATE website SET user_id=NULL,team_id=$2::uuid WHERE website_id=$1::uuid',
        site,
        team,
      );
      const { original, input } = await deletedUnknown(false);
      await q(
        'UPDATE team_user SET role=$3 WHERE team_id=$1::uuid AND user_id=$2::uuid',
        team,
        owner,
        role,
      );
      if (role === 'team-view-only')
        await q('UPDATE "user" SET role=$2 WHERE user_id=$1::uuid', owner, 'admin');
      h.read.mockClear();
      await expect(reconcileCrawlerHandoffDeployment(actor, input)).rejects.toMatchObject({
        status: 403,
      });
      expect(
        (await listCrawlerHandoffs(actor)).handoffs.find(h => h.connection.id === original.id)
          ?.recoveryConnections,
      ).toEqual([]);
      expect(h.read).not.toHaveBeenCalled();
      expect(h.write).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['host', 'zone', 'connection-site', 'ref', 'policy-site', 'expired'] as const)(
    'rejects a deleted-site handoff with mismatched %s before any provider read',
    async change => {
      const { policy, original, input } = await deletedUnknown(false);
      if (change === 'host') {
        await q(
          'UPDATE website SET domain=$2 WHERE website_id=$1::uuid',
          input.websiteId,
          'docs.example.com',
        );
        await q(
          'UPDATE liekan_crawler_connection SET domain=$2 WHERE id=$1::uuid',
          input.connectionId,
          'docs.example.com',
        );
      } else if (change === 'zone')
        await q(
          'UPDATE liekan_crawler_connection SET zone_id=$2 WHERE id=$1::uuid',
          input.connectionId,
          'b'.repeat(32),
        );
      else if (change === 'connection-site')
        await q(
          'UPDATE liekan_crawler_connection SET website_id=$2::uuid WHERE id=$1::uuid',
          input.connectionId,
          site,
        );
      else if (change === 'ref')
        await q(
          'UPDATE liekan_crawler_policy SET ref=$2 WHERE id=$1::uuid',
          policy.id,
          'manual-ref',
        );
      else if (change === 'policy-site')
        await q(
          'UPDATE liekan_crawler_policy SET website_id=$2::uuid WHERE id=$1::uuid',
          policy.id,
          input.websiteId,
        );
      else
        await q(
          "UPDATE liekan_crawler_connection SET updated_at=now()-interval '181 days' WHERE id=$1::uuid",
          original.id,
        );
      h.read.mockClear();
      await expect(reconcileCrawlerHandoffDeployment(actor, input)).rejects.toMatchObject({
        status: ['policy-site', 'expired'].includes(change) ? 404 : 409,
      });
      expect(h.read).not.toHaveBeenCalled();
      expect(h.write).toHaveBeenCalledTimes(1);
      if (change === 'policy-site')
        await q(
          'UPDATE liekan_crawler_policy SET website_id=$2::uuid WHERE id=$1::uuid',
          policy.id,
          site,
        );
    },
  );
  it.each(['role', 'credential', 'original-role', 'lease'] as const)(
    'rechecks deleted-site handoff %s after the remote read before resolving',
    async change => {
      const { input } = await deletedUnknown(false);
      const recoverer = change === 'original-role' ? administrator : actor;
      h.read.mockImplementation(async () => {
        if (change === 'role')
          await q('UPDATE "user" SET role=$2 WHERE user_id=$1::uuid', owner, 'view-only');
        else if (change === 'credential')
          await q(
            "UPDATE liekan_crawler_connection SET token_encrypted=NULL,state='disconnected' WHERE id=$1::uuid",
            input.connectionId,
          );
        else if (change === 'original-role')
          await q('UPDATE "user" SET role=$2 WHERE user_id=$1::uuid', admin, 'user');
        else
          await q(
            'UPDATE liekan_crawler_lease SET owner=$2::uuid WHERE name=$1',
            `crawler:${zone}`,
            randomUUID(),
          );
        return structuredClone(snapshot);
      });
      try {
        await expect(
          reconcileCrawlerHandoffDeployment(recoverer, { ...input, acknowledgeNotApplied: true }),
        ).rejects.toMatchObject({
          status: change === 'original-role' ? 404 : change === 'role' ? 403 : 409,
        });
        expect(
          (
            await q(
              'SELECT state FROM liekan_crawler_deployment WHERE id=$1::uuid',
              input.deploymentId,
            )
          )[0].state,
        ).toBe('unknown');
        expect(h.write).toHaveBeenCalledTimes(1);
      } finally {
        await q('UPDATE "user" SET role=$2 WHERE user_id=$1::uuid', admin, 'admin');
      }
    },
  );
  it.each(['id', 'hash', 'duplicate-ref'] as const)(
    'records deleted-site handoff remote %s changes as conflict without overwriting rules',
    async change => {
      const { input } = await deletedUnknown(true);
      if (change === 'id') snapshot.rules[0].id = 'b'.repeat(32);
      else if (change === 'hash') snapshot.rules[0].description = 'manual provider edit';
      else snapshot.rules.push({ ...snapshot.rules[0], id: 'b'.repeat(32) });
      expect(await reconcileCrawlerHandoffDeployment(actor, input)).toMatchObject({
        state: 'conflict',
      });
      expect(h.write).toHaveBeenCalledTimes(1);
    },
  );
  it('leases deleted-site handoff recovery against other same-Zone work', async () => {
    const { input } = await deletedUnknown(false);
    await q(
      "INSERT INTO liekan_crawler_lease(name,owner,expires_at) VALUES($1,$2::uuid,now()+interval '2 minutes')",
      `crawler:${zone}`,
      randomUUID(),
    );
    h.read.mockClear();
    await expect(reconcileCrawlerHandoffDeployment(actor, input)).rejects.toMatchObject({
      status: 409,
    });
    expect(h.read).not.toHaveBeenCalled();
    expect(h.write).toHaveBeenCalledTimes(1);
  });
  it('keeps expired unknown handoffs recoverable by a live platform admin with current read credentials', async () => {
    const { original, input } = await deletedUnknown(false);
    await q(
      "UPDATE liekan_crawler_connection SET updated_at=now()-interval '181 days' WHERE id=$1::uuid",
      original.id,
    );
    await expect(reconcileCrawlerHandoffDeployment(actor, input)).rejects.toMatchObject({
      status: 404,
    });
    expect(
      (await listCrawlerHandoffs(actor)).handoffs.some(h => h.connection.id === original.id),
    ).toBe(false);
    expect(
      (await listCrawlerHandoffs(administrator)).handoffs.find(
        h => h.connection.id === original.id,
      ),
    ).toMatchObject({
      recoveryConnections: [{ websiteId: input.websiteId, connectionId: input.connectionId }],
    });
    expect(
      await reconcileCrawlerHandoffDeployment(administrator, {
        ...input,
        acknowledgeNotApplied: true,
      }),
    ).toMatchObject({ state: 'failed' });
    expect(await reconcileCrawlerHandoffDeployment(administrator, input)).toMatchObject({
      state: 'failed',
    });
    expect(h.write).toHaveBeenCalledTimes(1);
  });
  it('allows platform admin recovery after the original owner account is deleted', async () => {
    const { original, input } = await deletedUnknown(true);
    await q(
      'UPDATE website SET user_id=$2::uuid WHERE website_id=$1::uuid',
      input.websiteId,
      other,
    );
    await q(
      'UPDATE liekan_crawler_connection SET owner_user_id=$2::uuid WHERE id=$1::uuid',
      input.connectionId,
      other,
    );
    await q('UPDATE "user" SET deleted_at=now() WHERE user_id=$1::uuid', owner);
    try {
      expect(
        (await listCrawlerHandoffs(administrator)).handoffs.find(
          h => h.connection.id === original.id,
        ),
      ).toMatchObject({
        recoveryConnections: [{ websiteId: input.websiteId, connectionId: input.connectionId }],
      });
      expect(await reconcileCrawlerHandoffDeployment(administrator, input)).toMatchObject({
        state: 'confirmed',
      });
      expect(h.write).toHaveBeenCalledTimes(1);
    } finally {
      await q('UPDATE "user" SET deleted_at=NULL WHERE user_id=$1::uuid', owner);
    }
  });
  it('lists only jointly authorized same-host and same-Zone recovery credentials with masked metadata', async () => {
    const { original, current, input } = await deletedUnknown(false),
      foreignSite = randomUUID();
    extraSites.push(foreignSite);
    await q(
      'INSERT INTO website(website_id,name,domain,user_id) VALUES($1::uuid,$2,$3,$4::uuid)',
      foreignSite,
      'test-demo-foreign-recovery',
      'example.com',
      other,
    );
    const foreign = await connectCrawlerConnection({ id: other, role: 'user' }, foreignSite, {
      zoneId: zone,
      token: 'test-only-foreign-read-credential',
    });
    let handoff = (await listCrawlerHandoffs(actor)).handoffs.find(
      h => h.connection.id === original.id,
    );
    expect(handoff?.recoveryConnections).toEqual([
      {
        websiteId: input.websiteId,
        connectionId: current.id,
        websiteName: 'test-demo-handoff-recovery',
        domain: 'example.com',
        zoneId: zone,
      },
    ]);
    expect(JSON.stringify(handoff)).not.toContain('test-only-');
    expect(JSON.stringify(handoff)).not.toContain('token_encrypted');
    expect(
      (await listCrawlerHandoffs({ id: other, role: 'admin' })).handoffs.some(
        h => h.connection.id === original.id,
      ),
    ).toBe(false);
    expect(
      (await listCrawlerHandoffs(administrator)).handoffs.find(h => h.connection.id === original.id)
        ?.recoveryConnections,
    ).toHaveLength(2);
    await q(
      'UPDATE liekan_crawler_connection SET zone_id=$2 WHERE id=$1::uuid',
      current.id,
      'b'.repeat(32),
    );
    handoff = (await listCrawlerHandoffs(actor)).handoffs.find(
      h => h.connection.id === original.id,
    );
    expect(handoff?.recoveryConnections).toEqual([]);
    await q('UPDATE liekan_crawler_connection SET zone_id=$2 WHERE id=$1::uuid', current.id, zone);
    await q(
      'UPDATE website SET domain=$2 WHERE website_id=$1::uuid',
      input.websiteId,
      'docs.example.com',
    );
    await q(
      'UPDATE liekan_crawler_connection SET domain=$2 WHERE id=$1::uuid',
      current.id,
      'docs.example.com',
    );
    expect(
      (await listCrawlerHandoffs(actor)).handoffs.find(h => h.connection.id === original.id)
        ?.recoveryConnections,
    ).toEqual([]);
    await q(
      'UPDATE website SET domain=$2 WHERE website_id=$1::uuid',
      input.websiteId,
      'example.com',
    );
    await q(
      'UPDATE liekan_crawler_connection SET domain=$2 WHERE id=$1::uuid',
      current.id,
      'example.com',
    );
    await q('UPDATE "user" SET role=$2 WHERE user_id=$1::uuid', owner, 'view-only');
    expect(
      (await listCrawlerHandoffs(actor)).handoffs.find(h => h.connection.id === original.id)
        ?.recoveryConnections,
    ).toEqual([]);
    expect(foreign.id).not.toBe(current.id);
    expect(h.write).toHaveBeenCalledTimes(1);
  });
  it.each(['team-member', 'team-view-only'] as const)(
    'omits current-team %s credentials from handoff recovery options',
    async role => {
      const { original, input } = await deletedUnknown(false);
      team = randomUUID();
      await q(
        'INSERT INTO team(team_id,name) VALUES($1::uuid,$2)',
        team,
        'test-demo-current-recovery-team',
      );
      await q(
        'INSERT INTO team_user(team_user_id,team_id,user_id,role) VALUES($1::uuid,$2::uuid,$3::uuid,$4)',
        randomUUID(),
        team,
        owner,
        role,
      );
      await q(
        'UPDATE website SET user_id=NULL,team_id=$2::uuid WHERE website_id=$1::uuid',
        input.websiteId,
        team,
      );
      await q(
        'UPDATE liekan_crawler_connection SET owner_user_id=NULL,team_id=$2::uuid WHERE id=$1::uuid',
        input.connectionId,
        team,
      );
      if (role === 'team-view-only')
        await q('UPDATE "user" SET role=$2 WHERE user_id=$1::uuid', owner, 'admin');
      expect(
        (await listCrawlerHandoffs(actor)).handoffs.find(h => h.connection.id === original.id)
          ?.recoveryConnections,
      ).toEqual([]);
      await expect(reconcileCrawlerHandoffDeployment(actor, input)).rejects.toMatchObject({
        status: 403,
      });
      expect(h.write).toHaveBeenCalledTimes(1);
    },
  );
  it('retains old-space handoffs after website deletion without exposing them to another live owner', async () => {
    const { policy } = await applied(),
      connection = (await listCrawlerPolicies(actor, site)).connections[0];
    await q(
      'UPDATE liekan_crawler_state SET generation=generation+1,deleted_at=now() WHERE website_id=$1::uuid',
      site,
    );
    await q(
      "UPDATE liekan_crawler_connection SET state='frozen',token_encrypted=NULL WHERE id=$1::uuid",
      connection.id,
    );
    await q('DELETE FROM website WHERE website_id=$1::uuid', site);
    const handoff = (await listCrawlerHandoffs(actor)).handoffs.find(
      h => h.connection.id === connection.id,
    );
    expect(handoff?.policies[0]).toMatchObject({ id: policy.id, remoteRuleId: expect.any(String) });
    expect(
      (await listCrawlerHandoffs({ id: other, role: 'admin' })).handoffs.some(
        h => h.connection.id === connection.id,
      ),
    ).toBe(false);
  });
});
