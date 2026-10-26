// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { humanVisitsSql, visitMetrics, convertedJoin } from './analytics';
import { readKeywordFacts } from './keywords';
import { analysisTransaction } from './analysis-rollups-db';
import { query, reportSnapshot } from './server';
import { getQuerySnapshot, withinQuerySnapshot } from './query-snapshot';
import { withTrafficPolicy } from './traffic-query';

const enabled = process.env.LIEKAN_ANALYSIS_ROLLUPS_TEST === '1';
const user = randomUUID(),
  site = randomUUID(),
  foreign = randomUUID();
const sessions = [randomUUID(), randomUUID(), randomUUID()];
const start = new Date('2026-01-02T00:00Z'),
  end = new Date('2026-01-03T00:00Z');
const p = { startAt: +start, endAt: +end, timezone: 'UTC' };
const execute = (sql: string, ...values: unknown[]) =>
  analysisTransaction(tx => tx.$executeRawUnsafe(sql, ...values));
const tail = ` SELECT v.referrer,v."utmSource",v."utmMedium",v."utmCampaign",v."referrerPath",v."referrerQuery",v."utmTerm",${visitMetrics}
  FROM visits v ${convertedJoin} GROUP BY 1,2,3,4,5,6,7`;
const normalize = (rows: any[]) => rows.map(row => JSON.stringify(row)).sort();

async function event(
  at: number,
  visit: string,
  term: string,
  options: {
    session?: string;
    type?: number;
    path?: string;
    classification?: string;
    query?: string;
    utmTerm?: string;
    id?: string;
    identity?: boolean;
  } = {},
) {
  const id = options.id || randomUUID();
  await analysisTransaction(async tx => {
    await tx.$queryRawUnsafe(
      'SELECT website_id FROM website WHERE website_id=$1::uuid FOR UPDATE',
      site,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,event_type,url_path,event_name,hostname,referrer_domain,referrer_path,referrer_query,utm_term)
       VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,'keyword.invalid','www.google.com','/search',$9,$10)`,
      id,
      site,
      options.session || sessions[0],
      visit,
      new Date(at),
      options.type || 1,
      options.path || '/synthetic-keyword',
      options.type === 2 ? 'synthetic-purchase' : null,
      options.query === undefined ? `?q=${term}` : options.query,
      options.utmTerm || null,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO liekan_event_quality(event_id,website_id,classification,source,reasons,rule_version,range_status,hostname)
       VALUES($1::uuid,$2::uuid,$3,'browser','{}','keyword-fixture','missing','keyword.invalid')`,
      id,
      site,
      options.classification || 'browser',
    );
    if (options.identity !== false)
      await tx.$executeRawUnsafe(
        `INSERT INTO liekan_event_environment(event_id,website_id,scope,identity_version,identity_available)
         VALUES($1::uuid,$2::uuid,'browser','keyword-fixture',true)`,
        id,
        site,
      );
  });
}

