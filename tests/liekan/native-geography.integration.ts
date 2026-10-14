import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import prisma from '../../src/lib/prisma';
import { getSessionMetrics } from '../../src/queries/sql/sessions/getSessionMetrics';
import { getSessionExpandedMetrics } from '../../src/queries/sql/sessions/getSessionExpandedMetrics';
import { getBreakdown } from '../../src/queries/sql/breakdown/getBreakdown';
import { getValues } from '../../src/queries/sql/getValues';
import { getRevenueMetrics } from '../../src/queries/sql/revenue/getRevenueMetrics';
import { resetLiekanStatistics, stopWebsiteSources } from '../../src/lib/liekan/upstream/lifecycle';
import { primary, reportSnapshot, query } from '../../src/lib/liekan/upstream/server';

if (!new URL(process.env.DATABASE_URL).pathname.endsWith('/liekan_geo_test'))
  throw new Error('Use the isolated geography test database');
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const site = randomUUID(),
  session = randomUUID();
const filters = {
  startDate: new Date('2026-10-14T00:00:00Z'),
  endDate: new Date('2026-10-14T23:59:59Z'),
};
const failed: string[] = [];
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed.push(name);
};
try {
  await db.query(
    "INSERT INTO website(website_id,name,domain) VALUES($1,'Native geography fixture','example.test')",
    [site],
  );
  await db.query(
    "INSERT INTO session(session_id,website_id,country,region,city,created_at) VALUES($1,$2,'US','US-CA','Mountain View','2026-10-01')",
    [session, site],
  );
  for (const [region, city] of [
    ['CN-44', 'Guangzhou'],
    ['CN-11', 'Beijing'],
  ]) {
    const event = randomUUID(),
      visit = randomUUID();
    for (const [id, time] of [
      [randomUUID(), '2026-10-13T10:00:00Z'],
      [event, '2026-10-14T10:00:00Z'],
    ]) {
      await db.query(
        "INSERT INTO website_event(event_id,website_id,session_id,visit_id,event_type,url_path,created_at) VALUES($1,$2,$3,$4,1,'/native-fixture',$5)",
        [id, site, session, visit, time],
      );
      await db.query(
        "INSERT INTO liekan_event_geography(event_id,website_id,country,region,city,source,trust,ip_family,precision,reason,rule_version,country_basis,processed_at) VALUES($1,$2,'CN',$3,$4,'fixture','authenticated_server','ipv4','city','fixture','fixture','located',now())",
        [id, site, region, city],
      );
      if (id === event)
        await db.query(
          "INSERT INTO revenue(revenue_id,website_id,session_id,event_id,event_name,currency,revenue,created_at) VALUES($1,$2,$3,$4,'fixture','USD',100,$5)",
          [randomUUID(), site, session, event, time],
        );
    }
  }
  for (const [type, values] of [
    ['country', ['CN']],
    ['region', ['CN-44', 'CN-11']],
    ['city', ['Guangzhou', 'Beijing']],
  ] as const) {
    const rows = await getSessionMetrics(site, { type }, { ...filters, country: 'eq.CN' });
    check(
      rows.length === values.length &&
        rows.every(row => values.includes(row.x as never) && Number(row.y) === 1),
      `native ${type} metrics project the same visit geography as their filter`,
    );
    const expanded = await getSessionExpandedMetrics(
      site,
      { type },
      { ...filters, country: 'eq.CN' },
    );
    check(
      expanded.length === values.length &&
        expanded.every(row => values.includes(row.name as never)) &&
        expanded.reduce((n, row) => n + Number(row.visits), 0) === 2,
      `expanded ${type} metrics preserve both visit tuples and totals`,
    );
  }
  const breakdown = await getBreakdown(
    site,
    { ...filters, fields: ['country', 'region', 'city'] },
    { country: 'eq.CN' },
  );
  check(
    breakdown.length === 2 &&
      breakdown.every(
        row => row.country === 'CN' && ['Guangzhou', 'Beijing'].includes(String(row.city)),
      ) &&
      breakdown.reduce((n, row) => n + Number(row.views), 0) === 2,
    'breakdown uses whole visit tuples and preserves PV totals',
  );
  for (const [column, search, expected] of [
    ['country', 'CN', 'CN'],
    ['region', '广东', 'CN-44'],
    ['city', '广州', 'Guangzhou'],
  ]) {
    const rows = await getValues(site, column, { ...filters, search });
    check(
      rows.length === 1 &&
        rows[0].value === expected &&
        Number(rows[0].count) === 1 &&
        (column !== 'city' || (rows[0].country === 'CN' && rows[0].region === 'CN-44')),
      `${column} dropdown includes an older visitor's current visit and Chinese search`,
    );
  }
  for (const type of ['country', 'region'] as const) {
    const rows = await getRevenueMetrics(
      site,
      { ...filters, unit: 'day', timezone: 'UTC', currency: 'USD' },
      { country: 'eq.CN' },
      type,
    );
    check(
      rows.length === (type === 'country' ? 1 : 2) &&
        rows.every(row =>
          type === 'country' ? row.name === 'CN' : ['CN-44', 'CN-11'].includes(row.name),
        ) &&
        rows.reduce((n, row) => n + Number(row.value), 0) === 200,
      `revenue ${type} is assigned to its event visit without multiplying amounts`,
    );
  }
  const snapshot = await reportSnapshot(() => query('SELECT 1 AS value'), Date.now() + 2000);
  check(snapshot[0]?.value === 1, 'deadline snapshot executes a real database query');
  let timeoutStatus = 0;
  const before = Date.now();
  try {
    await reportSnapshot(() => query('SELECT true AS value FROM pg_sleep(2)'), before + 800);
  } catch (error) {
    timeoutStatus = (error as any).status;
  }
  check(
    timeoutStatus === 503 && Date.now() - before < 1800,
    'deadline snapshot cancels a slow database statement and returns retryable status',
  );
  for (const bounded of [false, true]) {
    let status = 0;
    const start = Date.now();
    try {
      await reportSnapshot(
        () => reportSnapshot(() => query('SELECT true AS value FROM pg_sleep(2)'), start + 800),
        bounded ? start + 5000 : undefined,
      );
    } catch (error) {
      status = (error as any).status;
    }
    check(
      status === 503 && Date.now() - start < 1800,
      `nested deadline preserves the shorter budget inside a ${bounded ? 'bounded' : 'legacy'} snapshot`,
    );
  }
  const outerStart = Date.now();
  let outerStatus = 0;
  try {
    await reportSnapshot(
      () => reportSnapshot(() => query('SELECT true AS value FROM pg_sleep(2)'), outerStart + 5000),
      outerStart + 800,
    );
  } catch (error) {
    outerStatus = (error as any).status;
  }
  check(
    outerStatus === 503 && Date.now() - outerStart < 1800,
    'nested deadline also preserves the shorter outer budget',
  );
  const foreignEvent = randomUUID();
  await db.query(
    "INSERT INTO website_event(event_id,website_id,session_id,visit_id,event_type,url_path,created_at) VALUES($1,$2,$3,$4,1,'/foreign-fixture','2026-10-14T11:00:00Z')",
    [foreignEvent, site, session, randomUUID()],
  );
  await db.query(
    "INSERT INTO liekan_event_geography(event_id,website_id,country,region,city,source,trust,ip_family,precision,reason,rule_version,country_basis,processed_at) VALUES($1,$2,'US','US-NY','New York','fixture','authenticated_server','ipv4','city','fixture','fixture','located',now())",
    [foreignEvent, site],
  );
  await db.query(
    "INSERT INTO revenue(revenue_id,website_id,session_id,event_id,event_name,currency,revenue,created_at) VALUES($1,$2,$3,$4,'fixture','USD',100,'2026-10-14T11:00:00Z')",
    [randomUUID(), site, session, foreignEvent],
  );
  const cohortRevenue = await getRevenueMetrics(
    site,
    { ...filters, unit: 'day', timezone: 'UTC', currency: 'USD' },
    { country: 'eq.CN' },
    'country',
  );
  check(
    cohortRevenue.length === 2 &&
      cohortRevenue.some(row => row.name === 'CN' && Number(row.value) === 200) &&
      cohortRevenue.some(row => row.name === 'US' && Number(row.value) === 100),
    'native revenue preserves visitor cohort filters and assigns every amount to its own visit geography',
  );
  const customSession = randomUUID();
  await db.query(
    "INSERT INTO session(session_id,website_id,country,created_at) VALUES($1,$2,'JP','2026-10-01')",
    [customSession, site],
  );
  await db.query(
    "INSERT INTO website_event(event_id,website_id,session_id,visit_id,event_type,url_path,created_at) VALUES($1,$2,$3,$4,2,'/custom-only-fixture','2026-10-14T11:00:00Z')",
    [randomUUID(), site, customSession, randomUUID()],
  );
  const customValues = await getValues(site, 'country', { ...filters, search: 'JP' });
  check(
    customValues.length === 1 &&
      customValues[0].value === 'JP' &&
      Number(customValues[0].count) === 1,
    'geography dropdown preserves eligible visitors with only custom events',
  );
  const customMetrics = await getSessionMetrics(
    site,
    { type: 'country' },
    { ...filters, country: 'eq.JP' },
  );
  check(
    customMetrics.length === 0,
    'native pageview metrics retain their existing event population',
  );
  const counter = async () =>
    db.query(
      "INSERT INTO liekan_geography_ingress(website_id,bucket,reason,count) VALUES($1,date_trunc('hour',now()),'blocked_ip',7) ON CONFLICT(website_id,bucket,reason) DO UPDATE SET count=7",
      [site],
    );
  const count = async () =>
    Number(
      (
        await db.query(
          'SELECT coalesce(sum(count),0) AS count FROM liekan_geography_ingress WHERE website_id=$1',
          [site],
        )
      ).rows[0].count,
    );
  await counter();
  check((await count()) === 7, 'reset fixture contains a nonempty ingress diagnostic');
  await primary().$transaction(tx => resetLiekanStatistics(tx, site));
  check((await count()) === 0, 'statistics reset clears geography ingress diagnostics');
  await counter();
  await primary().$transaction(tx => stopWebsiteSources(tx, site, true));
  check((await count()) === 0, 'soft deletion clears geography ingress diagnostics');
  if (failed.length) throw new Error(`${failed.length} native geography regressions failed`);
} finally {
  await db.query('DELETE FROM revenue WHERE website_id=$1', [site]);
  await db.query('DELETE FROM website_event WHERE website_id=$1', [site]);
  await db.query('DELETE FROM session WHERE website_id=$1', [site]);
  await db.query('DELETE FROM website WHERE website_id=$1', [site]);
  await db.end();
  await prisma.client.$disconnect();
}
