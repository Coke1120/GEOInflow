// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { HumanFact } from './analytics';
import { getQuerySnapshot, withinQuerySnapshot } from './query-snapshot';

const enabled = process.env.LIEKAN_ANALYSIS_ROLLUPS_TEST === '1';
const actor = { userId: randomUUID() };
const sites: string[] = [];
let site: string, session: string, secondSession: string;
let db: typeof import('./analysis-rollups-db'), rollups: typeof import('./analysis-rollups');
let detail: typeof import('./browser-detail-facts'), analytics: typeof import('./analytics');
let server: typeof import('./server');
const q = <T = any[]>(sql: string, ...values: unknown[]) =>
  db.analysisTransaction(tx => tx.$queryRawUnsafe<T>(sql, ...values));
const execute = (sql: string, ...values: unknown[]) =>
  db.analysisTransaction(tx => tx.$executeRawUnsafe(sql, ...values));
const start = new Date('2026-01-01T23:00Z'),
  end = new Date('2026-01-02T02:00Z');
const fields: HumanFact[] = [
  'daily',
  'geo',
  'sources',
  'environment',
  'pages',
  'heatmap',
  'newVisitors',
  'goals',
  'converted',
  'dailySources',
  'dailyConversions',
];
const pick = (value: any) =>
  Object.fromEntries([...fields, 'conversionEvents'].map(key => [key, value[key]]));
const facts = (from = start, until = end, timezone = 'UTC') =>
  server.reportSnapshot(() => analytics.getHumanFacts(site, from, until, timezone, fields));

async function event(
  at: string,
  path: string,
  options: {
    session?: string;
    visit?: string;
    type?: number;
    name?: string;
    browser?: string;
    country?: string;
    referrer?: string;
    excluded?: boolean;
  } = {},
) {
  const id = randomUUID(),
    owner = options.session || session;
  await db.analysisTransaction(async tx => {
    await tx.$executeRawUnsafe(
      'SELECT website_id FROM website WHERE website_id=$1::uuid FOR UPDATE',
      site,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,event_type,url_path,event_name,hostname,referrer_domain,utm_source)
     VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,'detail.invalid',$9,$10)`,
      id,
      site,
      owner,
      options.visit || owner,
      new Date(at),
      options.type || 1,
      path,
      options.name || null,
      options.referrer || '',
      options.referrer ? 'entry-source' : null,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO liekan_event_quality(event_id,website_id,classification,source,reasons,rule_version,range_status,hostname)
     VALUES($1::uuid,$2::uuid,$3,'browser','{}','detail-fixture','missing','detail.invalid')`,
      id,
      site,
      options.excluded ? 'automated' : 'browser',
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO liekan_event_environment(event_id,website_id,scope,identity_version,identity_available,browser,os,device)
     VALUES($1::uuid,$2::uuid,'browser','detail-fixture',true,$3,'event-os','event-device')`,
      id,
      site,
      options.browser || 'Firefox',
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO liekan_event_geography(event_id,website_id,country,region,city,source,trust,ip_family,precision,reason,rule_version,country_basis,processed_at)
     VALUES($1::uuid,$2::uuid,$3,NULL,NULL,'synthetic','synthetic','missing','country','synthetic','fixture','synthetic',clock_timestamp())`,
      id,
      site,
      options.country || 'CN',
    );
  });
  return id;
}
async function build(from = start, until = end) {
  const job = await rollups.createAnalysisBuild(site, actor, {
    startDate: from,
    endDate: until,
    timezone: 'UTC',
    locale: 'zh-CN',
    requestId: randomUUID(),
  });
  await execute(
    `UPDATE liekan_analysis_build SET family='visit',checkpoint=$2::jsonb,work_total=extract(epoch FROM range_end-range_start)::bigint/3600 WHERE id=$1::uuid`,
    job.id,
    JSON.stringify({ hour: from.toISOString(), family: 'visit', chunkSize: 2 }),
  );
  for (let i = 0; i < 150; i++) {
    const [row] = await q(
      'SELECT status,error_code FROM liekan_analysis_build WHERE id=$1::uuid',
      job.id,
    );
    if (row.status === 'completed') return job;
    if (['failed', 'invalidated', 'capacity_limited'].includes(row.status))
      throw new Error(`detail fixture ${JSON.stringify(row)}`);
    await rollups.runOneAnalysisWorkUnit(job.id);
  }
  throw new Error('detail fixture did not finish');
}

