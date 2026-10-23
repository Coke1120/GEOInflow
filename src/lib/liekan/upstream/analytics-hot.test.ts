import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient } from 'redis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  type AnalyticsRefreshJob,
  hotJobEligible,
  forgetAnalyticsHot,
  notifyAnalyticsHotInvalidation,
  pumpAnalyticsHot,
  readAnalyticsHot,
  rememberAnalyticsHot,
  renewAnalyticsHotVersion,
  reserveWorkerComputation,
  scheduleNextAnalyticsHot,
} from './analytics-hot';
import { installPublishedCatalogResolver } from '../crawlers/published';
import { getBundledPublishedCatalog } from '../crawlers/catalog-seed';
import type { PublishedCatalog } from '../contracts/crawler-registry';

const mocks = vi.hoisted(() => ({ context: undefined as any, command: vi.fn() }));
const serverMocks = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock('./cache-context', () => ({ currentCacheContext: () => mocks.context }));
vi.mock('./analytics-redis', () => ({ analyticsRedis: { enabled: true, command: mocks.command } }));
vi.mock('./server', () => ({ primary: () => ({ website: { findFirst: serverMocks.findFirst } }) }));
const redisAvailable = spawnSync('redis-server', ['--version'], { stdio: 'ignore' }).status === 0;
const site = '11111111-1111-4111-8111-111111111111',
  actor = '22222222-2222-4222-8222-222222222222';
const range = { startAt: 1727740800000, endAt: 1727827199999, timezone: 'UTC' };
const base = 1800000000000;
let now = base;

