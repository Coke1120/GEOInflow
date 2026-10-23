import assert from 'node:assert/strict';
import type pg from 'pg';

export const benchmarkIpHeader = 'x-liekan-benchmark-ip';
export const benchmarkIdentityVersion = 'synthetic-benchmark-identity-v1';
export const benchmarkBrowserHeaders = {
  'Content-Type': 'application/json',
  [benchmarkIpHeader]: '192.0.2.201',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};

/** The seed registry exists only on this invocation's disposable database connection. */
export async function assertBenchmarkSites(db: pg.Client, sites: string[]) {
  assert(sites.length > 0 && new Set(sites).size === sites.length);
  const registry = await db.query("SELECT to_regclass('pg_temp.benchmark_sessions') AS registry");
  assert(registry.rows[0].registry, 'Benchmark fixture ownership registry is missing');
  const owned = await db.query(
    `SELECT count(DISTINCT b.website_id)::int AS count FROM pg_temp.benchmark_sessions b
     JOIN website w ON w.website_id=b.website_id AND w.deleted_at IS NULL
     JOIN liekan_setting setting ON setting.website_id=w.website_id AND setting.is_demo
     WHERE b.website_id=ANY($1::uuid[])`,
    [sites],
  );
  assert.equal(owned.rows[0].count, sites.length, 'Benchmark fixture website ownership mismatch');
}

/** Explicit synthetic browser evidence for the generated benchmark population. */
export async function seedBenchmarkBrowserEvidence(
  db: pg.Client,
  sites: string[],
  eventIds?: string[],
) {
  await assertBenchmarkSites(db, sites);
  await db.query('BEGIN');
  try {
    await db.query(
      `INSERT INTO liekan_event_quality(event_id,website_id,classification,source,reasons,rule_version,range_status,hostname,created_at)
     SELECT event_id,website_id,'browser','browser','{synthetic-benchmark}','synthetic-benchmark-quality-v1','untrusted',hostname,date_trunc('minute',now())-interval '3 minutes'
     FROM website_event WHERE website_id=ANY($1::uuid[]) AND url_path LIKE '/synthetic/%'
       AND ($2::uuid[] IS NULL OR event_id=ANY($2::uuid[])) ON CONFLICT DO NOTHING`,
      [sites, eventIds ?? null],
    );
    await db.query(
      `INSERT INTO liekan_session_source(website_id,session_id,source,scope,identity_version,identity_available)
     SELECT DISTINCT e.website_id,e.session_id,'browser','browser',$3,true FROM website_event e
     WHERE e.website_id=ANY($1::uuid[]) AND e.url_path LIKE '/synthetic/%'
       AND ($2::uuid[] IS NULL OR e.event_id=ANY($2::uuid[])) ON CONFLICT DO NOTHING`,
      [sites, eventIds ?? null, benchmarkIdentityVersion],
    );
    await db.query(
      `INSERT INTO liekan_event_environment(event_id,website_id,scope,identity_version,identity_available,browser,os,device,screen,language,distinct_id)
     SELECT e.event_id,e.website_id,'browser',$3,true,s.browser,s.os,s.device,s.screen,s.language,s.distinct_id
     FROM website_event e JOIN session s ON s.session_id=e.session_id AND s.website_id=e.website_id
     WHERE e.website_id=ANY($1::uuid[]) AND e.url_path LIKE '/synthetic/%'
       AND ($2::uuid[] IS NULL OR e.event_id=ANY($2::uuid[])) ON CONFLICT DO NOTHING`,
      [sites, eventIds ?? null, benchmarkIdentityVersion],
    );
    if (!eventIds) await refreshBenchmarkPropertyEvidence(db, sites);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

export async function refreshBenchmarkPropertyEvidence(db: pg.Client, sites: string[]) {
  await assertBenchmarkSites(db, sites);
  await db.query(
    `INSERT INTO liekan_session_data_source(website_id,session_id,data_key,scope,hostname,classification,row_digest)
     SELECT d.website_id,d.session_id,d.data_key,'browser',w.domain,'browser',liekan_session_data_digest(d)
     FROM session_data d JOIN website w ON w.website_id=d.website_id
     JOIN liekan_session_source src ON src.website_id=d.website_id AND src.session_id=d.session_id AND src.identity_version=$2
     WHERE d.website_id=ANY($1::uuid[])
     ON CONFLICT(website_id,session_id,data_key) DO UPDATE SET row_digest=EXCLUDED.row_digest`,
    [sites, benchmarkIdentityVersion],
  );
}

export async function updateBenchmarkBrowser(
  db: pg.Client,
  site: string,
  session: string,
  browser: string,
) {
  await assertBenchmarkSites(db, [site]);
  await db.query(
    `UPDATE liekan_event_environment env SET browser=$1 FROM website_event e
     WHERE e.event_id=env.event_id AND e.website_id=env.website_id AND e.session_id=$2
       AND e.website_id=$3 AND env.identity_version=$4`,
    [browser, session, site, benchmarkIdentityVersion],
  );
}