describe.skipIf(!enabled)('exact persisted browser detail facts', () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL || 'http://invalid');
    if (
      url.hostname !== '127.0.0.1' ||
      url.port !== '15462' ||
      url.pathname !== '/liekan_analysis_rollups_test' ||
      !/^analysis_[a-f0-9]+$/.test(url.searchParams.get('schema') || '')
    )
      throw new Error('Owned browser detail database required');
    db = await import('./analysis-rollups-db');
    rollups = await import('./analysis-rollups');
    detail = await import('./browser-detail-facts');
    analytics = await import('./analytics');
    server = await import('./server');
    await execute(
      `INSERT INTO "user"(user_id,username,password,role) VALUES($1::uuid,$2,'synthetic','user')`,
      actor.userId,
      `detail-${actor.userId}`,
    );
  });
  beforeEach(async () => {
    site = randomUUID();
    session = randomUUID();
    secondSession = randomUUID();
    sites.push(site);
    await execute(
      `INSERT INTO website(website_id,user_id,name,domain) VALUES($1::uuid,$2::uuid,'Synthetic detail fixture','detail.invalid')`,
      site,
      actor.userId,
    );
    await execute(
      `INSERT INTO session(session_id,website_id,created_at,browser,country) VALUES($1::uuid,$3::uuid,'2026-01-01T22:00Z','stale-browser','US'),($2::uuid,$3::uuid,'2026-01-02T00:00Z','stale-browser','US')`,
      session,
      secondSession,
      site,
    );
    await execute(
      `INSERT INTO report(report_id,website_id,user_id,name,description,type,parameters) VALUES($1::uuid,$2::uuid,$3::uuid,'Signup','Synthetic goal fixture','goal','{"type":"event","value":"sign*"}')`,
      randomUUID(),
      site,
      actor.userId,
    );
  });
  afterAll(async () => {
    if (!enabled || !db) return;
    for (const id of sites) await execute('DELETE FROM website WHERE website_id=$1::uuid', id);
    await execute('DELETE FROM "user" WHERE user_id=$1::uuid', actor.userId);
    const { default: prisma } = await import('@/lib/prisma');
    await prisma.client.$disconnect();
  });
  it('matches the original raw contract across chunks, buckets, days, identities, entry and dwell', async () => {
    await event('2026-01-01T22:59:00Z', '/entry', { referrer: 'google.com' });
    await event('2026-01-01T23:59:58Z', '/a', { country: 'CN' });
    await event('2026-01-02T00:00:00Z', '/b', { country: 'GB', browser: 'Safari' });
    await event('2026-01-02T00:01:00Z', '/a');
    await event('2026-01-02T00:03:00Z', '/goal', { type: 2, name: 'signup' });
    await event('2026-01-02T00:04:59Z', '/a');
    await event('2026-01-02T00:05:00Z', '/c');
    await event('2026-01-02T00:05:00Z', '/d');
    await event('2026-01-02T00:59:59Z', '/c');
    await event('2026-01-02T01:00:00Z', '/d');
    await event('2026-01-02T00:10:00Z', '/bounce', { visit: randomUUID(), session: secondSession });
    await event('2026-01-02T00:12:00Z', '/repeat-session', { visit: randomUUID() });
    await event('2026-01-02T00:13:00Z', '/shared-visit-id', {
      visit: session,
      session: secondSession,
    });
    await event('2026-01-02T00:11:00Z', '/excluded', { excluded: true });
    const oracle = pick(
      await server.reportSnapshot(async () => {
        await getQuerySnapshot().$executeRawUnsafe('SET LOCAL enable_hashagg=off');
        return facts();
      }),
    );
    await build();
    const actual = pick(await facts());
    try {
      expect(actual).toEqual(oracle);
    } catch (error) {
      await writeFile(
        `${process.env.LIEKAN_ANALYSIS_ROLLUPS_OUTPUT}/browser-detail-diff.json`,
        JSON.stringify({ actual, oracle }, null, 2),
        { mode: 0o600 },
      );
      throw error;
    }
    const [counts] = await q(
      `SELECT (SELECT count(*) FROM liekan_analysis_browser_visit WHERE website_id=$1::uuid)::int AS visits,(SELECT count(*) FROM liekan_analysis_browser_detail WHERE website_id=$1::uuid AND complete)::int AS complete`,
      site,
    );
    expect(counts.visits).toBeGreaterThan(1);
    expect(counts.complete).toBeGreaterThan(0);
    expect((await facts()).environment.every(row => row.browser !== 'stale-browser')).toBe(true);
  });
  it('merges proved history with raw gaps and preserves inclusive and half-open millisecond boundaries', async () => {
    await event('2026-01-01T23:59:59.999Z', '/before');
    await event('2026-01-02T00:00:00.000Z', '/at');
    await event('2026-01-02T00:04:59.999Z', '/before-five');
    await event('2026-01-02T00:05:00.000Z', '/five');
    await event('2026-01-02T01:00:00.000Z', '/raw-tail');
    const windowStart = new Date('2026-01-01T23:59:59.999Z'),
      windowEnd = new Date('2026-01-02T01:00:00.000Z');
    const oracle = pick(await facts(windowStart, windowEnd, 'Asia/Kathmandu'));
    const exclusiveOracle = pick(
      await facts(windowStart, new Date(+windowEnd - 1), 'Asia/Kathmandu'),
    );
    await build(start, new Date('2026-01-02T01:00Z'));
    expect(pick(await facts(windowStart, windowEnd, 'Asia/Kathmandu'))).toEqual(oracle);
    const halfOpen = await detail.readBrowserDetailFacts(
      site,
      windowStart,
      windowEnd,
      'Asia/Kathmandu',
      fields,
      { halfOpen: true },
    );
    expect(halfOpen?.pages).toEqual(exclusiveOracle.pages);
    expect(halfOpen?.daily).toEqual(exclusiveOracle.daily);
  });
  it('falls back from a changed generation and publishes corrected first entry and dwell', async () => {
    await event('2026-01-02T00:01Z', '/a', { referrer: 'google.com' });
    await event('2026-01-02T00:07Z', '/b');
    await build();
    await event('2026-01-01T23:59Z', '/earlier', { referrer: 'bing.com' });
    const stale = await facts();
    const oracle = pick(stale);
    await build();
    expect(pick(await facts())).toEqual(oracle);
    expect((await facts()).sourceEvidence[0].referrer).toBe('bing.com');
  });
  it('reads fully covered historical pages without executing historical event scans', async () => {
    await event('2026-01-02T00:01Z', '/a');
    await event('2026-01-02T00:04Z', '/b');
    await build();
    let captured: { sql: string; values: unknown[] };
    await db.analysisTransaction(tx =>
      withinQuerySnapshot(
        {
          $executeRawUnsafe: (sql: string, ...values: unknown[]) =>
            tx.$executeRawUnsafe(sql, ...values),
          $queryRawUnsafe: async (sql: string, ...values: unknown[]) => {
            if (sql.startsWith('WITH original_coverage AS MATERIALIZED'))
              captured = { sql, values };
            return tx.$queryRawUnsafe(sql, ...values);
          },
        },
        () => detail.readBrowserDetailFacts(site, start, end, 'UTC', ['pages']),
      ),
    );
    expect(captured).toBeDefined();
    const [row] = await q(`EXPLAIN (ANALYZE,FORMAT JSON) ${captured.sql}`, ...captured.values);
    const nodes = (node: any): any[] => [node, ...(node.Plans || []).flatMap(nodes)];
    const reads = nodes(row['QUERY PLAN'][0].Plan).filter(
      node => node['Relation Name'] === 'website_event',
    );
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every(node => !node['Actual Loops'] || node['Actual Rows'] === 0)).toBe(true);
  });
});
