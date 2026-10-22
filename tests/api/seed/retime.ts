import { execFileSync } from 'node:child_process';

export type BrowserFixtureTime = {
  websiteId: string;
  eventId: string;
  at: number;
  splitVisits: boolean;
};

/** Historical query fixtures use real browser intake, then retime only their owned test rows. */
export function retimeBrowserFixtures(rows: BrowserFixtureTime[]) {
  if (!rows.length) return;
  const container = process.env.LIEKAN_API_FIXTURE_CONTAINER;
  const owner = process.env.LIEKAN_API_FIXTURE_OWNER;
  const database = process.env.LIEKAN_API_FIXTURE_DATABASE;
  const user = process.env.LIEKAN_API_FIXTURE_USER;
  if (
    !container ||
    !owner ||
    !database ||
    !user ||
    !/^[a-zA-Z0-9_-]+$/.test(container) ||
    !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(database) ||
    !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(user)
  )
    throw new Error('Historical browser fixtures require an owned disposable database');
  const label = execFileSync(
    'docker',
    ['inspect', '--format', '{{index .Config.Labels "io.liekan.api-fixture"}}', container],
    { encoding: 'utf8' },
  ).trim();
  if (label !== owner) throw new Error('API fixture database ownership mismatch');
  for (const row of rows) {
    if (
      !/^[a-f0-9-]{36}$/i.test(row.websiteId) ||
      !/^[a-f0-9-]{36}$/i.test(row.eventId) ||
      !Number.isSafeInteger(row.at) ||
      row.at < 0
    )
      throw new Error('Invalid historical browser fixture');
  }
  const encoded = JSON.stringify(rows).replaceAll("'", "''");
  const sql = `BEGIN;
    CREATE TEMP TABLE fixture_clock ON COMMIT DROP AS
      SELECT e.event_id,e.website_id,e.session_id,to_timestamp(f.at) AS at,f."splitVisits" AS split_visits
      FROM jsonb_to_recordset('${encoded}'::jsonb) AS f("websiteId" uuid,"eventId" uuid,at bigint,"splitVisits" boolean)
      JOIN liekan_collection_receipt r ON r.website_id=f."websiteId" AND r.client_event_id=f."eventId"
      JOIN website_event e ON e.website_id=r.website_id AND e.event_id=r.event_id
      JOIN liekan_event_quality q ON q.event_id=e.event_id AND q.website_id=e.website_id AND q.source='browser'
      JOIN liekan_event_environment env ON env.event_id=e.event_id AND env.website_id=e.website_id AND env.identity_available;
    DO $$ BEGIN IF (SELECT count(*) FROM fixture_clock) <> ${rows.length} THEN RAISE EXCEPTION 'Fixture intake or identity evidence incomplete'; END IF; END $$;
    UPDATE website_event e SET created_at=f.at,visit_id=CASE WHEN f.split_visits AND f.at<date_trunc('day',now()) THEN md5('api-fixture:'||e.session_id::text||date_trunc('hour',f.at)::text)::uuid ELSE e.visit_id END FROM fixture_clock f WHERE e.event_id=f.event_id;
    UPDATE event_data d SET created_at=f.at FROM fixture_clock f WHERE d.website_event_id=f.event_id;
    UPDATE revenue r SET created_at=f.at FROM fixture_clock f WHERE r.event_id=f.event_id;
    INSERT INTO liekan_analytics_revision(resource_type,resource_id,revision) SELECT DISTINCT 'website',website_id,1 FROM fixture_clock ON CONFLICT(resource_type,resource_id) DO UPDATE SET revision=liekan_analytics_revision.revision+1,updated_at=now();
    COMMIT;`;
  execFileSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', user, '-d', database, '-v', 'ON_ERROR_STOP=1', '-q'],
    { input: sql, stdio: ['pipe', 'ignore', 'pipe'] },
  );
}