describe.skipIf(!enabled)('narrow keyword facts against the original dimensioned query', () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL || 'http://invalid');
    if (
      url.hostname !== '127.0.0.1' ||
      url.port !== '15462' ||
      url.pathname !== '/liekan_analysis_rollups_test' ||
      !/^analysis_[a-f0-9]+$/.test(url.searchParams.get('schema') || '')
    )
      throw new Error('Owned keyword fixture database required');
    await execute(
      `INSERT INTO "user"(user_id,username,password,role) VALUES($1::uuid,$2,'synthetic','user')`,
      user,
      `keyword-${user}`,
    );
    for (const website of [site, foreign])
      await execute(
        `INSERT INTO website(website_id,user_id,name,domain) VALUES($1::uuid,$2::uuid,'Synthetic keyword fixture','keyword.invalid')`,
        website,
        user,
      );
    for (const [index, session] of sessions.entries())
      await execute(
        `INSERT INTO session(session_id,website_id,created_at) VALUES($1::uuid,$2::uuid,'2026-01-01')`,
        session,
        index === 2 ? foreign : site,
      );
    await execute(
      `INSERT INTO liekan_collection_policy(website_id,mode) VALUES($1::uuid,'standard')`,
      site,
    );
    for (const parameters of [
      { type: 'path', value: '/goal*' },
      { type: 'event', value: '*purchase' },
    ])
      await execute(
        `INSERT INTO report(report_id,user_id,website_id,type,name,description,parameters,updated_at) VALUES($1::uuid,$2::uuid,$3::uuid,'goal','Synthetic keyword goal','Synthetic fixture',$4::jsonb,clock_timestamp())`,
        randomUUID(),
        user,
        site,
        JSON.stringify(parameters),
      );
    const visit = randomUUID();
    await event(+start - 3600000, visit, 'before-window');
    await event(+start, visit, 'different-window-entry');
    await event(+start + 120000, visit, 'different-later-entry', { path: '/goal-one' });
    await event(+start + 180000, visit, 'custom', { type: 2 });
    await event(+start + 200000, visit, 'same-visit-other-session', { session: sessions[1] });
    const secondVisit = randomUUID();
    await event(+start + 240000, secondVisit, '', { query: '', utmTerm: 'synthetic-utm' });
    await event(+start + 250000, secondVisit, '', { type: 2 });
    await event(+start + 300000, randomUUID(), 'synthetic%40example.invalid');
    const tieVisit = randomUUID(),
      [firstId, secondId] = [randomUUID(), randomUUID()].sort();
    await event(+start + 400000, tieVisit, 'first-tied', { id: firstId });
    await event(+start + 400000, tieVisit, 'later-tied', { id: secondId });
    await event(+end, randomUUID(), 'included-end');
    await event(+end + 1, randomUUID(), 'outside-right');
    await event(+start - 1, randomUUID(), 'outside-left');
    await event(+start + 500000, randomUUID(), 'custom-only', { type: 2 });
    await event(+start + 600000, randomUUID(), 'automated', { classification: 'automated' });
    await event(+start + 700000, randomUUID(), 'suspected', { classification: 'suspected' });
    await event(+start + 800000, randomUUID(), 'foreign-session', { session: sessions[2] });
    await event(+start + 900000, randomUUID(), 'missing-identity', { identity: false });
  });
  afterAll(async () => {
    for (const website of [site, foreign])
      await execute('DELETE FROM website WHERE website_id=$1::uuid', website);
    await execute('DELETE FROM "user" WHERE user_id=$1::uuid', user);
  });
  it.each(['standard', 'strict', 'raw'])(
    'preserves complete projections, redaction and snapshot identity under %s policy',
    async mode => {
      await execute(
        'UPDATE liekan_collection_policy SET mode=$2 WHERE website_id=$1::uuid',
        site,
        mode,
      );
      await reportSnapshot(async () => {
        const originalSql = humanVisitsSql(true) + tail;
        const narrowSql = humanVisitsSql(true, false) + tail;
        const args = [site, start, end, p.timezone];
        const original = await query(originalSql, ...args);
        const actual = await query(narrowSql, ...args);
        expect(original.length).toBeGreaterThan(0);
        expect(normalize(actual)).toEqual(normalize(original));
        expect(
          original.some(
            row =>
              row.referrerQuery === '?q=before-window' &&
              row.pv === 2 &&
              row.bounces === 0 &&
              row.conversions === 1,
          ),
        ).toBe(true);
        expect(original.some(row => row.referrerQuery === '?q=same-visit-other-session')).toBe(
          true,
        );
        expect(original.some(row => row.referrerQuery === '?q=first-tied')).toBe(true);
        expect(original.some(row => row.referrerQuery === '?q=included-end')).toBe(true);
        for (const term of [
          'outside-left',
          'outside-right',
          'foreign-session',
          'custom-only',
          'later-tied',
          'missing-identity',
        ])
          expect(original.some(row => row.referrerQuery === `?q=${term}`)).toBe(false);
        expect(original.some(row => row.referrerQuery === '?q=automated')).toBe(false);
        expect(original.some(row => row.referrerQuery === '?q=suspected')).toBe(false);
        const snapshot = getQuerySnapshot();
        const oracle = await withinQuerySnapshot(
          {
            $executeRawUnsafe: (sql: string, ...values: unknown[]) =>
              snapshot.$executeRawUnsafe(
                sql.startsWith('DECLARE keyword_')
                  ? sql.slice(0, sql.indexOf(' FOR ') + 5) + withTrafficPolicy(originalSql)
                  : sql,
                ...values,
              ),
            $queryRawUnsafe: (sql: string, ...values: unknown[]) =>
              snapshot.$queryRawUnsafe(sql, ...values),
          },
          () => readKeywordFacts(site, p),
        );
        const facts = await readKeywordFacts(site, p);
        expect(facts.rows.length).toBeGreaterThan(0);
        expect(normalize(facts.rows)).toEqual(normalize(oracle.rows));
        expect(facts.hasGoals).toBe(true);
        expect(facts.snapshot).toBe(oracle.snapshot);
        expect(facts.rows.some(row => row.status === 'redacted')).toBe(true);
        expect(
          facts.rows.some(row => row.evidence === 'utm' && row.keyword === 'synthetic-utm'),
        ).toBe(true);
        expect(JSON.stringify(facts)).not.toContain('synthetic@example.invalid');
        const explain = await snapshot.$queryRawUnsafe(
          'EXPLAIN (VERBOSE,FORMAT JSON) ' + withTrafficPolicy(narrowSql),
          ...args,
        );
        if (!Array.isArray(explain)) throw new Error('Expected keyword query plan');
        const nodes = (node: any): any[] => [node, ...(node.Plans || []).flatMap(nodes)];
        const plan = nodes(explain[0]['QUERY PLAN'][0].Plan);
        expect(plan.some(node => node['Relation Name'] === 'liekan_event_geography')).toBe(false);
        expect(JSON.stringify(plan.flatMap(node => node['Sort Key'] || []))).not.toContain('DESC');
      });
      const empty = await reportSnapshot(() =>
        readKeywordFacts(site, { ...p, startAt: +end + 86400000, endAt: +end + 86401000 }),
      );
      expect(empty.rows).toEqual([]);
      expect(empty.hasGoals).toBe(true);
    },
  );
});
