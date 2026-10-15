// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({
  site: '',
  source: '',
  importId: '',
  records: [] as any[],
  statements: [] as { sql: string; params: any[] }[],
}));
vi.mock('../upstream/server', () => ({
  LiekanError: class extends Error {},
  query: async () => [{ website_id: captured.site, source_id: captured.source, state: 'pending' }],
  sourceWebsite: async () => ({ domain: 'example.com', user_id: null, team_id: null }),
  transaction: async (work: any) =>
    work({
      $queryRawUnsafe: async (sql: string, ...params: any[]) => {
        if (sql.includes('FROM liekan_log_source'))
          return [
            {
              id: captured.source,
              website_id: captured.site,
              domain: 'example.com',
              owner_id: null,
              team_id: null,
              state: 'active',
            },
          ];
        if (sql.includes('FROM liekan_log_state')) return [{ epoch: 1 }];
        if (sql.includes('FROM liekan_ingest_batch'))
          return [
            {
              id: captured.importId,
              epoch: 1,
              state: 'pending',
              payload: captured.records,
              digest: 'fixture',
              rejected: 0,
            },
          ];
        captured.statements.push({ sql, params });
        return [];
      },
      $executeRawUnsafe: async (sql: string, ...params: any[]) => {
        captured.statements.push({ sql, params });
        return 0;
      },
    }),
}));
import { processBatch } from './service';

const enabled = process.env.LIEKAN_CRAWLER_TEST === '1';
describe.skipIf(!enabled)('batch lookups with stale PostgreSQL statistics', () => {
  let db: Client;
  let conflict: (typeof captured.statements)[number];
  let geography: (typeof captured.statements)[number];
  let evidence: (typeof captured.statements)[number];
  const rows = 1000;
  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL || 'http://invalid');
    if (
      target.hostname !== '127.0.0.1' ||
      target.port !== '15440' ||
      target.pathname !== '/liekan_crawler_acceptance'
    )
      throw new Error('Only the named isolated crawler acceptance database is permitted');
    db = new Client({ connectionString: target.toString() });
    await db.connect();
    // Session-local copies keep the real dataset and its planner statistics untouched.
    for (const table of ['liekan_log', 'liekan_log_geography', 'liekan_crawler_evidence'])
      await db.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
    captured.site = randomUUID();
    captured.source = randomUUID();
    captured.importId = randomUUID();
    captured.records = Array.from({ length: rows }, (_, index) => ({
      id: index.toString(16).padStart(32, '0'),
      time: new Date().toISOString(),
      eventDigest: 'same-digest',
      classificationVersion: 'fixture-version',
      crawlerId: 'gptbot',
      geography: {
        location: {},
        source: 'authenticated_server',
        trust: 'trusted',
        ipFamily: 'ipv4',
        precision: 'missing',
        reason: 'missing',
        ruleVersion: 'fixture',
        countryBasis: 'none',
        processedAt: new Date().toISOString(),
      },
    }));
    const insert = `INSERT INTO liekan_log(id,website_id,import_id,created_at,path,method,status,bytes,ip_masked,ip_hash,user_agent,location,bot,vendor,bot_type,verification,event_digest)
      SELECT id,$1::uuid,$2::uuid,now(),'/fixture','GET',200,0,'masked','hash','fixture','unknown','GPTBot','OpenAI','training','unverified','same-digest' FROM `;
    await db.query(insert + '(SELECT md5(g::text) AS id FROM generate_series(1,100000) g) old', [
      captured.site,
      randomUUID(),
    ]);
    await db.query(insert + 'unnest($3::text[]) AS incoming(id)', [
      captured.site,
      captured.importId,
      captured.records.map(row => row.id),
    ]);
    // No ANALYZE: freshly populated tables reproduce the pre-autovacuum planning window.
    await processBatch(captured.importId);
    conflict = captured.statements.find(
      ({ sql }) => sql.includes('SELECT 1') && sql.includes('eventDigest'),
    )!;
    geography = captured.statements.find(({ sql }) =>
      sql.includes('INSERT INTO liekan_log_geography'),
    )!;
    evidence = captured.statements.find(({ sql }) =>
      sql.includes('INSERT INTO liekan_crawler_evidence'),
    )!;
    expect(conflict).toBeDefined();
    expect(geography).toBeDefined();
    expect(evidence).toBeDefined();
  }, 30000);
  afterAll(async () => {
    await db?.end();
  });

  async function plan(statement: typeof conflict) {
    await db.query('BEGIN');
    try {
      const result = await db.query(
        'EXPLAIN (ANALYZE, FORMAT JSON) ' + statement.sql,
        statement.params,
      );
      return result.rows[0]['QUERY PLAN'][0].Plan;
    } finally {
      await db.query('ROLLBACK');
    }
  }
  function assertBatchBounded(root: any) {
    const nodes: any[] = [];
    const walk = (node: any) => {
      nodes.push(node);
      node.Plans?.forEach(walk);
    };
    walk(root);
    const lookups = nodes.filter(
      node =>
        node['Relation Name'] === 'liekan_log' || node['Index Name']?.startsWith('liekan_log_'),
    );
    expect(lookups.length).toBeGreaterThan(0);
    for (const node of lookups)
      expect(
        (node['Actual Rows'] +
          (node['Rows Removed by Filter'] || 0) +
          (node['Rows Removed by Index Recheck'] || 0)) *
          node['Actual Loops'],
        JSON.stringify(node),
      ).toBeLessThanOrEqual(rows);
    const json = nodes.find(node => node['Node Type'] === 'Function Scan');
    expect(json['Actual Loops']).toBe(1);
  }
  it('bounds conflict checks by incoming events before planner statistics refresh', async () => {
    assertBatchBounded(await plan(conflict));
    expect((await db.query(conflict.sql, conflict.params)).rowCount).toBe(0);
    await db.query('UPDATE liekan_log SET event_digest=NULL WHERE website_id=$1 AND id=$2', [
      captured.site,
      captured.records[0].id,
    ]);
    expect((await db.query(conflict.sql, conflict.params)).rowCount).toBe(1);
    await db.query('UPDATE liekan_log SET event_digest=$3 WHERE website_id=$1 AND id=$2', [
      captured.site,
      captured.records[0].id,
      'changed-digest',
    ]);
    expect((await db.query(conflict.sql, conflict.params)).rowCount).toBe(1);
  }, 30000);
  it('bounds geography evidence joins and keeps missing event IDs excluded', async () => {
    assertBatchBounded(await plan(geography));
    const incoming = JSON.parse(geography.params[1]);
    const withMissing = [
      captured.site,
      JSON.stringify([...incoming, { ...incoming[0], id: 'missing-event' }]),
    ];
    expect((await db.query(geography.sql, withMissing)).rowCount).toBe(rows);
    expect((await db.query(geography.sql, geography.params)).rowCount).toBe(0);
    const otherSite = [randomUUID(), geography.params[1]];
    expect((await db.query(geography.sql, otherSite)).rowCount).toBe(0);
  }, 30000);
  it('bounds crawler evidence joins and retains import ownership and idempotency', async () => {
    assertBatchBounded(await plan(evidence));
    expect(
      (await db.query(evidence.sql, [captured.site, randomUUID(), evidence.params[2]])).rowCount,
    ).toBe(0);
    expect((await db.query(evidence.sql, evidence.params)).rowCount).toBe(rows);
    expect((await db.query(evidence.sql, evidence.params)).rowCount).toBe(0);
  }, 30000);
});