// This Redis has an isolated temporary Unix socket and never connects to a user's data service.
describe.skipIf(!redisAvailable)('hot scheduler with isolated Redis', () => {
  let server: ChildProcess, client: ReturnType<typeof createClient>, directory: string;
  beforeAll(async () => {
    directory = await mkdtemp(join('/tmp', 'liekan-hot-test-'));
    const socket = join(directory, 'redis.sock');
    server = spawn(
      'redis-server',
      [
        '--port',
        '0',
        '--unixsocket',
        socket,
        '--save',
        '',
        '--appendonly',
        'no',
        '--dir',
        directory,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    await new Promise<void>((resolve, reject) => {
      server.stdout.on('data', bytes => {
        if (String(bytes).toLowerCase().includes('ready to accept connections')) resolve();
      });
      server.once('error', reject);
      server.once('exit', () => reject(new Error('Isolated Redis did not start')));
    });
    client = createClient({ socket: { path: socket, tls: false } });
    client.on('error', () => {});
    await client.connect();
  });
  beforeEach(async () => {
    await client.flushDb();
    vi.stubEnv('DATABASE_URL', 'postgresql://user:secret@localhost/isolated_hot?schema=test');
    now = base;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    mocks.command.mockReset();
    mocks.command.mockImplementation(args => client.sendCommand(args));
    mocks.context = {
      actor,
      scope: { private: true },
      parameters: range,
      request: new Request(`http://localhost/api/websites/${site}/stats`),
    };
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await client?.quit();
    server?.kill();
    await rm(directory, { force: true, recursive: true });
  });

  async function observe(
    at: number,
    parameters: Record<string, any> = range,
    ttl = 30000,
    target = 'stats',
  ) {
    now = at;
    mocks.context.parameters = parameters;
    mocks.context.request = new Request(`http://localhost/api/websites/${site}/${target}`);
    await rememberAnalyticsHot(
      { value: [], generatedAt: now, expiresAt: now + ttl, status: 'hit' },
      { strong: 'v1', data: 'd1' },
    );
  }
  async function task(parameters: Record<string, any> = range, ttl = 30000, target = 'stats') {
    await observe(base, parameters, ttl, target);
    await observe(base + 30000, parameters, ttl, target);
    await observe(base + 60000, parameters, ttl, target);
    const taskKey = (await client.keys('*:tasks'))[0];
    return JSON.parse(Object.values(await client.hGetAll(taskKey))[0]) as AnalyticsRefreshJob;
  }

  test('schedules slow current-day computations using the remaining cache lifetime', async () => {
    for (let i = 0; i < 3; i++) {
      now = base + i * 30000;
      await rememberAnalyticsHot(
        { value: [], generatedAt: now - 35000, expiresAt: now + 30000, status: 'miss' },
        { strong: 'v1', data: 'd1' },
      );
    }
    const key = (await client.keys('*:tasks'))[0];
    const job = JSON.parse(Object.values(await client.hGetAll(key))[0]) as AnalyticsRefreshJob;
    expect(job.scheduledAt).toBe(now + 25000);
    now = job.scheduledAt + 35000;
    await scheduleNextAnalyticsHot(job, now + 30000, now - 35000);
    expect((await readAnalyticsHot(job)).job.scheduledAt).toBe(now + 25000);
  });

  test.each(['actor', 'version', 'schedule'])(
    'preserves replacement hot demand when an old %s job is forgotten',
    async replacement => {
      const old = await task();
      if (replacement === 'actor') {
        mocks.context.actor = '33333333-3333-4333-8333-333333333333';
        await observe(base + 61000);
      } else if (replacement === 'version') {
        await renewAnalyticsHotVersion(old, 'v2');
      } else {
        await scheduleNextAnalyticsHot(old, now + 30000, now);
      }
      const current = await readAnalyticsHot(old);
      expect(current).not.toBeNull();
      await forgetAnalyticsHot(old);
      expect(await readAnalyticsHot(old)).toEqual(current);
      const due = (await client.keys('*:due'))[0];
      expect(await client.zScore(due, `${site}|${old.fingerprint}`)).not.toBeNull();
      await forgetAnalyticsHot(current.job);
      expect(await readAnalyticsHot(old)).toBeNull();
      expect(await client.keys('*:counts')).toHaveLength(0);
      expect(await client.keys('*:tasks')).toHaveLength(0);
      expect(await client.keys('*:recent')).toHaveLength(0);
      expect(await client.keys('*:due')).toHaveLength(0);
    },
  );

  test('discovers foreground catalog registrations from a worker outside the request context', async () => {
    const contexts = new AsyncLocalStorage<PublishedCatalog>();
    installPublishedCatalogResolver(() => contexts.getStore());
    try {
      const catalog = getBundledPublishedCatalog();
      const job = await contexts.run(catalog, () => task());
      now = job.scheduledAt;
      const queue = { send: vi.fn(async (..._args: unknown[]) => 'job-id') };
      const readStrong = vi.fn(async () => job.expectedStrongVersion);
      expect(await readAnalyticsHot(job)).not.toBeNull();
      await pumpAnalyticsHot(queue as any, readStrong);
      expect(readStrong).toHaveBeenCalledWith(site, job.expectedStrongVersion);
      expect(queue.send).toHaveBeenCalledTimes(1);
      expect(queue.send.mock.calls[0][1]).toMatchObject({ fingerprint: job.fingerprint });
    } finally {
      installPublishedCatalogResolver(() => undefined);
    }
  });

  test('keeps the worker computation budget shared across catalog snapshots', async () => {
    const contexts = new AsyncLocalStorage<PublishedCatalog>();
    installPublishedCatalogResolver(() => contexts.getStore());
    try {
      const catalog = getBundledPublishedCatalog();
      for (let index = 0; index < 20; index++)
        expect(await contexts.run(catalog, () => reserveWorkerComputation(now))).toBe(true);
      expect(await reserveWorkerComputation(now)).toBe(false);
      expect(
        await contexts.run({ ...catalog, version: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }, () =>
          reserveWorkerComputation(now),
        ),
      ).toBe(false);
    } finally {
      installPublishedCatalogResolver(() => undefined);
    }
  });

  test('requires three foreground rounds, caps a website at four and removes expired counts', async () => {
    await observe(base);
    await observe(base + 1);
    await observe(base + 2);
    expect(await client.keys('*:tasks')).toHaveLength(0);
    await observe(base + 30000);
    await observe(base + 60000);
    expect(await client.keys('*:tasks')).toHaveLength(1);
    for (let i = 0; i < 5; i++) await observe(base + 61000 + i, { ...range, type: String(i) });
    const recent = (await client.keys('*:recent'))[0],
      counts = (await client.keys('*:counts'))[0];
    expect(await client.zCard(recent)).toBe(4);
    expect(await client.hLen(counts)).toBe(4);
    await observe(base + 962000);
    expect(await client.hLen(counts)).toBe(1);
    expect(JSON.parse(Object.values(await client.hGetAll(counts))[0])).toMatchObject({ count: 1 });
    expect(await client.hLen((await client.keys('*:tasks'))[0] || `${recent}:missing`)).toBe(0);
  });

  test('uses historical lead and renews without extending last real access', async () => {
    const job = await task(range, 300000);
    expect(job.scheduledAt).toBe(base + 60000 + 270000);
    now = job.scheduledAt;
    expect(await hotJobEligible(job)).toBe(true);
    const recent = (await client.keys('*:recent'))[0],
      last = await client.zScore(recent, job.fingerprint);
    await scheduleNextAnalyticsHot(job, now + 300000, now);
    expect((await readAnalyticsHot(job)).job.scheduledAt).toBe(now + 270000);
    expect(await client.zScore(recent, job.fingerprint)).toBe(last);
    mocks.context.background = true;
    await observe(now);
    expect(await client.zScore(recent, job.fingerprint)).toBe(last);
    now = base + 960000;
    expect(await readAnalyticsHot(job)).toBeNull();
  });

  test('uses the earliest current or comparison expiry without postponing an existing demand', async () => {
    const job = await task(range, 300000);
    await observe(base + 61000, range, 30000);
    const current = await readAnalyticsHot(job);
    expect(current.job.scheduledAt).toBe(base + 86000);
    const due = (await client.keys('*:due'))[0];
    expect(await client.zScore(due, `${site}|${job.fingerprint}`)).toBe(base + 86000);
    await observe(base + 62000, range, 300000);
    expect((await readAnalyticsHot(job)).job.scheduledAt).toBe(base + 86000);
  });

  test('permits fixed five-second retry of one round and rejects a competing round', async () => {
    const job = await task();
    now = job.scheduledAt;
    expect(await hotJobEligible(job)).toBe(true);
    now += 5000;
    expect(await hotJobEligible(job)).toBe(true);
    await renewAnalyticsHotVersion(job, 'v2');
    const revised = (await readAnalyticsHot(job)).job;
    now = revised.scheduledAt;
    expect(await hotJobEligible(revised)).toBe(false);
    expect(await hotJobEligible({ ...job, scheduledAt: base })).toBe(false);
    now = job.scheduledAt + 30001;
    expect(await hotJobEligible(job)).toBe(false);
  });

  test('maintains recoverable due demand through queue failures and merges committed versions', async () => {
    const job = await task();
    now = job.scheduledAt;
    const queue = {
      send: vi
        .fn()
        .mockRejectedValueOnce(new Error('queue unavailable'))
        .mockResolvedValue('job-id'),
    };
    await pumpAnalyticsHot(queue as any, async () => 'v1');
    expect(queue.send).toHaveBeenCalledTimes(1);
    await pumpAnalyticsHot(queue as any, async () => 'v1');
    expect(queue.send).toHaveBeenCalledTimes(2);
    expect(queue.send.mock.calls[1][2]).toMatchObject({
      policy: 'exclusive',
      singletonKey: job.fingerprint,
      retryDelay: 5,
      priority: 3,
    });
    const outcome = notifyAnalyticsHotInvalidation([site]);
    expect(outcome).toBeUndefined();
    await new Promise(resolve => setTimeout(resolve, 10));
    await pumpAnalyticsHot(queue as any, async () => 'v2');
    expect(queue.send.mock.calls[2][1]).toMatchObject({
      expectedStrongVersion: 'v2',
      fingerprint: job.fingerprint,
      scheduledAt: now + 5000,
    });
    expect(JSON.stringify(queue.send.mock.calls)).not.toContain('secret');
  });

  test('uses a rolling fifteen-minute observation threshold and preserves a completed next round during send acknowledgment', async () => {
    const job = await task(range, 300000);
    now = job.scheduledAt;
    const queue = {
      send: vi.fn(async () => {
        await scheduleNextAnalyticsHot(job, now + 300000, now);
        return 'job-id';
      }),
    };
    await pumpAnalyticsHot(queue as any, async () => 'v1');
    const due = (await client.keys('*:due'))[0];
    expect(await client.zScore(due, `${site}|${job.fingerprint}`)).toBe(now + 270000);
    now = base + 900001;
    expect(await readAnalyticsHot(job)).toBeNull();
  });

  test('accepts normalized funnels, pauses on Redis failure and enforces global twenty computation limit', async () => {
    const job = await task(
      {
        ...range,
        window: 24,
        steps: [
          { type: 'path', value: '/one' },
          { type: 'event', value: 'paid' },
        ],
      },
      30000,
      'funnels/stats',
    );
    expect(job.parameters).toMatchObject({
      window: 24,
      steps: [
        { type: 'path', value: '/one' },
        { type: 'event', value: 'paid' },
      ],
    });
    mocks.command.mockResolvedValueOnce(null);
    const queue = { send: vi.fn() };
    now = job.scheduledAt;
    await pumpAnalyticsHot(queue as any, async () => 'v1');
    expect(queue.send).not.toHaveBeenCalled();
    for (let i = 0; i < 20; i++) expect(await reserveWorkerComputation(now)).toBe(true);
    expect(await reserveWorkerComputation(now)).toBe(false);
    now += 60000;
    expect(await reserveWorkerComputation(now)).toBe(true);
  });

  test('resolves a numeric site number to the UUID before recording hot demand', async () => {
    serverMocks.findFirst.mockResolvedValue({ id: site });
    mocks.context.parameters = range;
    mocks.context.request = new Request('http://localhost/api/websites/101/stats');
    for (const at of [base, base + 30000, base + 60000]) {
      now = at;
      await rememberAnalyticsHot(
        { value: [], generatedAt: now, expiresAt: now + 30000, status: 'hit' },
        { strong: 'v1', data: 'd1' },
      );
    }
    expect(serverMocks.findFirst).toHaveBeenCalledWith({
      where: { siteNumber: 101, deletedAt: null },
      select: { id: true },
    });
    const taskKey = (await client.keys('*:tasks'))[0];
    const job = JSON.parse(Object.values(await client.hGetAll(taskKey))[0]) as AnalyticsRefreshJob;
    expect(job.websiteId).toBe(site);
    const due = (await client.keys('*:due'))[0];
    expect(await client.zScore(due, `${site}|${job.fingerprint}`)).not.toBeNull();
  });

  test('ignores a numeric site number that resolves to no website', async () => {
    serverMocks.findFirst.mockResolvedValue(null);
    mocks.context.parameters = range;
    mocks.context.request = new Request('http://localhost/api/websites/404/stats');
    for (const at of [base, base + 30000, base + 60000]) {
      now = at;
      await rememberAnalyticsHot(
        { value: [], generatedAt: now, expiresAt: now + 30000, status: 'hit' },
        { strong: 'v1', data: 'd1' },
      );
    }
    expect(await client.keys('*:tasks')).toHaveLength(0);
    expect(await client.keys('*:recent')).toHaveLength(0);
  });
});
