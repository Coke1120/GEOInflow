import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { sqlStatements } from '../../scripts/liekan-sql-statements.mjs';

// Always create an owned temporary schema; joined schemas and production data are never reset.
const target = process.env.LIEKAN_HUMAN_TEST_DATABASE_URL;
assert(target, 'Set LIEKAN_HUMAN_TEST_DATABASE_URL to an isolated local PostgreSQL test database');
const url = new URL(target);
assert(
  ['127.0.0.1', 'localhost'].includes(url.hostname),
  'Integration tests require a local isolated database',
);
const schema = 'liekan_human_test_' + randomUUID().replaceAll('-', '');
url.searchParams.set('schema', schema);
process.env.DATABASE_URL = url.toString();
const db = new pg.Client({ connectionString: target });
let prisma: any;
await db.connect();
let passed = 0;
const upgrade = {
  run: randomUUID(),
  site: randomUUID(),
  actor: randomUUID(),
  active: randomUUID(),
  previous: randomUUID(),
};
const test = async (name: string, work: () => Promise<void>) => {
  await work();
  passed++;
  console.log('PASS', name);
};
try {
  await db.query(`CREATE SCHEMA "${schema}"`);
  await db.query(`SET search_path TO "${schema}"`);
  for (const path of ['prisma/migrations', 'db/liekan/migrations']) {
    for (const file of (await readdir(path))
      .filter(f => (path.startsWith('prisma') ? /^\d/.test(f) : f.endsWith('.sql')))
      .sort()) {
      if (file === '037_browser_population.sql') {
        await db.query(
          `INSERT INTO website(website_id,name,domain) VALUES($1,'Upgrade fixture','upgrade.test')`,
          [upgrade.site],
        );
        await db.query(
          `INSERT INTO liekan_history_repair_run(id,website_id,campaign_id,actor_id,status,generation,active_generation,previous_generation,repair_scope_id,snapshot,locale,lease_token,lease_until)
          VALUES($1,$2,'traffic-quality-repair-20261022-v1',$3,'validating',gen_random_uuid(),$4,$5,gen_random_uuid(),'{"rulepack":{"engine":"history-repair-v1.1"}}','zh-CN',gen_random_uuid(),now()+interval '1 minute')`,
          [upgrade.run, upgrade.site, upgrade.actor, upgrade.active, upgrade.previous],
        );
      }
      const text = await readFile(
        `${path}/${file}${path.startsWith('prisma') ? '/migration.sql' : ''}`,
        'utf8',
      );
      await db.query('BEGIN');
      for (const statement of sqlStatements(text)) await db.query(statement);
      await db.query('COMMIT');
    }
  }
  await test('upgrade fences old workers while retaining active and rollback generations', async () => {
    const {
      rows: [row],
    } = await db.query(
      'SELECT status,lease_token,active_generation,previous_generation FROM liekan_history_repair_run WHERE id=$1',
      [upgrade.run],
    );
    assert.equal(row.status, 'invalidated');
    assert.equal(row.lease_token, null);
    assert.equal(row.active_generation, upgrade.active);
    assert.equal(row.previous_generation, upgrade.previous);
    await assert.rejects(
      () =>
        db.query("UPDATE liekan_history_repair_run SET status='queued' WHERE id=$1", [upgrade.run]),
      (e: any) => e.code === '23514',
    );
  });
  const website = randomUUID(),
    owner = randomUUID(),
    session = randomUUID(),
    visit = randomUUID(),
    link = randomUUID(),
    pixel = randomUUID();
  await db.query('INSERT INTO "user"(user_id,username,password,role) VALUES($1,$2,$3,$4)', [
    owner,
    'human-test',
    'unusable-test-password',
    'admin',
  ]);
  await db.query('INSERT INTO website(website_id,name,domain,user_id) VALUES($1,$2,$3,$4)', [
    website,
    '隔离验收站点',
    'example.test',
    owner,
  ]);
  await db.query('INSERT INTO link(link_id,name,url,user_id,slug) VALUES($1,$2,$3,$4,$5)', [
    link,
    '隔离链接',
    'https://example.test/',
    owner,
    'human-test',
  ]);
  await db.query('INSERT INTO pixel(pixel_id,name,user_id,slug) VALUES($1,$2,$3,$4)', [
    pixel,
    '隔离像素',
    owner,
    'human-pixel-test',
  ]);
  await db.query('INSERT INTO session(session_id,website_id,browser,os) VALUES($1,$2,$3,$4)', [
    session,
    website,
    'Old mixed browser',
    'Old mixed OS',
  ]);
  const add = async (
    type = 1,
    source: string | null = 'browser',
    classification = 'browser',
    resource = website,
    at = new Date(),
    received = at,
  ) => {
    const event = randomUUID();
    await db.query(
      'INSERT INTO website_event(event_id,website_id,session_id,visit_id,event_type,url_path,hostname,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [event, resource, session, visit, type, '/', 'example.test', at],
    );
    if (source)
      await db.query(
        `INSERT INTO liekan_event_quality(event_id,website_id,classification,source,reasons,rule_version,range_status,hostname,created_at)
      VALUES($1,$2,$3,$4,'{}','traffic-quality-v4','missing','example.test',$5)`,
        [event, resource, classification, source, received],
      );
    return event;
  };
  const browser = await add();
  const humanEvent = await add(2),
    performance = await add(5);
  await add(3);
  await add(4);
  await add(1, 'authenticated_server');
  await add(1, 'legacy_override');
  await add(1, null);
  await add(1, 'browser', 'automated');
  const linkEvent = await add(3, null, 'browser', link),
    pixelEvent = await add(4, null, 'browser', pixel);
  await test('typed views keep browser event types and genuine link/pixel while closing website type bypass', async () => {
    const { rows } = await db.query(
      'SELECT event_id::text FROM liekan_effective_browser_event ORDER BY event_id',
    );
    assert.deepEqual(rows.map(r => r.event_id).sort(), [browser, humanEvent, performance].sort());
    const all = await db.query(
      'SELECT event_id::text FROM liekan_effective_website_event ORDER BY event_id',
    );
    assert.deepEqual(
      all.rows.map(r => r.event_id).sort(),
      [browser, humanEvent, performance, linkEvent, pixelEvent].sort(),
    );
  });
  await test('raw policy cannot bring known automation or server producers into browser population', async () => {
    await db.query(
      "INSERT INTO liekan_collection_policy(website_id,mode,allowed_hostnames) VALUES($1,'raw','{}')",
      [website],
    );
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM liekan_effective_browser_event')).rows[0].n,
      3,
    );
  });
  await test('event environment never inherits previously mixed session device identity', async () => {
    assert.equal(
      (
        await db.query(
          'SELECT liekan_browser,liekan_identity_available FROM liekan_geographic_website_event WHERE event_id=$1',
          [browser],
        )
      ).rows[0].liekan_browser,
      null,
    );
    await db.query(
      `INSERT INTO liekan_event_environment(event_id,website_id,scope,identity_version,identity_available,browser,origin_hostname)
      VALUES($1,$2,'browser','cookieless-trusted-input-v2',true,'Chrome','example.test')`,
      [browser, website],
    );
    const row = (
      await db.query(
        'SELECT liekan_browser,liekan_identity_available FROM liekan_geographic_website_event WHERE event_id=$1',
        [browser],
      )
    ).rows[0];
    assert.equal(row.liekan_browser, 'Chrome');
    assert.equal(row.liekan_identity_available, true);
  });
  await test('Origin conflict follows configured hosts and absent Origin keeps compatibility', async () => {
    await db.query(
      "UPDATE liekan_collection_policy SET allowed_hostnames=ARRAY['example.test'] WHERE website_id=$1",
      [website],
    );
    await db.query(
      "UPDATE liekan_event_environment SET origin_hostname='other.test' WHERE event_id=$1",
      [browser],
    );
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int n FROM liekan_effective_browser_event WHERE event_id=$1',
          [browser],
        )
      ).rows[0].n,
      0,
    );
    await db.query('UPDATE liekan_event_environment SET origin_hostname=NULL WHERE event_id=$1', [
      browser,
    ]);
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int n FROM liekan_effective_browser_event WHERE event_id=$1',
          [browser],
        )
      ).rows[0].n,
      1,
    );
  });
  const { actOnTrafficExclusion } = await import(
    '../../src/lib/liekan/upstream/traffic-exclusions'
  );
  prisma = (await import('../../src/lib/prisma')).default;
  const windowEnd = new Date(Math.floor((Date.now() - 600000) / 60000) * 60000);
  for (let i = 0; i < 40; i++)
    await add(1, 'browser', 'browser', website, new Date(+windowEnd - 200000 + i * 4000));
  await db.query(
    `INSERT INTO liekan_browser_risk_window(website_id,window_end,epoch,rule_version,coverage,events,visits,insufficient,flagged)
    VALUES($1,$2,1,'browser-behavior-v1','observed',40,1,0,1)`,
    [website, windowEnd],
  );
  await db.query(
    `INSERT INTO liekan_browser_risk(website_id,window_end,session_id,visit_id,reasons,features)
    VALUES($1,$2,$3,$4,ARRAY['regular-timing','repeated-path'],'{}')`,
    [website, windowEnd, session, visit],
  );
  const preview = (revision: string) =>
    actOnTrafficExclusion(
      website,
      {
        action: 'preview',
        expectedRevision: revision,
        windowEnd: windowEnd.toISOString(),
        visits: [{ sessionId: session, visitId: visit }],
      },
      { userId: owner },
    ) as Promise<any>;
  const confirm = (p: any) =>
    actOnTrafficExclusion(
      website,
      { action: 'confirm', expectedRevision: p.revision, previewId: p.id, digest: p.digest },
      { userId: owner },
    );
  let first: any, second: any;
  await test('preview rejects candidates outside current browser host policy', async () => {
    await db.query(
      "UPDATE liekan_collection_policy SET allowed_hostnames=ARRAY['other.test'] WHERE website_id=$1",
      [website],
    );
    await assert.rejects(
      () => preview('0'),
      (e: any) => e.status === 409,
    );
    await db.query(
      "UPDATE liekan_collection_policy SET allowed_hostnames=ARRAY['example.test'] WHERE website_id=$1",
      [website],
    );
  });
  await test('unresolved identities cannot become visit-derived behavioral exclusions', async () => {
    await assert.rejects(
      () => preview('0'),
      (e: any) => e.status === 409,
    );
    assert.equal(
      (
        await db.query('SELECT count(*)::int n FROM liekan_traffic_exclusion WHERE website_id=$1', [
          website,
        ])
      ).rows[0].n,
      0,
    );
    // Subsequent governance cases model proven inputs; this proof is confined to the synthetic window.
    await db.query(
      `INSERT INTO liekan_event_environment(event_id,website_id,scope,identity_version,identity_available)
      SELECT e.event_id,e.website_id,'browser','cookieless-trusted-input-v2',true FROM website_event e
      JOIN liekan_event_quality q ON q.event_id=e.event_id WHERE e.website_id=$1 AND q.created_at>$2::timestamptz-interval '5 minutes' AND q.created_at<=$2`,
      [website, windowEnd],
    );
  });
  await test('preview freezes 40 explicit events and leaves metrics unchanged', async () => {
    first = await preview('0');
    assert.equal(first.evidence.events, 40);
    assert.equal(
      (await db.query('SELECT count(*)::int n FROM liekan_effective_browser_event')).rows[0].n,
      43,
    );
  });
  await test('confirmation changes population and governance/cache revisions atomically', async () => {
    await confirm(first);
    assert.equal(
      (await db.query('SELECT count(*)::int n FROM liekan_effective_browser_event')).rows[0].n,
      3,
    );
    assert.equal(
      (
        await db.query('SELECT revision::text FROM liekan_traffic_governance WHERE website_id=$1', [
          website,
        ])
      ).rows[0].revision,
      '1',
    );
  });
  await test('overlapping sets do not multiply rows and each revocation preserves the other set', async () => {
    second = await preview('1');
    await confirm(second);
    await actOnTrafficExclusion(
      website,
      { action: 'revoke', expectedRevision: '2', collectionId: first.id },
      { userId: owner },
    );
    assert.equal(
      (await db.query('SELECT count(*)::int n FROM liekan_effective_browser_event')).rows[0].n,
      3,
    );
    await actOnTrafficExclusion(
      website,
      { action: 'revoke', expectedRevision: '3', collectionId: second.id },
      { userId: owner },
    );
    assert.equal(
      (await db.query('SELECT count(*)::int n FROM liekan_effective_browser_event')).rows[0].n,
      43,
    );
  });
  await test('changed policy and expired preview require another preview', async () => {
    const p = await preview('4');
    await db.query('UPDATE liekan_collection_policy SET revision=revision+1 WHERE website_id=$1', [
      website,
    ]);
    await assert.rejects(
      () => confirm(p),
      (e: any) => e.status === 409,
    );
    const expired = await preview('4');
    await db.query(
      "UPDATE liekan_traffic_exclusion SET expires_at=now()-interval '1 second' WHERE id=$1",
      [expired.id],
    );
    await assert.rejects(
      () => confirm(expired),
      (e: any) => e.status === 409,
    );
  });
  await test('partial windows cannot become confirmed exclusions', async () => {
    await db.query("UPDATE liekan_browser_risk_window SET coverage='partial' WHERE website_id=$1", [
      website,
    ]);
    await assert.rejects(
      () => preview('4'),
      (e: any) => e.status === 409,
    );
    await db.query(
      "UPDATE liekan_browser_risk_window SET coverage='observed' WHERE website_id=$1",
      [website],
    );
  });
  await test('permission loss and epoch changes prevent confirmation', async () => {
    const p = await preview('4');
    await db.query('UPDATE "user" SET deleted_at=now() WHERE user_id=$1', [owner]);
    await assert.rejects(
      () => confirm(p),
      (e: any) => e.status === 401,
    );
    await db.query('UPDATE "user" SET deleted_at=NULL WHERE user_id=$1', [owner]);
    await db.query('INSERT INTO liekan_log_state(website_id,epoch) VALUES($1,2)', [website]);
    await assert.rejects(
      () => confirm(p),
      (e: any) => e.status === 409,
    );
  });
  await test('over-budget complete claims are rejected before creating a preview', async () => {
    await db.query('UPDATE liekan_log_state SET epoch=1 WHERE website_id=$1', [website]);
    await db.query(
      `WITH extra AS (
      INSERT INTO website_event(event_id,website_id,session_id,visit_id,event_type,url_path,created_at)
      SELECT gen_random_uuid(),$1,$2,$3,1,'/budget',$4 FROM generate_series(1,10001) RETURNING event_id,website_id,created_at
    ) INSERT INTO liekan_event_quality(event_id,website_id,classification,source,reasons,rule_version,range_status,created_at)
      SELECT event_id,website_id,'browser','browser','{}','traffic-quality-v4','missing',created_at FROM extra`,
      [website, session, visit, new Date(+windowEnd - 1000)],
    );
    await assert.rejects(
      () => preview('4'),
      (e: any) => e.status === 413,
    );
    await db.query("DELETE FROM website_event WHERE website_id=$1 AND url_path='/budget'", [
      website,
    ]);
  });
  await test('late events invalidate a pending preview and never join an active collection', async () => {
    const p = await preview('4');
    const late = await add(1, 'browser', 'browser', website, new Date(+windowEnd - 2000));
    await assert.rejects(
      () => confirm(p),
      (e: any) => e.status === 409,
    );
    await db.query(
      `INSERT INTO liekan_event_environment(event_id,website_id,scope,identity_version,identity_available) VALUES($1,$2,'browser','cookieless-trusted-input-v2',true)`,
      [late, website],
    );
    const fresh = await preview('4');
    await confirm(fresh);
    const newer = await add(1, 'browser', 'browser', website, new Date(+windowEnd - 1000));
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int n FROM liekan_effective_browser_event WHERE event_id=$1',
          [newer],
        )
      ).rows[0].n,
      1,
    );
    await db.query('DELETE FROM liekan_browser_risk_window WHERE website_id=$1', [website]);
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int n FROM liekan_effective_browser_event WHERE event_id=$1',
          [late],
        )
      ).rows[0].n,
      0,
    );
  });
  const { withCollectionWrite, recordCollectionIdentity } = await import(
    '../../src/lib/liekan/upstream/collection-write'
  );
  const { createSession } = await import('../../src/queries/sql/sessions/createSession');
  const { saveSessionData } = await import('../../src/queries/sql/sessions/saveSessionData');
  const { saveSessionLink } = await import('../../src/queries/sql/sessions/saveSessionLink');
  const { saveEvent } = await import('../../src/queries/sql/events/saveEvent');
  const input: any = {
    websiteId: website,
    eventId: randomUUID(),
    fingerprint: 'atomic-fixture',
    quality: {
      source: 'browser',
      classification: 'browser',
      reasons: [],
      ruleVersion: 'traffic-quality-v4',
      rangeStatus: 'missing',
      rangeVersion: null,
      hostname: 'example.test',
    },
    identity: {
      hostname: 'example.test',
      classification: 'browser',
      scope: 'browser',
      available: true,
      version: 'cookieless-trusted-input-v2',
      sessionId: randomUUID(),
      browser: 'Chrome',
      os: null,
      device: null,
      screen: null,
      language: null,
      originHostname: null,
      distinctId: 'safe-browser',
    },
  };
  const write = async () => {
    await createSession({
      id: input.identity.sessionId,
      websiteId: website,
      browser: 'Chrome',
      createdAt: new Date(),
    });
    await recordCollectionIdentity(website, input.identity);
    await saveSessionData({
      websiteId: website,
      sessionId: input.identity.sessionId,
      sessionData: { plan: 'browser' },
      createdAt: new Date(),
    });
    await saveSessionLink({
      websiteId: website,
      sessionId: input.identity.sessionId,
      distinctId: 'safe-browser',
      createdAt: new Date(),
    });
    await saveEvent({
      websiteId: website,
      sessionId: input.identity.sessionId,
      visitId: randomUUID(),
      eventType: 1,
      urlPath: '/atomic',
      createdAt: new Date(),
    });
  };
  await test('environment failure rolls back session, properties, identity links, event and receipt', async () => {
    await db.query(
      `CREATE FUNCTION reject_test_environment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture environment failure'; END $$`,
    );
    await db.query(
      'CREATE TRIGGER reject_test_environment BEFORE INSERT ON liekan_event_environment FOR EACH ROW EXECUTE FUNCTION reject_test_environment()',
    );
    await assert.rejects(() => withCollectionWrite(input, write));
    for (const table of [
      'session',
      'session_data',
      'session_link',
      'liekan_session_source',
      'liekan_session_data_source',
      'liekan_session_link_source',
    ])
      assert.equal(
        (
          await db.query(`SELECT count(*)::int n FROM ${table} WHERE session_id=$1`, [
            input.identity.sessionId,
          ])
        ).rows[0].n,
        0,
      );
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int n FROM liekan_collection_receipt WHERE client_event_id=$1',
          [input.eventId],
        )
      ).rows[0].n,
      0,
    );
    await db.query('DROP TRIGGER reject_test_environment ON liekan_event_environment');
  });
  await test('concurrent same-scope retries commit one complete source-bound collection', async () => {
    const results = await Promise.all([
      withCollectionWrite(input, write),
      withCollectionWrite(input, write),
    ]);
    assert.deepEqual(results.map(r => r.status).sort(), ['duplicate', 'written']);
    for (const table of [
      'session',
      'session_data',
      'session_link',
      'liekan_session_source',
      'liekan_session_data_source',
      'liekan_session_link_source',
    ])
      assert.equal(
        (
          await db.query(`SELECT count(*)::int n FROM ${table} WHERE session_id=$1`, [
            input.identity.sessionId,
          ])
        ).rows[0].n,
        1,
      );
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int n FROM liekan_event_environment WHERE website_id=$1 AND distinct_id=$2',
          [website, 'safe-browser'],
        )
      ).rows[0].n,
      1,
    );
  });
  await test('same UUID and payload cannot cross internal collection scopes', async () => {
    let called = false;
    await assert.rejects(() =>
      withCollectionWrite(
        { ...input, identity: { ...input.identity, scope: 'browser_automated' } },
        async () => {
          called = true;
        },
      ),
    );
    assert.equal(called, false);
  });
  await test('historical property evidence stays unknown while newly proven keys are readable', async () => {
    const oldKey = randomUUID();
    await db.query(
      "INSERT INTO session_data(session_data_id,website_id,session_id,data_key,string_value,data_type) VALUES($1,$2,$3,'old-key','unsafe-old-value',1)",
      [oldKey, website, input.identity.sessionId],
    );
    const visible = await db.query(
      'SELECT data_key FROM liekan_effective_session_data WHERE session_id=$1',
      [input.identity.sessionId],
    );
    assert.deepEqual(
      visible.rows.map(r => r.data_key),
      ['plan'],
    );
  });
  await test('an old writer cannot retain proof for changed property data', async () => {
    await db.query(
      "UPDATE session_data SET string_value='old-collector' WHERE session_id=$1 AND data_key='plan'",
      [input.identity.sessionId],
    );
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int n FROM liekan_effective_session_data WHERE session_id=$1',
          [input.identity.sessionId],
        )
      ).rows[0].n,
      0,
    );
    await withCollectionWrite({ ...input, eventId: undefined }, async () =>
      saveSessionData({
        websiteId: website,
        sessionId: input.identity.sessionId,
        sessionData: { plan: 'browser' },
        createdAt: new Date(),
      }),
    );
    assert.equal(
      (
        await db.query(
          'SELECT string_value FROM liekan_effective_session_data WHERE session_id=$1',
          [input.identity.sessionId],
        )
      ).rows[0].string_value,
      'browser',
    );
    await db.query(
      "UPDATE session_data SET distinct_id='old-collector' WHERE session_id=$1 AND data_key='plan'",
      [input.identity.sessionId],
    );
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int n FROM liekan_effective_session_data WHERE session_id=$1',
          [input.identity.sessionId],
        )
      ).rows[0].n,
      0,
    );
  });
  await test('collection admission conflicts roll back before session or properties can change', async () => {
    let called = false;
    await assert.rejects(() =>
      withCollectionWrite(
        { ...input, eventId: undefined, expectedPolicyRevision: '999' },
        async () => {
          called = true;
        },
      ),
    );
    assert.equal(called, false);
  });
  const { readBrowserPopulation } = await import(
    '../../src/lib/liekan/upstream/browser-population'
  );
  const { withinQuerySnapshot } = await import('../../src/lib/liekan/upstream/query-snapshot');
  const { getWebsiteStats } = await import('../../src/queries/sql/getWebsiteStats');
  const { getWebsiteSessions } = await import('../../src/queries/sql/sessions/getWebsiteSessions');
  const executor = {
    $queryRawUnsafe: async (sql: string, ...values: any[]) => (await db.query(sql, values)).rows,
    $executeRawUnsafe: async (sql: string, ...values: any[]) =>
      (await db.query(sql, values)).rowCount,
  };
  const range = {
    startDate: new Date('2020-01-01Z'),
    endDate: new Date('2020-01-04Z'),
    timezone: 'UTC',
  };
  const old = await add(1, 'browser', 'browser', website, new Date('2020-01-02Z'));
  const fresh = await add(1, 'browser', 'browser', website, new Date('2020-01-03Z'));
  await db.query(
    `INSERT INTO liekan_event_environment(event_id,website_id,scope,identity_version,identity_available,browser)
    VALUES($1,$2,'browser','cookieless-trusted-input-v2',true,'Chrome')`,
    [fresh, website],
  );
  await test('partial identity keeps PV and suppresses totals while exposing qualified UV', async () => {
    const population = await readBrowserPopulation(
      website,
      range.startDate,
      range.endDate,
      'UTC',
      executor,
    );
    assert.equal(population.identity.status, 'partial');
    assert.equal(population.identity.eligiblePV, 2);
    assert.equal(population.identity.qualifiedPV, 1);
    assert.equal(population.identity.qualifiedVisitors, 1);
    assert.equal(population.identity.coverage, 0.5);
    const stats: any = await withinQuerySnapshot({ ...executor }, () =>
      getWebsiteStats(website, range),
    );
    assert.equal(Number(stats.pageviews), 2);
    assert.equal(stats.visitors, null);
    assert.equal(stats.visits, null);
    const { browserRiskReport } = await import('../../src/lib/liekan/upstream/browser-risk');
    const risk: any = await browserRiskReport(
      website,
      new URLSearchParams({
        startAt: String(+range.startDate),
        endAt: String(+range.endDate),
        timezone: 'UTC',
      }),
    );
    assert.equal(risk.impact.includedUV, null);
    assert.equal(risk.impact.fullyExcludedUV, null);
    assert.equal(risk.impact.includedPV, 2);
  });
  await db.query(
    `INSERT INTO liekan_event_environment(event_id,website_id,scope,identity_version,identity_available,browser)
    VALUES($1,$2,'browser','cookieless-trusted-input-v2',true,'Firefox')`,
    [old, website],
  );
  await test('native session list keeps one row per visitor and stable environment field names', async () => {
    const sessions: any = await withinQuerySnapshot({ ...executor }, () =>
      getWebsiteSessions(website, range),
    );
    assert.equal(sessions.count, 1);
    assert.equal(sessions.data.length, 1);
    assert.equal(sessions.data[0].browser, 'Chrome');
    assert.equal(Number(sessions.data[0].views), 2);
    assert.equal('liekan_browser' in sessions.data[0], false);
    const stats: any = await withinQuerySnapshot({ ...executor }, () =>
      getWebsiteStats(website, range),
    );
    assert.equal(Number(stats.visitors), 1);
    assert.equal(Number(stats.pageviews), 2);
  });
  await test('human and keyword visit facts retain environment column names after policy rewriting', async () => {
    const { humanVisitsSql } = await import('../../src/lib/liekan/upstream/analytics');
    const { withTrafficPolicy } = await import('../../src/lib/liekan/upstream/traffic-query');
    for (const keywords of [false, true]) {
      const { rows } = await db.query(
        withTrafficPolicy(humanVisitsSql(keywords) + ' SELECT browser,os,device,pv FROM visits'),
        [website, range.startDate, range.endDate, 'UTC'],
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].browser, 'Firefox');
      assert.equal(rows[0].os, null);
      assert.equal(rows[0].device, null);
      assert.equal(rows[0].pv, 2);
    }
  });
  await test('audit pageview buckets reconcile exactly with raw pageviews', async () => {
    const { trafficQualityAudit } = await import('../../src/lib/liekan/upstream/traffic-quality');
    const { trafficAuditSchema } = await import('../../src/lib/liekan/contracts/traffic-quality');
    const end = Date.now() + 60000,
      start = end - 86400000;
    const audit: any = await trafficQualityAudit(
      website,
      new URLSearchParams({ startAt: String(start), endAt: String(end), timezone: 'UTC' }),
    );
    trafficAuditSchema.parse(JSON.parse(JSON.stringify(audit)));
    assert.ok(audit.partition.length > 1);
    assert.equal(
      audit.partition.reduce((sum: number, b: any) => sum + b.pageviews, 0),
      audit.totals.rawPV,
    );
    assert.equal(
      audit.partition.find((b: any) => b.bucket === 'included').pageviews,
      audit.totals.includedPV,
    );
  });
  await test('raw and eligible observations use the configured non-public database schema', async () => {
    const { aiTransaction } = await import('../../src/lib/liekan/upstream/ai-db');
    const { readObservations, parseObservationQuery } = await import(
      '../../src/lib/liekan/crawlers/observation-read'
    );
    const endAt = Date.now();
    const conditions = parseObservationQuery({
      startAt: endAt - 86400000,
      endAt,
      timezone: 'UTC',
      subset: 'raw',
    });
    const input: any = { baseline: { epoch: '0' } };
    const [raw, eligible] = await aiTransaction(async tx => [
      await readObservations(tx, website, conditions, input),
      await readObservations(tx, website, { ...conditions, subset: 'eligible' }, input),
    ]);
    assert.ok(
      'pv' in raw.totals && typeof raw.totals.pv === 'number' && raw.totals.pv > 0,
      'the owned schema contains received public pageviews',
    );
    assert.ok(
      'pv' in eligible.totals && typeof eligible.totals.pv === 'number' && eligible.totals.pv > 0,
      'the owned schema contains eligible public pageviews',
    );
    assert.ok(raw.totals.pv > eligible.totals.pv, 'excluded events remain in raw observations');
    assert.equal(raw.meta.observationIdentity.totalPV, raw.totals.pv);
    assert.equal(eligible.meta.observationIdentity.totalPV, eligible.totals.pv);
  });
  await test('governance pages retain older active collections and reject stale cursors', async () => {
    const { trafficGovernanceState } = await import(
      '../../src/lib/liekan/upstream/traffic-exclusions'
    );
    await db.query(
      `INSERT INTO liekan_traffic_exclusion(id,website_id,epoch,actor_id,state,base_revision,policy_revision,rule_version,catalog_version,history_generation,history_revision,window_end,received_cutoff,membership_digest,evidence,expires_at,created_at)
      SELECT gen_random_uuid(),website_id,epoch,actor_id,'revoked',base_revision,policy_revision,rule_version,catalog_version,history_generation,history_revision,window_end,received_cutoff,membership_digest,evidence,expires_at,clock_timestamp()+i*interval '1 microsecond'
      FROM liekan_traffic_exclusion CROSS JOIN generate_series(1,105) i WHERE id=$1`,
      [first.id],
    );
    const firstPage = await trafficGovernanceState(executor, website);
    assert.equal(firstPage.collections.length, 100);
    assert.ok(firstPage.nextCursor);
    const secondPage = await trafficGovernanceState(executor, website, firstPage.nextCursor);
    const ids = [...firstPage.collections, ...secondPage.collections].map(row => row.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.includes(first.id));
    assert.equal(secondPage.nextCursor, null);
    assert.equal(
      ids.length,
      (
        await db.query(
          "SELECT count(*)::int n FROM liekan_traffic_exclusion WHERE website_id=$1 AND state IN('active','revoked')",
          [website],
        )
      ).rows[0].n,
    );
    await db.query('UPDATE liekan_traffic_governance SET revision=revision+1 WHERE website_id=$1', [
      website,
    ]);
    await assert.rejects(
      () => trafficGovernanceState(executor, website, firstPage.nextCursor),
      (e: any) => e.status === 409,
    );
  });
  console.log(`${passed} integration cases passed`);
} finally {
  if (prisma) await prisma.client.$disconnect();
  await db.query(`DROP SCHEMA "${schema}" CASCADE`);
  await db.end();
}
