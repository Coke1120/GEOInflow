// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyEntrySource } from '../contracts/sources';

const enabled = process.env.LIEKAN_ANALYSIS_ROLLUPS_TEST === '1';
const user = randomUUID(),
  site = randomUUID(),
  sessions = [randomUUID(), randomUUID(), randomUUID()],
  visits = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
let userCreated = false,
  siteCreated = false;
let db: typeof import('./analysis-rollups-db'),
  journey: typeof import('./feature-analytics'),
  registry: typeof import('./crawler-registry-context');
const execute = (sql: string, ...params: unknown[]) =>
  db.analysisTransaction(tx => tx.$executeRawUnsafe(sql, ...params));
const parameters = {
  startAt: +new Date('2026-01-01T00:00Z'),
  endAt: +new Date('2026-01-01T01:00Z'),
  timezone: 'UTC',
  type: 'pages',
  steps: 2,
  startStep: '/start',
  endStep: '/end',
  refresh: '1',
};

async function event(
  visit: number,
  at: string,
  path: string,
  referrer: string | null,
  id = randomUUID(),
  automated = false,
  eventType = 1,
) {
  const owner = visit < 2 ? 0 : visit - 1;
  await db.analysisTransaction(async tx => {
    await tx.$executeRawUnsafe(
      'SELECT website_id FROM website WHERE website_id=$1::uuid FOR UPDATE',
      site,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,event_type,url_path,hostname,referrer_domain)
       VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$8,$6,'journey.invalid',$7)`,
      id,
      site,
      sessions[owner],
      visits[visit],
      new Date(at),
      path,
      referrer,
      eventType,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO liekan_event_quality(event_id,website_id,classification,source,reasons,rule_version,range_status,hostname)
       VALUES($1::uuid,$2::uuid,$3,'browser','{}','journey-fixture','missing','journey.invalid')`,
      id,
      site,
      automated ? 'automated' : 'browser',
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO liekan_event_environment(event_id,website_id,scope,identity_version,identity_available,browser)
       VALUES($1::uuid,$2::uuid,'browser','journey-fixture',true,$3)`,
      id,
      site,
      owner === 1 ? 'Safari' : 'Firefox',
    );
  });
}

describe.skipIf(!enabled)('journey sources from the exact selected population', () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL || 'http://invalid');
    if (
      url.hostname !== '127.0.0.1' ||
      url.port !== '15462' ||
      url.pathname !== '/liekan_analysis_rollups_test' ||
      !/^analysis_[a-f0-9]+$/.test(url.searchParams.get('schema') || '')
    )
      throw new Error('Owned journey fixture database required');
    db = await import('./analysis-rollups-db');
    journey = await import('./feature-analytics');
    registry = await import('./crawler-registry-context');
    await execute(
      `INSERT INTO "user"(user_id,username,password,role) VALUES($1::uuid,$2,'synthetic','user')`,
      user,
      `journey-${user}`,
    );
    userCreated = true;
    await execute(
      `INSERT INTO website(website_id,user_id,name,domain) VALUES($1::uuid,$2::uuid,'Synthetic journey fixture','journey.invalid')`,
      site,
      user,
    );
    siteCreated = true;
    for (const session of sessions)
      await execute(
        `INSERT INTO session(session_id,website_id,created_at) VALUES($1::uuid,$2::uuid,'2026-01-01')`,
        session,
        site,
      );
    const [first, tied] = [randomUUID(), randomUUID()].sort();
    await event(0, '2026-01-01T00:00Z', '/before', 'excluded.test', randomUUID(), true);
    await event(0, '2026-01-01T00:01Z', '/before', 'first.test', first);
    await event(0, '2026-01-01T00:01Z', '/before', 'tied.test', tied);
    await event(0, '2026-01-01T00:02Z', '/start', 'window.test');
    await event(0, '2026-01-01T00:03Z', '/end', 'window.test');
    await event(1, '2026-01-01T00:04Z', '/before', 'first.test');
    await event(1, '2026-01-01T00:05Z', '/start', 'window.test');
    await event(1, '2026-01-01T00:06Z', '/end', 'window.test');
    await event(2, '2026-01-01T00:01Z', '/before', null);
    await event(2, '2026-01-01T00:02Z', '/start', 'later.test');
    await event(2, '2026-01-01T00:03Z', '/end', 'later.test');
    await event(3, '2026-01-01T00:01Z', '/start', 'automated.test', randomUUID(), true);
    await event(3, '2026-01-01T00:02Z', '/end', 'automated.test', randomUUID(), true);
  });
  afterAll(async () => {
    if (siteCreated) await execute('DELETE FROM website WHERE website_id=$1::uuid', site);
    if (userCreated) await execute('DELETE FROM "user" WHERE user_id=$1::uuid', user);
  });

  it('preserves full-window sources, stable ties, visit membership and session detail totals', async () => {
    await registry.withPublishedRegistry(async () => {
      const result = await journey.featureJourney(site, parameters);
      expect(result).toMatchObject({
        visitors: 2,
        rows: [
          {
            nodes: ['/start', '/end'],
            visitors: 2,
            visits: 3,
            source: classifyEntrySource({ referrer: 'first.test' }).source,
          },
        ],
      });
      const detail = await journey.featureJourney(site, {
        ...parameters,
        sequence: JSON.stringify(['/start', '/end']),
      });
      expect(detail.count).toBe(2);
      expect(detail.sessions).toHaveLength(2);
      expect(detail.sessions.find(row => row.id === sessions[0])).toMatchObject({ views: 7 });
      expect(detail.sessions.find(row => row.id === sessions[1])).toMatchObject({ views: 3 });
      const filtered = await journey.featureJourney(site, { ...parameters, browser: 'eq.Safari' });
      expect(filtered).toMatchObject({
        visitors: 1,
        rows: [{ nodes: ['/start', '/end'], visitors: 1, visits: 1, source: null }],
      });
    });
  });
  it('limits replay lists to recorded eligible visits while retaining chunks, saved membership and filters', async () => {
    await registry.withPublishedRegistry(async () => {
      const input = {
        startAt: parameters.startAt,
        endAt: parameters.endAt,
        timezone: 'UTC',
        kind: 'replays',
        page: 1,
      };
      expect(await journey.featureAnalytics(site, input)).toMatchObject({ rows: [], count: 0 });
      for (const [visit, chunk, events] of [
        [0, 0, 2],
        [0, 1, 3],
        [2, 0, 1],
        [3, 0, 1],
      ]) {
        const owner = visit < 2 ? 0 : visit - 1;
        await execute(
          `INSERT INTO session_replay(replay_id,website_id,session_id,visit_id,chunk_index,events,event_count,started_at,ended_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'synthetic',$6,'2026-01-01T00:01Z','2026-01-01T00:03Z')`,
          randomUUID(),
          site,
          sessions[owner],
          visits[visit],
          chunk,
          events,
        );
      }
      const [policy] = await db.analysisTransaction(tx =>
        tx.$queryRawUnsafe<any[]>(
          `SELECT
        (SELECT array_agg(replay_id ORDER BY replay_id) FROM liekan_effective_session_replay WHERE website_id=$1::uuid) AS actual,
        (SELECT array_agg(r.replay_id ORDER BY r.replay_id) FROM session_replay r WHERE r.website_id=$1::uuid AND EXISTS(SELECT 1 FROM liekan_effective_website_event e WHERE e.website_id=r.website_id AND e.session_id=r.session_id AND e.visit_id=r.visit_id)) AS original,
        pg_get_viewdef('liekan_effective_session_replay'::regclass) AS definition`,
          site,
        ),
      );
      expect(policy.actual).toEqual(policy.original);
      expect(policy.actual).toHaveLength(3);
      expect(policy.definition).toMatch(/OFFSET 0/);
      const result = await journey.featureAnalytics(site, input);
      expect(result.count).toBe(2);
      expect(result.rows.find(row => row.id === visits[0])).toMatchObject({
        pageviews: 4,
        eventCount: 5,
        chunkCount: 2,
      });
      expect(result.rows.some(row => row.id === visits[3])).toBe(false);
      expect(await journey.featureAnalytics(site, { ...input, saved: '1' })).toMatchObject({
        rows: [],
        count: 0,
      });
      await execute(
        `INSERT INTO session_replay_saved(saved_replay_id,website_id,visit_id,name) VALUES($1::uuid,$2::uuid,$3::uuid,'Synthetic saved replay')`,
        randomUUID(),
        site,
        visits[0],
      );
      const saved = await journey.featureAnalytics(site, { ...input, saved: '1' });
      expect(saved.count).toBe(1);
      expect(saved.rows).toHaveLength(1);
      expect(saved.rows[0]).toMatchObject({
        id: visits[0],
        eventCount: 5,
        name: 'Synthetic saved replay',
      });
      expect(
        await journey.featureAnalytics(site, { ...input, browser: 'eq.Safari' }),
      ).toMatchObject({ count: 1, rows: [{ id: visits[2] }] });
    });
  });
  it('preserves revenue session membership across visits, exact amounts, currencies and date bounds', async () => {
    await event(0, '2026-01-01T00:10Z', '/revenue-entry', null);
    await event(2, '2026-01-01T00:10Z', '/revenue-entry', null);
    const transactions = [
      // The selected event belongs to another visit; the revenue timestamp sets the date bound.
      [1, '2026-01-01T01:30Z', '2026-01-01T00:30Z', 'CNY', '900719925474099.0101', false],
      [2, '2026-01-01T00:35Z', '2026-01-01T00:35Z', 'cny', '23.2500', false],
      [1, '2026-01-01T00:40Z', '2026-01-01T00:40Z', 'USD', '12.7500', false],
      [1, '2026-01-01T00:45Z', '2026-01-01T00:45Z', 'CNY', '999', true],
      [1, '2026-01-01T00:50Z', '2026-01-01T02:00Z', 'CNY', '888', false],
      [3, '2026-01-01T00:55Z', '2026-01-01T00:55Z', 'CNY', '777', false],
      [1, '2026-01-01T01:00Z', '2026-01-01T01:00Z', 'CNY', '0.0101', false],
    ] as const;
    const ids: string[] = [];
    for (const [visit, eventAt, revenueAt, currency, amount, automated] of transactions) {
      const id = randomUUID(),
        owner = visit < 2 ? 0 : visit - 1;
      ids.push(id);
      await event(visit, eventAt, '/purchase', null, id, automated, 5);
      await execute(
        `INSERT INTO revenue(revenue_id,website_id,session_id,event_id,event_name,currency,revenue,created_at)
         VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'synthetic-purchase',$5,$6::numeric,$7)`,
        randomUUID(),
        site,
        sessions[owner],
        id,
        currency,
        amount,
        new Date(revenueAt),
      );
    }
    await registry.withPublishedRegistry(async () => {
      const input = {
        startAt: parameters.startAt,
        endAt: parameters.endAt,
        timezone: 'UTC',
        kind: 'revenue',
        currency: 'CNY',
      };
      const all = await journey.featureAnalytics(site, input);
      expect(all.count).toBe(3);
      expect(all.rows.map(row => row.id)).toEqual([ids[6], ids[1], ids[0]]);
      expect(all.rows.find(row => row.id === ids[0])).toMatchObject({
        sessionId: sessions[0],
        amount: '900719925474099.0101',
        currency: 'CNY',
        createdAt: '2026-01-01T00:30:00.000Z',
      });
      expect(all.rows.find(row => row.id === ids[1])).toMatchObject({
        sessionId: sessions[1],
        amount: '23.25',
        currency: 'cny',
      });
      const filtered = await journey.featureAnalytics(site, {
        ...input,
        browser: 'eq.Firefox',
        path: 'eq./revenue-entry',
      });
      expect(filtered.count).toBe(2);
      expect(filtered.rows.map(row => row.id)).toEqual([ids[6], ids[0]]);
      const dollar = await journey.featureAnalytics(site, { ...input, currency: 'USD' });
      expect(dollar).toMatchObject({ count: 1, rows: [{ id: ids[2], amount: '12.75' }] });
      expect(await journey.featureAnalytics(site, { ...input, page: 2 })).toMatchObject({
        count: 3,
        rows: [],
        page: 2,
      });
    });
  });
});
