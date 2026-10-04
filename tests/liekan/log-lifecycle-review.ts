import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../../src/lib/prisma';
import { query, transaction } from '../../src/lib/liekan/upstream/server';
import { createSource, heartbeat, manageSource } from '../../src/lib/liekan/log-ingestion/service';
import { reconcilePermissions } from '../../src/lib/liekan/log-ingestion/maintenance';
import { maintainProvider } from '../../src/lib/liekan/log-ingestion/provider';
import { openPlatformSecret, sealPlatformSecret } from '../../src/lib/liekan/log-ingestion/secrets';
import * as cloudflare from '../../src/lib/liekan/log-ingestion/cloudflare';
import { resetLiekanStatistics, stopWebsiteSources } from '../../src/lib/liekan/upstream/lifecycle';

export async function reviewLifecycle(userId: string) {
  const identity = { userId },
    workerId = randomUUID();
  const failures: string[] = [];
  let restore = () => {};
  async function check(name: string, work: () => Promise<void>) {
    try {
      await work();
      console.log(`PASS: ${name}`);
    } catch (error) {
      failures.push(name);
      console.error(`FAIL: ${name}: ${(error as Error).message}`);
    } finally {
      restore();
    }
  }
  async function site() {
    const id = randomUUID();
    await prisma.client.website.create({
      data: { id, userId, name: 'lifecycle fixture', domain: 'example.com' },
    });
    return id;
  }
  const health = { version: '1', pending: 0, bytes: 0, gap: false, errorCode: 'none' };
  await check(
    'paused credentials are permanently revoked after losing team permission',
    async () => {
      const manager = randomUUID(),
        team = randomUUID(),
        id = await site();
      await prisma.client.user.create({
        data: {
          id: manager,
          role: 'user',
          username: `manager-${manager}`,
          password: 'fixture-disabled-login',
        },
      });
      await prisma.client.team.create({ data: { id: team, name: 'fixture' } });
      await prisma.client.website.update({ where: { id }, data: { userId: null, teamId: team } });
      await prisma.client.teamUser.create({
        data: { id: randomUUID(), teamId: team, userId: manager, role: 'team-manager' },
      });
      const source = await transaction(tx => createSource(tx, id, 'server', { userId: manager }));
      await heartbeat(source.source.id, source.token, health);
      await manageSource(id, source.source.id, { action: 'pause' }, { userId: manager });
      await prisma.client.teamUser.deleteMany({ where: { teamId: team, userId: manager } });
      await reconcilePermissions();
      assert.equal(
        (
          await query(
            'SELECT credential_hash FROM liekan_log_source WHERE id=$1::uuid',
            source.source.id,
          )
        )[0].credential_hash,
        null,
      );
      await prisma.client.teamUser.create({
        data: { id: randomUUID(), teamId: team, userId: manager, role: 'team-manager' },
      });
      await assert.rejects(heartbeat(source.source.id, source.token, health), { status: 401 });
    },
  );

  const originalFetch = globalThis.fetch,
    originalUrl = process.env.LIEKAN_PUBLIC_URL;
  const jobs: any[] = [],
    revocations: string[] = [];
  let failZones = false,
    unauthorized = false;
  let onCreate: (() => Promise<void>) | undefined, onExchange: (() => Promise<void>) | undefined;
  restore = () => {
    failZones = false;
    unauthorized = false;
    onCreate = undefined;
    onExchange = undefined;
    process.env.LIEKAN_PUBLIC_URL = originalUrl;
  };
  globalThis.fetch = (async (url, init: any) => {
    const path = String(url);
    if (path.endsWith('/revoke')) {
      revocations.push(new URLSearchParams(init.body).get('token')!);
      return new Response(null, { status: 200 });
    }
    if (path.endsWith('/token')) {
      if (onExchange) await onExchange();
      return Response.json({
        access_token: `fixture-${randomUUID()}`,
        refresh_token: `refresh-${randomUUID()}`,
        token_type: 'Bearer',
        expires_in: 3600,
      });
    }
    if (unauthorized) return new Response(null, { status: 401 });
    if (path.includes('/zones/?'))
      return failZones
        ? new Response(null, { status: 503 })
        : Response.json({
            success: true,
            result: [{ id: 'a'.repeat(32), name: 'example.com', status: 'active' }],
          });
    if (path.includes('/logpush/jobs')) {
      if (init.method === 'POST') {
        const job = { id: jobs.length + 10, ...JSON.parse(init.body) };
        jobs.push(job);
        if (onCreate) await onCreate();
        return Response.json({ success: true, result: job });
      }
      if (init.method === 'PUT') {
        const job = jobs.find(j => String(j.id) === path.split('/').pop());
        assert.ok(job);
        Object.assign(job, JSON.parse(init.body));
        return Response.json({ success: true, result: job });
      }
      return Response.json({ success: true, result: jobs });
    }
    throw new Error('Unexpected provider endpoint');
  }) as typeof fetch;
  async function authorize(id: string, finalize = true) {
    const flow = await cloudflare.beginCloudflare(id, identity);
    const headers = { cookie: flow.cookie.split(';')[0] };
    const callback = new Request(
      `https://logs.example/api/liekan/oauth/cloudflare/callback?state=${new URL(flow.authorizationUrl).searchParams.get('state')}&code=fixture`,
      { headers },
    );
    await cloudflare.acceptCloudflareCallback(callback);
    const source: any = finalize
      ? await cloudflare.finalizeCloudflare(
          id,
          { flowId: flow.flowId, zoneId: 'a'.repeat(32), acceptCosts: true },
          identity,
          new Request('https://logs.example', { headers }),
        )
      : undefined;
    return { flow, source };
  }
  async function cleanup() {
    assert.equal(typeof (cloudflare as any).cleanupExpiredAuthorizations, 'function');
    await (cloudflare as any).cleanupExpiredAuthorizations(workerId);
  }
  try {
    await check(
      'provider policy conflict preserves authorization and records its disabled job',
      async () => {
        const id = await site(),
          { source } = await authorize(id);
        onCreate = async () => {
          const other = await transaction(tx => createSource(tx, id, 'server', identity));
          await heartbeat(other.source.id, other.token, health);
        };
        try {
          await maintainProvider(source.sourceId, 'configure', workerId);
        } finally {
          onCreate = undefined;
        }
        const row = (
          await query('SELECT * FROM liekan_log_source WHERE id=$1::uuid', source.sourceId)
        )[0];
        assert.ok(row.credential_hash);
        assert.ok(row.provider_job_id);
        assert.equal(row.state, 'paused');
        assert.equal(row.error_code, 'confirmation-required');
        await manageSource(id, source.sourceId, { action: 'select' }, identity);
        await maintainProvider(source.sourceId, 'configure', workerId);
        assert.equal(
          (await query('SELECT state FROM liekan_log_source WHERE id=$1::uuid', source.sourceId))[0]
            .state,
          'active',
        );
      },
    );
    await check('paused Cloudflare resumes with the current reset epoch', async () => {
      const id = await site(),
        { source } = await authorize(id);
      await maintainProvider(source.sourceId, 'configure', workerId);
      const job = jobs.find(j => j.name === `liekan-${source.sourceId}`);
      await manageSource(id, source.sourceId, { action: 'pause' }, identity);
      await maintainProvider(source.sourceId, 'health', workerId);
      await transaction(tx => resetLiekanStatistics(tx, id, identity));
      await manageSource(id, source.sourceId, { action: 'select' }, identity);
      await maintainProvider(source.sourceId, 'configure', workerId);
      assert.equal(job.enabled, true);
      assert.equal(new URL(job.destination_conf).searchParams.get('header_X-Liekan-Epoch'), '2');
    });
    await check('cleanup failure does not invalidate a newly selected server source', async () => {
      const id = await site(),
        { source } = await authorize(id);
      await maintainProvider(source.sourceId, 'configure', workerId);
      unauthorized = true;
      await maintainProvider(source.sourceId, 'health', workerId);
      const server = await transaction(tx => createSource(tx, id, 'server', identity));
      await heartbeat(server.source.id, server.token, health);
      const revision = (
        await query('SELECT policy_revision FROM liekan_log_state WHERE website_id=$1::uuid', id)
      )[0].policy_revision;
      await maintainProvider(source.sourceId, 'disconnect', workerId);
      await maintainProvider(source.sourceId, 'disconnect', workerId);
      assert.equal(
        (
          await query('SELECT policy_revision FROM liekan_log_state WHERE website_id=$1::uuid', id)
        )[0].policy_revision,
        revision,
      );
      assert.equal((await heartbeat(server.source.id, server.token, health)).state, 'active');
      unauthorized = false;
    });
    await check('an owned job is disabled after the platform URL moves', async () => {
      const id = await site(),
        { source } = await authorize(id);
      await maintainProvider(source.sourceId, 'configure', workerId);
      const job = jobs.find(j => j.name === `liekan-${source.sourceId}`);
      process.env.LIEKAN_PUBLIC_URL = 'https://new-logs.example';
      await transaction(tx => stopWebsiteSources(tx, id));
      await maintainProvider(source.sourceId, 'disconnect', workerId);
      assert.equal(job.enabled, false);
      process.env.LIEKAN_PUBLIC_URL = originalUrl;
    });
    await check('legacy provider configuration survives URL migration and cleanup', async () => {
      const id = await site(),
        { source } = await authorize(id);
      await maintainProvider(source.sourceId, 'configure', workerId);
      const job = jobs.find(j => j.name === `liekan-${source.sourceId}`);
      const row = (
        await query(
          'SELECT provider_config FROM liekan_log_source WHERE id=$1::uuid',
          source.sourceId,
        )
      )[0];
      const config = JSON.parse(openPlatformSecret(row.provider_config, source.sourceId));
      delete config.receiverOrigin;
      delete config.receiverOrigins;
      await transaction(tx =>
        tx.$executeRawUnsafe(
          'UPDATE liekan_log_source SET provider_config=$2 WHERE id=$1::uuid',
          source.sourceId,
          sealPlatformSecret(JSON.stringify(config), source.sourceId),
        ),
      );
      process.env.LIEKAN_PUBLIC_URL = 'https://legacy-new.example';
      await maintainProvider(source.sourceId, 'health', workerId);
      assert.equal(
        (await query('SELECT state FROM liekan_log_source WHERE id=$1::uuid', source.sourceId))[0]
          .state,
        'active',
      );
      process.env.LIEKAN_PUBLIC_URL = 'https://legacy-third.example';
      await transaction(tx => stopWebsiteSources(tx, id));
      await maintainProvider(source.sourceId, 'disconnect', workerId);
      assert.equal(job.enabled, false);
    });
    await check('owned job cleanup follows multiple platform URL changes', async () => {
      const id = await site(),
        { source } = await authorize(id);
      await maintainProvider(source.sourceId, 'configure', workerId);
      const job = jobs.find(j => j.name === `liekan-${source.sourceId}`);
      process.env.LIEKAN_PUBLIC_URL = 'https://second-logs.example';
      await maintainProvider(source.sourceId, 'health', workerId);
      assert.equal(new URL(job.destination_conf).origin, process.env.LIEKAN_PUBLIC_URL);
      process.env.LIEKAN_PUBLIC_URL = 'https://third-logs.example';
      await transaction(tx => stopWebsiteSources(tx, id));
      await maintainProvider(source.sourceId, 'disconnect', workerId);
      assert.equal(job.enabled, false);
    });
    await check(
      'issued OAuth credentials survive a zone lookup failure and are revoked',
      async () => {
        const id = await site();
        failZones = true;
        try {
          await assert.rejects(authorize(id, false), { status: 503 });
        } finally {
          failZones = false;
        }
        const before = revocations.length;
        await cleanup();
        assert.equal(revocations.length, before + 2);
      },
    );
    await check(
      'abandoned authorized grants expire through durable credential cleanup',
      async () => {
        const id = await site();
        await authorize(id, false);
        await transaction(tx =>
          tx.$executeRawUnsafe(
            "UPDATE liekan_oauth_cleanup SET expires_at=now()-interval '1 second' WHERE website_id=$1::uuid",
            id,
          ),
        );
        await transaction(tx =>
          tx.$executeRawUnsafe('DELETE FROM liekan_log_grant WHERE website_id=$1::uuid', id),
        );
        const before = revocations.length;
        await cleanup();
        assert.equal(revocations.length, before + 2);
        assert.equal(
          (
            await query(
              'SELECT count(*)::int AS n FROM liekan_oauth_cleanup WHERE website_id=$1::uuid',
              id,
            )
          )[0].n,
          0,
        );
      },
    );
    await check('reset racing token exchange still revokes the issued grant', async () => {
      const id = await site();
      onExchange = () => transaction(tx => resetLiekanStatistics(tx, id, identity));
      try {
        await assert.rejects(authorize(id, false), { status: 409 });
      } finally {
        onExchange = undefined;
      }
      const before = revocations.length;
      await cleanup();
      assert.equal(revocations.length, before + 2);
    });
    await check(
      'a migrated pending cleanup lease cannot delete newly issued credentials',
      async () => {
        const id = await site();
        let grantId = '';
        onExchange = async () =>
          transaction(async tx => {
            const grant = (
              await tx.$queryRawUnsafe(
                "SELECT * FROM liekan_log_grant WHERE website_id=$1::uuid AND kind='oauth'",
                id,
              )
            )[0];
            grantId = grant.id;
            await tx.$executeRawUnsafe(
              "INSERT INTO liekan_oauth_cleanup(id,website_id,payload,expires_at,lease,lease_until) VALUES($1::uuid,$2::uuid,$3,now(),$4::uuid,now()+interval '5 minutes')",
              grantId,
              id,
              grant.payload,
              workerId,
            );
            await tx.$executeRawUnsafe(
              'UPDATE liekan_log_grant SET expires_at=now() WHERE id=$1::uuid',
              grantId,
            );
          });
        await assert.rejects(authorize(id, false), { status: 409 });
        const deleted = await transaction(tx =>
          tx.$executeRawUnsafe(
            'DELETE FROM liekan_oauth_cleanup WHERE id=$1::uuid AND lease=$2::uuid',
            grantId,
            workerId,
          ),
        );
        assert.equal(deleted, 0);
        const before = revocations.length;
        await cleanup();
        assert.equal(revocations.length, before + 2);
      },
    );
    await check(
      'finalized OAuth credentials transfer ownership without later revocation',
      async () => {
        const id = await site();
        await authorize(id);
        assert.equal(
          (
            await query(
              'SELECT count(*)::int AS n FROM liekan_oauth_cleanup WHERE website_id=$1::uuid',
              id,
            )
          )[0].n,
          0,
        );
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    process.env.LIEKAN_PUBLIC_URL = originalUrl;
  }
  assert.deepEqual(failures, []);
}
