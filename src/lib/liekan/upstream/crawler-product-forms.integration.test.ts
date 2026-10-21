// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('./server', () => ({ query: h.query, LiekanError: class extends Error {} }));
import { getLogFacts } from './logs';

const enabled = !!process.env.LIEKAN_GEO_TEST_URL;
const site = randomUUID(),
  oldVersion = randomUUID(),
  newVersion = randomUUID();
let pool: Pool, client: PoolClient;
const q = (sql: string, ...params: unknown[]) => client.query(sql, params);
async function log(
  path: string,
  version: string | null,
  extra: {
    botId?: string | null;
    time?: string;
    state?: string;
    ua?: string;
    type?: string;
    ai?: boolean;
  } = {},
) {
  const id = randomUUID();
  await q(
    `INSERT INTO liekan_effective_log VALUES($1,$2,$3,$4,'FixtureBot','Fixture',$7,$8,$5,$6,'verified_range')`,
    id,
    site,
    extra.time ?? '2026-10-01T12:00:00Z',
    path,
    extra.state ?? 'recognized',
    extra.ua ?? 'FixtureBot',
    extra.type ?? '搜索',
    extra.ai ?? true,
  );
  await q(
    "INSERT INTO liekan_crawler_evidence VALUES($1,$2,$3,$4,'fixture-v1')",
    site,
    id,
    extra.botId === undefined ? 'fixture-bot' : extra.botId,
    version,
  );
}
const facts = (form?: 'workbench' | 'personal_agent', resource = 'ai/pages', extra = {}) =>
  getLogFacts(
    site,
    new Date('2026-10-01'),
    new Date('2026-10-03'),
    'UTC',
    1,
    '',
    '',
    '',
    'after',
    ['bots', 'pages', 'previousBots'],
    {
      resource,
      crawlerMetricsVersion: 1,
      crawlerIdentityScope: 'all',
      botProductForm: form,
      ...extra,
    },
  );
