// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  requestDashboardSnapshot,
  pumpDashboardSnapshots,
  publishDashboardSnapshot,
} from './dashboard-snapshots';
import { processAnalysisQuery } from './analysis-queries';
import { bootstrapAnalysisHistory } from './analysis-rollups-worker';
import { analysisCapacity, analysisTransaction } from './analysis-rollups-db';
import { withPublishedRegistry } from './crawler-registry-context';

const enabled = process.env.LIEKAN_ANALYSIS_ROLLUPS_TEST === '1';
const actor = { id: randomUUID(), role: 'user' };
const sites: string[] = [];
let site: string, session: string;
const p = {
  startAt: +new Date('2026-01-01T00:00Z'),
  endAt: +new Date('2026-01-03T00:00Z'),
  timezone: 'UTC',
};
const q = <T = any[]>(sql: string, ...values: unknown[]) =>
  analysisTransaction(tx => tx.$queryRawUnsafe<T>(sql, ...values));
const sql = (text: string, ...values: unknown[]) =>
  analysisTransaction(tx => tx.$executeRawUnsafe(text, ...values));
const read = (extra: Record<string, unknown> = {}) =>
  withPublishedRegistry(() =>
    requestDashboardSnapshot(site, actor, 'native:stats', { ...p, ...extra }),
  );
