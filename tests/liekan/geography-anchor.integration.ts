import { withCollectionWrite } from '../../src/lib/liekan/upstream/collection-write';
import { saveEvent } from '../../src/queries/sql/events/saveEvent';
import prisma from '../../src/lib/prisma';
import { getWebsiteSessions } from '../../src/queries/sql/sessions/getWebsiteSessions';
import { getWebsiteSession } from '../../src/queries/sql/sessions/getWebsiteSession';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { withTrafficPolicy } from '../../src/lib/liekan/upstream/traffic-query';
import { humanVisitsSql } from '../../src/lib/liekan/upstream/analytics';
const db = new Client({ connectionString: process.env.DATABASE_URL });
if (!new URL(process.env.DATABASE_URL).pathname.endsWith('/liekan_geo_test'))
  throw new Error('Use the isolated geography test database');
await db.connect();
const site = randomUUID(),
  session = randomUUID(),
  visit = randomUUID(),
  legacyVisit = randomUUID();
const uuid = () => randomUUID();
const check = (ok: boolean, label: string) => {
  if (!ok) throw new Error(label);
  console.log(`PASS ${label}`);
};
try {
  await db.query('BEGIN');
  await db.query(
    "INSERT INTO website(website_id,name,domain) VALUES($1,'Geography fixture','example.test')",
    [site],
  );
  await db.query(
    "INSERT INTO session(session_id,website_id,country,region,city) VALUES($1,$2,'CN','CN-SD','Jinan')",
    [session, site],
  );
  const add = async (
    time: string,
    visitId: string,
    location?: { country: string; region?: string; city?: string },
    automated = false,
  ) => {
    const id = uuid();
    await db.query(
      "INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,event_type,url_path) VALUES($1,$2,$3,$4,$5,1,'/fixture')",
      [id, site, session, visitId, time],
    );
    if (location)
      await db.query(
        `INSERT INTO liekan_event_geography(event_id,website_id,country,region,city,source,trust,ip_family,precision,reason,rule_version,data_version,country_basis,processed_at) VALUES($1,$2,$3,$4,$5,'fixture','authenticated_server','ipv4',$6,'fixture','fixture','fixture','located',now())`,
        [
          id,
          site,
          location.country,
          location.region || null,
          location.city || null,
          location.city ? 'city' : location.region ? 'province' : 'country',
        ],
      );
    if (automated)
      await db.query(
        `INSERT INTO liekan_event_quality(event_id,website_id,classification,source,reasons,rule_version,range_status) VALUES($1,$2,'automated','authenticated_server','{}','fixture','missing')`,
        [id, site],
      );
    return id;
  };
  await add('2026-10-13T10:00:00Z', visit, { country: 'CN', region: 'CN-44', city: 'Guangzhou' });
  await add('2026-10-14T10:00:00Z', visit, { country: 'CN', region: 'CN-11', city: 'Beijing' });
  const read = async (start = '2026-10-14T00:00:00Z') =>
    (
      await db.query(
        withTrafficPolicy(`${humanVisitsSql()} SELECT country,region,city,pv FROM visits`),
        [site, new Date(start), new Date('2026-10-14T23:59:59Z'), 'UTC'],
      )
    ).rows;
  check((await read())[0].city === 'Guangzhou', 'cross-day window keeps the same first-PV tuple');
  await add('2026-10-12T10:00:00Z', visit, { country: 'CN' });
  check(
    (await read())[0].city === null && (await read())[0].region === null,
    'late earlier event changes the whole anchor without mixing fields',
  );
  await add(
    '2026-10-11T10:00:00Z',
    visit,
    { country: 'US', region: 'US-CA', city: 'Mountain View' },
    true,
  );
  check((await read())[0].country === 'CN', 'standard policy excludes automated anchor');
  await db.query(`INSERT INTO liekan_collection_policy(website_id,mode) VALUES($1,'raw')`, [site]);
  check(
    (await read())[0].country === 'US',
    'raw policy selects the same eligible population for geography',
  );
  await db.query('DELETE FROM liekan_collection_policy WHERE website_id=$1', [site]);
  await add('2026-10-13T09:00:00Z', legacyVisit);
  await add('2026-10-14T09:00:00Z', legacyVisit, {
    country: 'CN',
    region: 'CN-44',
    city: 'Guangzhou',
  });
  const facts = await read();
  check(
    facts.length === 2 && facts.some(r => r.city === 'Jinan'),
    'legacy-started visit retains session geography',
  );
  check(
    facts.reduce((n, r) => n + Number(r.pv), 0) === 2,
    'each visit appears once and PV totals stay intact',
  );
  const rows = (
    await db.query(
      withTrafficPolicy(
        "SELECT s.city AS city FROM website_event e JOIN session s ON s.session_id=e.session_id WHERE e.website_id=$1 AND e.created_at='2026-10-14T10:00:00Z' AND s.city IS NULL",
      ),
      [site],
    )
  ).rows;
  check(rows.length === 1, 'geography filters use the same missing-city anchor');
  await db.query('COMMIT');
  const summaries = await getWebsiteSessions(site, {
    startDate: new Date('2026-10-14T00:00:00Z'),
    endDate: new Date('2026-10-14T23:59:59Z'),
    page: 1,
    pageSize: 25,
  });
  check(
    summaries.data.length === 1 &&
      Number(summaries.data[0].visits) === 2 &&
      summaries.data[0].city === null,
    'one visitor summary preserves all visits and the latest complete tuple',
  );
  const detail = await getWebsiteSession(site, session);
  check(
    Number(detail.visits) === 2 && Number(detail.views) === 5 && detail.city === null,
    'visitor detail keeps complete totals across changing visit geographies',
  );
  const geo: any = {
    location: { country: 'CN', region: 'CN-31', city: 'Shanghai' },
    source: 'fixture',
    trust: 'authenticated_server',
    ipFamily: 'ipv4',
    precision: 'city',
    reason: 'fixture',
    ruleVersion: 'fixture',
    dataVersion: 'fixture',
    cityId: null,
    accuracyRadius: null,
    countryBasis: 'located',
    processedAt: new Date().toISOString(),
    shadow: null,
  };
  const clientEventId = uuid();
  const collection = {
    websiteId: site,
    eventId: clientEventId,
    fingerprint: 'fixture-atomic',
    geography: geo,
  };
  const save = () =>
    saveEvent({
      websiteId: site,
      sessionId: session,
      visitId: uuid(),
      eventType: 1,
      urlPath: '/atomic-fixture',
      createdAt: new Date('2026-10-10T00:00:00Z'),
    });
  const written = await withCollectionWrite(collection, save);
  const duplicate = await withCollectionWrite(collection, save);
  check(
    written.status === 'written' && duplicate.status === 'duplicate',
    'real atomic collection links geography and UUID receipt exactly once',
  );
  const revision = (
    await db.query('SELECT revision FROM liekan_analytics_revision WHERE resource_id=$1', [site])
  ).rows;
  check(
    Number(revision[0]?.revision) > 0,
    'late geography evidence advances the statistics revision atomically',
  );
  let failed = false;
  try {
    await withCollectionWrite(
      { ...collection, eventId: uuid(), geography: { ...geo, location: { country: 'BAD' } } },
      save,
    );
  } catch {
    failed = true;
  }
  const orphaned = (
    await db.query(
      "SELECT count(*)::int AS count FROM website_event WHERE website_id=$1 AND url_path='/atomic-fixture'",
      [site],
    )
  ).rows[0].count;
  check(
    failed && orphaned === 1,
    'real geography storage failure rolls back its event and receipt',
  );
} finally {
  await db.query('ROLLBACK').catch(() => {});
  await db.query('DELETE FROM website_event WHERE website_id=$1', [site]);
  await db.query('DELETE FROM session WHERE website_id=$1', [site]);
  await db.query('DELETE FROM website WHERE website_id=$1', [site]);
  await db.end();
  await prisma.client.$disconnect();
}
