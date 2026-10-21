import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

// An isolated, networkless PostgreSQL instance exercises the actual deployed views.
test('browser analytics exclude server and unknown sources in every policy mode', async () => {
  const name = `liekan-source-policy-${randomUUID()}`;
  const docker = args =>
    execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const sql = input =>
    execFileSync(
      'docker',
      [
        'exec',
        '-i',
        name,
        'psql',
        '-h',
        '127.0.0.1',
        '-U',
        'postgres',
        '-qAt',
        '-v',
        'ON_ERROR_STOP=1',
      ],
      { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
  let created = false;
  try {
    docker([
      'run',
      '--detach',
      '--name',
      name,
      '--network',
      'none',
      '--label',
      'io.liekan.test=browser-source-policy',
      '-e',
      'POSTGRES_HOST_AUTH_METHOD=trust',
      'postgres:16-alpine',
    ]);
    created = true;
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        sql('SELECT 1');
        ready = true;
        break;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    assert(ready, 'isolated PostgreSQL becomes ready');
    sql(`CREATE TABLE website(website_id uuid PRIMARY KEY);
      CREATE TABLE website_event(event_id uuid PRIMARY KEY,website_id uuid,session_id uuid,visit_id uuid,hostname text,event_type integer);
      CREATE TABLE event_data(website_event_id uuid,website_id uuid);
      CREATE TABLE revenue(event_id uuid,website_id uuid);
      CREATE TABLE heatmap_event(website_id uuid,session_id uuid,visit_id uuid);
      CREATE TABLE session_replay(website_id uuid,session_id uuid,visit_id uuid);`);
    sql(readFileSync('db/liekan/migrations/016_traffic_quality.sql', 'utf8'));
    for (const file of readdirSync('db/liekan/migrations').filter(file =>
      /^028_browser_sources\.sql$/.test(file),
    ))
      sql(readFileSync(`db/liekan/migrations/${file}`, 'utf8'));
    const site = randomUUID(),
      session = randomUUID(),
      visit = randomUUID();
    sql(
      `INSERT INTO website VALUES('${site}'); INSERT INTO liekan_collection_policy(website_id) VALUES('${site}');`,
    );
    for (const [source, classification, type] of [
      ['browser', 'browser', 1],
      ['authenticated_server', 'browser', 1],
      ['legacy_override', 'suspected', 1],
      [null, null, 1],
      ['browser', 'automated', 1],
      ['browser', 'browser', 2],
      [null, null, 3],
      [null, null, 4],
    ]) {
      const event = randomUUID();
      sql(`INSERT INTO website_event VALUES('${event}','${site}','${session}','${visit}','example.test',${type});
        ${source ? `INSERT INTO liekan_event_quality(event_id,website_id,classification,source,reasons,rule_version,range_status) VALUES('${event}','${site}','${classification}','${source}','{}','fixture','untrusted');` : ''}`);
    }
    for (const mode of ['standard', 'strict', 'raw']) {
      sql(`UPDATE liekan_collection_policy SET mode='${mode}' WHERE website_id='${site}';`);
      assert.equal(
        Number(sql('SELECT count(*) FROM liekan_effective_website_event WHERE event_type=1')),
        mode === 'raw' ? 2 : 1,
        `${mode}: only browser-source pageviews`,
      );
      assert.equal(
        Number(sql('SELECT count(*) FROM liekan_effective_website_event WHERE event_type=2')),
        1,
        'custom browser events retain their separate event type',
      );
      assert.equal(
        Number(
          sql('SELECT count(*) FROM liekan_effective_website_event WHERE event_type IN (3,4)'),
        ),
        2,
        'upstream link/pixel behavior remains compatible',
      );
    }
    assert.equal(
      Number(sql('SELECT count(*) FROM liekan_raw_website_event')),
      8,
      'all raw events remain available for diagnostics',
    );
    const unknownVisit = randomUUID();
    for (const table of ['heatmap_event', 'session_replay']) {
      sql(
        `INSERT INTO ${table} VALUES('${site}','${session}','${visit}'),('${site}','${session}','${unknownVisit}');`,
      );
      assert.equal(
        Number(sql(`SELECT count(*) FROM liekan_effective_${table}`)),
        1,
        'recordings require an eligible visit',
      );
      assert.equal(
        Number(sql(`SELECT count(*) FROM ${table}`)),
        2,
        'unknown recordings remain stored',
      );
    }
    sql(readFileSync('db/liekan/migrations/028_browser_sources.sql', 'utf8'));
    assert.equal(
      Number(sql('SELECT count(*) FROM liekan_raw_website_event')),
      8,
      'reapplying the view migration preserves received events',
    );
  } finally {
    if (created) docker(['rm', '--force', '--volumes', name]);
  }
});