async function event(at = '2026-01-01T01:00Z', environment = true) {
  const id = randomUUID();
  await analysisTransaction(async tx => {
    await tx.$executeRawUnsafe(
      'SELECT website_id FROM website WHERE website_id=$1::uuid FOR UPDATE',
      site,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,event_type,url_path,hostname)
      VALUES($1::uuid,$2::uuid,$3::uuid,$3::uuid,$4,1,'/synthetic-snapshot','snapshot.invalid')`,
      id,
      site,
      session,
      new Date(at),
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO liekan_event_quality(event_id,website_id,classification,source,reasons,rule_version,range_status,hostname)
      VALUES($1::uuid,$2::uuid,'browser','browser','{}','snapshot-fixture','missing','snapshot.invalid')`,
      id,
      site,
    );
    if (environment)
      await tx.$executeRawUnsafe(
        `INSERT INTO liekan_event_environment(event_id,website_id,scope,identity_version,identity_available,browser)
      VALUES($1::uuid,$2::uuid,'browser','snapshot-fixture',true,'Firefox')`,
        id,
        site,
      );
  });
}
async function finish(id: string) {
  const execution = await processAnalysisQuery(id);
  if (!execution.acquired) throw new Error('snapshot fixture did not acquire the worker');
  if (execution.value) throw execution.value;
  const [row] = await q(
    'SELECT status,error_code FROM liekan_analysis_query WHERE id=$1::uuid',
    id,
  );
  expect(row).toEqual({ status: 'ready', error_code: null });
}
describe.skipIf(!enabled)('persistent dashboard publications in PostgreSQL', () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL);
    if (
      url.hostname !== '127.0.0.1' ||
      url.port !== '15462' ||
      url.pathname !== '/liekan_analysis_rollups_test'
    )
      throw new Error('Owned snapshot fixture database required');
    await sql(
      `INSERT INTO "user"(user_id,username,password,role) VALUES($1::uuid,$2,'synthetic','user')`,
      actor.id,
      `snapshot-${actor.id}`,
    );
  });
  beforeEach(async () => {
    await sql('DELETE FROM liekan_analysis_query WHERE actor_id=$1::uuid', actor.id);
    site = randomUUID();
    session = randomUUID();
    sites.push(site);
    await sql(
      `INSERT INTO website(website_id,user_id,name,domain) VALUES($1::uuid,$2::uuid,'Synthetic dashboard fixture','snapshot.invalid')`,
      site,
      actor.id,
    );
    await sql(
      `INSERT INTO session(session_id,website_id,created_at) VALUES($1::uuid,$2::uuid,'2026-01-01')`,
      session,
      site,
    );
    await sql(
      'UPDATE liekan_analysis_background_lease SET token=NULL,lease_until=NULL,incremental_waiting_at=NULL,history_waiting_at=NULL,interactive_turns=0 WHERE id',
    );
    await event();
  });
  afterAll(async () => {
    for (const id of sites) await sql('DELETE FROM website WHERE website_id=$1::uuid', id);
    await sql('DELETE FROM "user" WHERE user_id=$1::uuid', actor.id);
  });
  it('reads a historical publication after transient task expiry without creating new computations', async () => {
    const first = await read();
    if (first.ready === true) throw new Error('fixture already published');
    await finish(first.analysisJob.id);
    await sql(
      "UPDATE liekan_analysis_query SET expires_at=clock_timestamp()-interval '1 hour' WHERE id=$1::uuid",
      first.analysisJob.id,
    );
    const value = await read();
    expect(value.ready).toBe(true);
    if (value.ready) expect(value.value).toMatchObject({ pageviews: 1, visitors: 1, visits: 1 });
    for (let i = 0; i < 5; i++) expect((await read()).ready).toBe(true);
    expect((await read({ refresh: '1' })).ready).toBe(true);
    expect(
      (
        await q(
          'SELECT count(*)::int AS n FROM liekan_analysis_query WHERE website_id=$1::uuid',
          site,
        )
      )[0].n,
    ).toBe(1);
  });
  it('keeps the published result readable while a late event is rebuilt and atomically replaces it', async () => {
    const first = await read();
    if (first.ready === true) throw new Error('fixture already published');
    await finish(first.analysisJob.id);
    await event('2026-01-01T01:02Z', false);
    await sql(
      "UPDATE liekan_dashboard_snapshot SET job_id=NULL,next_refresh_at=clock_timestamp()-interval '1 second' WHERE website_id=$1::uuid",
      site,
    );
    const old = await read();
    expect(old).toMatchObject({ ready: true, value: { pageviews: 1, visitors: 1 } });
    // A distinct five-second refresh round is allowed without waiting in real time.
    await sql(
      "UPDATE liekan_analysis_query SET queued_at=clock_timestamp()-interval '10 seconds' WHERE id=$1::uuid",
      first.analysisJob.id,
    );
    await pumpDashboardSnapshots();
    const [pending] = await q(
      'SELECT job_id FROM liekan_dashboard_snapshot WHERE website_id=$1::uuid',
      site,
    );
    expect(pending.job_id).toEqual(expect.any(String));
    expect(await read()).toMatchObject({ ready: true, value: { pageviews: 1 } });
    await finish(pending.job_id);
    expect(await read()).toMatchObject({
      ready: true,
      snapshotState: 'ready',
      value: { pageviews: 2 },
    });
  });
  it('includes changes received while a candidate was waiting for execution', async () => {
    const first = await read();
    if (first.ready === true) throw new Error('fixture already published');
    await event('2026-01-01T01:03Z', false);
    await finish(first.analysisJob.id);
    const [row] = await q(
      'SELECT result,job_id,error_code FROM liekan_dashboard_snapshot WHERE website_id=$1::uuid',
      site,
    );
    expect(row.job_id).toBeNull();
    expect(row.error_code).toBeNull();
    expect(row.result).not.toBeNull();
    expect(await read()).toMatchObject({ ready: true, value: { pageviews: 2 } });
  });
  it('checks current website authority before returning a durable result', async () => {
    const first = await read();
    if (first.ready === true) throw new Error('fixture already published');
    await finish(first.analysisJob.id);
    await sql('UPDATE website SET deleted_at=clock_timestamp() WHERE website_id=$1::uuid', site);
    await expect(read()).rejects.toMatchObject({ status: 404 });
  });
  it('keeps events after a closed cutoff out of its publication fence', async () => {
    const pin = async () =>
      (
        await q(
          "SELECT liekan_dashboard_fingerprint(website_id,epoch,'2026-01-01T01:05:00Z') AS fingerprint FROM liekan_analysis_site WHERE website_id=$1::uuid",
          site,
        )
      )[0].fingerprint;
    const before = await pin();
    await event('2026-01-01T01:06Z', false);
    expect(await pin()).toBe(before);
    await event('2026-01-01T01:04Z', false);
    expect(await pin()).not.toBe(before);
  });
  it('keeps rejected admissions atomic without accumulating empty snapshot rows', async () => {
    await read();
    await read({ endAt: p.endAt - 1000 });
    await expect(read({ endAt: p.endAt - 2000 })).rejects.toMatchObject({ status: 429 });
    expect(
      (
        await q(
          'SELECT count(*)::int AS n FROM liekan_dashboard_snapshot WHERE website_id=$1::uuid',
          site,
        )
      )[0].n,
    ).toBe(2);
    expect(
      (
        await q(
          'SELECT count(*)::int AS n FROM liekan_analysis_query WHERE website_id=$1::uuid',
          site,
        )
      )[0].n,
    ).toBe(2);
  });
  it('tracks independently collected heatmap changes for historical correction', async () => {
    const pin = async () =>
      (
        await q(
          "SELECT liekan_dashboard_fingerprint(website_id,epoch,'2026-01-02') AS fingerprint FROM liekan_analysis_site WHERE website_id=$1::uuid",
          site,
        )
      )[0].fingerprint;
    const before = await pin();
    await sql(
      `INSERT INTO heatmap_event(heatmap_event_id,website_id,session_id,visit_id,url_path,event_type,x,y,created_at)
      VALUES($1::uuid,$2::uuid,$3::uuid,$3::uuid,'/synthetic-snapshot',1,10,20,'2026-01-01T01:02Z')`,
      randomUUID(),
      site,
      session,
    );
    expect(await pin()).not.toBe(before);
  });
  it('reserves every linked snapshot copy before publishing and preserves the prior generation on capacity failure', async () => {
    const first = await read();
    if (first.ready === true) throw new Error('fixture already published');
    await finish(first.analysisJob.id);
    const [job] = await q(
      'SELECT * FROM liekan_analysis_query WHERE id=$1::uuid',
      first.analysisJob.id,
    );
    await sql(
      `INSERT INTO liekan_dashboard_snapshot(website_id,query_key,actor_id,target,parameters,locale,strong_version,epoch,calendar_day,dependency_end,job_id,pending_fingerprint,pending_through)
      SELECT website_id,query_key||'-alias',actor_id,target,parameters,locale,strong_version,epoch,calendar_day,dependency_end,$2::uuid,fingerprint,data_through
      FROM liekan_dashboard_snapshot WHERE website_id=$1::uuid`,
      site,
      job.id,
    );
    await sql(
      'UPDATE liekan_dashboard_snapshot SET job_id=$2::uuid,pending_fingerprint=fingerprint,pending_through=data_through WHERE website_id=$1::uuid AND result IS NOT NULL',
      site,
      job.id,
    );
    await analysisTransaction(async tx => {
      const capacity = await analysisCapacity(tx, site);
      await tx.$executeRawUnsafe(
        'UPDATE liekan_analysis_site SET derived_bytes=derived_bytes+$2::bigint WHERE website_id=$1::uuid',
        site,
        String(BigInt(capacity.siteLimit) - BigInt(capacity.siteBytes) - BigInt(job.result_bytes)),
      );
    });
    await expect(
      analysisTransaction(tx => publishDashboardSnapshot(tx, job)),
    ).rejects.toMatchObject({ status: 413, code: 'analysis-capacity-limited' });
    const [published] = await q(
      'SELECT count(*)::int AS n FROM liekan_dashboard_snapshot WHERE website_id=$1::uuid AND result IS NOT NULL',
      site,
    );
    expect(published.n).toBe(1);
    expect(await read()).toMatchObject({ ready: true, value: { pageviews: 1 } });
  });
  it('automatically registers the retained history once per site epoch', async () => {
    await bootstrapAnalysisHistory(Date.now(), site);
    const [state] = await q(
      'SELECT archive_epoch=epoch AS bootstrapped FROM liekan_analysis_site WHERE website_id=$1::uuid',
      site,
    );
    expect(state.bootstrapped).toBe(true);
    const rows = await q(
      'SELECT range_start,range_end,actor_id,status FROM liekan_analysis_build WHERE website_id=$1::uuid',
      site,
    );
    expect(rows).toHaveLength(1);
    expect(+rows[0].range_start).toBe(+new Date('2026-01-01T01:00Z'));
    expect(rows[0]).toMatchObject({ actor_id: null, status: 'queued' });
    await bootstrapAnalysisHistory(Date.now(), site);
    expect(
      (
        await q(
          'SELECT count(*)::int AS n FROM liekan_analysis_build WHERE website_id=$1::uuid',
          site,
        )
      )[0].n,
    ).toBe(1);
  });
  it('retains an open imported hour until it closes, then automatically schedules it', async () => {
    await sql('DELETE FROM website_event WHERE website_id=$1::uuid', site);
    const at = new Date(Math.floor(Date.now() / 3600000) * 3600000 + 1000);
    await event(at.toISOString(), false);
    await bootstrapAnalysisHistory(+at + 60000, site);
    let [state] = await q(
      'SELECT archive_complete,archive_build_id FROM liekan_analysis_site WHERE website_id=$1::uuid',
      site,
    );
    expect(state).toEqual({ archive_complete: false, archive_build_id: null });
    await bootstrapAnalysisHistory(+at + 3600000 + 60000, site);
    [state] = await q(
      'SELECT archive_complete,archive_build_id FROM liekan_analysis_site WHERE website_id=$1::uuid',
      site,
    );
    expect(state.archive_build_id).toEqual(expect.any(String));
    const [build] = await q(
      'SELECT automatic_history FROM liekan_analysis_build WHERE id=$1::uuid',
      state.archive_build_id,
    );
    expect(build.automatic_history).toBe(true);
    await sql(
      "UPDATE liekan_analysis_build SET status='failed',next_attempt_at=clock_timestamp()-interval '1 second',attempts=4 WHERE id=$1::uuid",
      state.archive_build_id,
    );
    await bootstrapAnalysisHistory(Date.now(), site);
    expect(
      (
        await q(
          'SELECT status,attempts FROM liekan_analysis_build WHERE id=$1::uuid',
          state.archive_build_id,
        )
      )[0],
    ).toEqual({ status: 'queued', attempts: 0 });
  });
});