describe.skipIf(!enabled)('crawler product-form historical PostgreSQL population', () => {
  beforeAll(() => {
    const url = new URL(process.env.LIEKAN_GEO_TEST_URL);
    if (url.hostname !== '127.0.0.1' || url.port !== '15450' || url.pathname !== '/liekan_geo_test')
      throw new Error('Only owned acceptance database is allowed');
    pool = new Pool({ connectionString: url.toString() });
  });
  beforeEach(async () => {
    client = await pool.connect();
    await q('BEGIN');
    h.query.mockImplementation(async (sql, ...args) => (await q(sql, ...args)).rows);
    await q(`CREATE TEMP TABLE liekan_effective_log (id text,website_id uuid,created_at timestamptz,path text,bot text,vendor text,bot_type text,ai_eligible boolean,recognition_state text,user_agent text,verification text);
      CREATE TEMP TABLE liekan_crawler_evidence (website_id uuid,log_id text,crawler_id text,catalog_version uuid,classification_version text);
      CREATE TEMP TABLE liekan_crawler_registry_version (version uuid,payload jsonb);
      CREATE TEMP TABLE liekan_log_state (website_id uuid,epoch int,policy_revision int);`);
    for (const [version, form] of [
      [oldVersion, 'workbench'],
      [newVersion, 'personal_agent'],
    ])
      await q(
        'INSERT INTO liekan_crawler_registry_version VALUES($1,$2)',
        version,
        JSON.stringify({ identities: [{ id: 'fixture-bot', productForm: form }] }),
      );
    await log('/shared', oldVersion);
    await log('/workbench', oldVersion);
    await log('/workbench', oldVersion);
    await log('/shared', newVersion);
    await log('/agent', newVersion);
    await log('/missing-history', null);
    await log('/custom', newVersion, { botId: null });
    await log('/ambiguous', newVersion, { state: 'ambiguous' });
    await log('/self-check', newVersion, { ua: 'Liekan-Crawler-Check/test' });
    await log('/previous', oldVersion, { time: '2026-09-30T12:00:00Z' });
    await log('/previous', newVersion, { time: '2026-09-30T12:00:00Z' });
  });
  afterEach(async () => {
    await q('ROLLBACK');
    client.release();
  });
  afterAll(async () => {
    await pool?.end();
  });
  it.each(['ai/bots', 'ai/pages'])(
    'keeps other crawlers outside all six named categories on %s',
    async resource => {
      await log('/agent-other-purpose', newVersion, { type: '其他' });
      await log('/workbench-other-purpose', oldVersion, { type: '其他' });
      for (const type of ['训练', '搜索', '用户触发', '传统搜索'])
        await log('/named-purpose-' + type, null, { type, botId: 'other-bot' });
      await log('/other-official', null, { type: '其他', botId: 'other-bot' });
      await log('/other-custom', newVersion, { type: '其他', botId: null });
      await log('/other-non-ai', null, { type: '其他', botId: 'other-bot', ai: false });
      await log('/previous-other', null, {
        type: '其他',
        botId: 'other-bot',
        time: '2026-09-30T12:00:00Z',
      });
      const other = await facts(undefined, resource, { botCategory: 'other' });
      expect(other.bots.reduce((n, row) => n + row.requests, 0)).toBe(3);
      expect(other.bots.every(row => row.type === '其他' && row.productForm === 'unknown')).toBe(
        true,
      );
      expect(other.pages.map(row => row.path).sort()).toEqual(['/other-custom', '/other-official']);
      expect(other.pages.reduce((n, row) => n + row.requests, 0)).toBe(2);
      expect(other.previousBots.reduce((n, row) => n + row.requests, 0)).toBe(1);
      expect((await facts('personal_agent', resource)).bots.some(row => row.type === '其他')).toBe(
        true,
      );
    },
  );
  it.each(['ai/bots', 'ai/pages'])(
    'keeps historical forms and exact counts on %s',
    async resource => {
      const all = await facts(undefined, resource);
      expect(all.bots.reduce((n, row) => n + row.requests, 0)).toBe(7);
      expect(all.bots.find(row => row.botId === 'fixture-bot').productForm).toBe(
        'personal_agent,unknown,workbench',
      );
      const workbench = await facts('workbench', resource);
      expect(workbench.bots).toHaveLength(1);
      expect(workbench.bots[0]).toMatchObject({ requests: 3, pages: 2, productForm: 'workbench' });
      expect(workbench.previousBots[0].requests).toBe(1);
      expect(workbench.pages.map(row => row.path).sort()).toEqual(['/shared', '/workbench']);
      expect(workbench.pages.reduce((n, row) => n + row.requests, 0)).toBe(3);
      const agent = await facts('personal_agent', resource);
      expect(agent.bots[0]).toMatchObject({ requests: 2, pages: 2, productForm: 'personal_agent' });
      expect(agent.previousBots[0].requests).toBe(1);
      expect(agent.pages.reduce((n, row) => n + row.requests, 0)).toBe(2);
    },
  );
  it('intersects page form/type/identity and keeps custom names outside official forms', async () => {
    expect((await facts('personal_agent', 'ai/pages', { botType: '训练' })).pages).toEqual([]);
    expect((await facts('personal_agent', 'ai/pages', { botName: 'FixtureBot' })).pages).toEqual(
      [],
    );
    expect(
      (await facts('personal_agent', 'ai/pages', { botId: 'fixture-bot' })).pages,
    ).toHaveLength(2);
  });
  it('returns an empty form population when historical bindings cannot identify it', async () => {
    await q('DELETE FROM liekan_crawler_registry_version WHERE version=$1', newVersion);
    const result = await facts('personal_agent');
    expect(result.bots).toEqual([]);
    expect(result.pages).toEqual([]);
    expect(result.previousBots).toEqual([]);
    expect((await facts()).bots.reduce((n, row) => n + row.requests, 0)).toBe(7);
  });
});
