// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { withPublishedRegistry } from './crawler-registry-context';
import {
  requestAnalysisQuery,
  readAnalysisQuery,
  processAnalysisQuery,
  pumpAnalysisQueries,
} from './analysis-queries';
import { analysisTransaction } from './analysis-rollups-db';
import { withAnalysisPermit } from './analysis-background';
const enabled = process.env.LIEKAN_ANALYSIS_ROLLUPS_TEST === '1';
const actor = { id: randomUUID(), role: 'user' },
  other = { id: randomUUID(), role: 'user' };
let site: string;
const teams: string[] = [];
const sql = (text: string, ...values: unknown[]) =>
  analysisTransaction(tx => tx.$executeRawUnsafe(text, ...values));
const q = <T = any[]>(text: string, ...values: unknown[]) =>
  analysisTransaction(tx => tx.$queryRawUnsafe<T>(text, ...values));
const parameters = { startAt: 1767225600000, endAt: 1767398400000, timezone: 'Asia/Shanghai' };
const request = (extra: Record<string, unknown> = {}, user = actor) =>
  withPublishedRegistry(() =>
    requestAnalysisQuery(site, user, 'native:stats', { ...parameters, ...extra }),
  );
describe.skipIf(!enabled)('durable private query lifecycle in PostgreSQL', () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL);
    if (
      url.hostname !== '127.0.0.1' ||
      url.port !== '15462' ||
      url.pathname !== '/liekan_analysis_rollups_test' ||
      !/^analysis_[a-f0-9]+$/.test(url.searchParams.get('schema') || '')
    )
      throw new Error('Owned analysis test database required');
    for (const user of [actor, other])
      await sql(
        "INSERT INTO \"user\"(user_id,username,password,role) VALUES($1::uuid,$2,'fixture','user')",
        user.id,
        `analysis-${user.id}`,
      );
  });
  beforeEach(async () => {
    await sql('DELETE FROM liekan_analysis_query WHERE actor_id=ANY($1::uuid[])', [
      actor.id,
      other.id,
    ]);
    site = randomUUID();
    await sql(
      "INSERT INTO website(website_id,user_id,name,domain) VALUES($1::uuid,$2::uuid,'Analysis fixture','analysis.example')",
      site,
      actor.id,
    );
    await sql(
      'UPDATE liekan_analysis_background_lease SET token=NULL,lease_until=NULL,incremental_waiting_at=NULL,history_waiting_at=NULL,interactive_turns=0 WHERE id',
    );
  });
  afterAll(async () => {
    await sql('DELETE FROM liekan_analysis_query WHERE actor_id=ANY($1::uuid[])', [
      actor.id,
      other.id,
    ]);
    for (const team of teams) await sql('DELETE FROM team WHERE team_id=$1::uuid', team);
    for (const user of [actor, other])
      await sql('DELETE FROM "user" WHERE user_id=$1::uuid', user.id);
  });
  it('coalesces a repeated query and lets the worker publish the original DTO', async () => {
    const first = await request(),
      second = await request();
    expect(first.ready).toBe(false);
    expect(second).toEqual(first);
    if (first.ready === true) return;
    const execution = await processAnalysisQuery(first.analysisJob.id);
    expect(execution.acquired).toBe(true);
    if (execution.acquired && execution.value) throw execution.value;
    const [executed] = await q(
      'SELECT status,error_code,attempts FROM liekan_analysis_query WHERE id=$1::uuid',
      first.analysisJob.id,
    );
    expect(executed).toMatchObject({ status: 'ready', error_code: null, attempts: 1 });
    const result = await withPublishedRegistry(() =>
      readAnalysisQuery(site, actor, first.analysisJob.id, true),
    );
    expect(result.ready).toBe(true);
    if (result.ready)
      expect(result.value).toMatchObject({
        pageviews: 0,
        visitors: 0,
        comparison: { pageviews: 0 },
      });
    const reopened = await request();
    expect(reopened.ready).toBe(true);
    if (result.ready && reopened.ready) expect(reopened.expiresAt).toBe(result.expiresAt);
  });
  it('enforces consumer identity and expiry independently of 24 hour retention', async () => {
    const task = await request();
    if (task.ready === true) throw new Error('new fixture unexpectedly cached');
    await expect(
      withPublishedRegistry(() => readAnalysisQuery(site, other, task.analysisJob.id, true)),
    ).rejects.toMatchObject({ status: 404 });
    await processAnalysisQuery(task.analysisJob.id);
    await sql(
      "UPDATE liekan_analysis_query SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1::uuid",
      task.analysisJob.id,
    );
    await expect(
      withPublishedRegistry(() => readAnalysisQuery(site, actor, task.analysisJob.id, true)),
    ).rejects.toMatchObject({ status: 410 });
    const next = await request();
    expect(next.ready).toBe(false);
    expect(next).toHaveProperty('previousResult');
  });
  it('preserves the current numeric site handle and complete page DTO after durable execution', async () => {
    const [website] = await q<{ id: string; name: string; domain: string; siteNumber: number }[]>(
      'SELECT website_id AS id,name,domain,site_number::int AS "siteNumber" FROM website WHERE website_id=$1::uuid',
      site,
    );
    expect(website.siteNumber).toEqual(expect.any(Number));
    const input = { ...parameters, resource: 'human/overview', chartPeriod: '30d' };
    const task = await withPublishedRegistry(() =>
      requestAnalysisQuery(site, actor, 'feature:page-report', input),
    );
    if (task.ready === true) throw new Error('new fixture unexpectedly cached');
    await processAnalysisQuery(task.analysisJob.id);
    const actual = await withPublishedRegistry(() =>
      readAnalysisQuery(site, actor, task.analysisJob.id, true),
    );
    expect(actual.ready).toBe(true);
    if (actual.ready !== true) throw new Error('durable fixture did not complete');
    const { readPageReport } = await import('./page-report');
    const precise = await withPublishedRegistry(() => readPageReport(website, input, true));
    precise.value.meta.canManage = true;
    const statistics = (value: any) => {
      const { generatedAt: _generated, expiresAt: _expires, ...meta } = value.meta;
      return { ...value, meta };
    };
    expect(actual.value.website).toEqual(website);
    expect(statistics(actual.value)).toEqual(statistics(precise.value));
  });
  it.each([
    ['team-member', true],
    ['team-view-only', false],
  ] as const)('projects the ordinary website update permission for %s', async (role, canManage) => {
    const team = randomUUID();
    teams.push(team);
    await sql("INSERT INTO team(team_id,name) VALUES($1::uuid,'Analysis team fixture')", team);
    for (const [member, memberRole] of [
      [actor, role],
      [other, 'team-owner'],
    ] as const)
      await sql(
        'INSERT INTO team_user(team_user_id,team_id,user_id,role) VALUES($1::uuid,$2::uuid,$3::uuid,$4)',
        randomUUID(),
        team,
        member.id,
        memberRole,
      );
    await sql(
      'UPDATE website SET user_id=NULL,team_id=$2::uuid WHERE website_id=$1::uuid',
      site,
      team,
    );
    const task = await withPublishedRegistry(() =>
      requestAnalysisQuery(site, actor, 'feature:page-report', {
        ...parameters,
        resource: 'human/overview',
        chartPeriod: '30d',
      }),
    );
    if (task.ready === true) throw new Error('new team fixture unexpectedly cached');
    await processAnalysisQuery(task.analysisJob.id);
    const result = await withPublishedRegistry(() =>
      readAnalysisQuery(site, actor, task.analysisJob.id, true),
    );
    expect(result.ready).toBe(true);
    if (result.ready) expect(result.value.meta.canManage).toBe(canManage);
  });
  it('recovers a lost queue handoff and does not spend attempts while waiting for a permit', async () => {
    const task = await request();
    if (task.ready === true) throw new Error('new fixture unexpectedly cached');
    const send = vi.fn().mockResolvedValue('delivered');
    await pumpAnalysisQueries({ send });
    expect(send.mock.calls.some(([, data]) => data.id === task.analysisJob.id)).toBe(true);
    await withAnalysisPermit('interactive', async () => {
      expect((await processAnalysisQuery(task.analysisJob.id)).acquired).toBe(false);
    });
    const [row] = await q(
      'SELECT status,attempts FROM liekan_analysis_query WHERE id=$1::uuid',
      task.analysisJob.id,
    );
    expect(row).toEqual({ status: 'queued', attempts: 0 });
  });
  it('invalidates queued work after website transfer without borrowing a new consumer', async () => {
    const task = await request();
    if (task.ready === true) throw new Error('new fixture unexpectedly cached');
    await sql('UPDATE website SET user_id=$2::uuid WHERE website_id=$1::uuid', site, other.id);
    await processAnalysisQuery(task.analysisJob.id);
    const [row] = await q(
      'SELECT status FROM liekan_analysis_query WHERE id=$1::uuid',
      task.analysisJob.id,
    );
    expect(row.status).toBe('invalidated');
  });
  it('admits fifty same-key consumers as one durable computation', async () => {
    const results = await Promise.all(Array.from({ length: 50 }, () => request()));
    const ids = results.map(result => ('analysisJob' in result ? result.analysisJob.id : null));
    expect(new Set(ids).size).toBe(1);
    const [count] = await q(
      'SELECT count(*)::int AS count FROM liekan_analysis_query WHERE website_id=$1::uuid',
      site,
    );
    expect(count.count).toBe(1);
  });
  it('recomputes expired input cache evidence instead of publishing an immediately expired ready result', async () => {
    const module = await import('./analysis-query-execution');
    const { noteCacheResult } = await import('./cache-context');
    const execution = vi.spyOn(module, 'executeAnalysisQuery');
    execution.mockImplementationOnce(async () => {
      noteCacheResult({
        value: {},
        generatedAt: Date.now() - 30000,
        expiresAt: Date.now() - 1,
        status: 'hit',
      });
      return { pageviews: 0, visitors: 0, comparison: { visitors: 0 } };
    });
    const task = await request();
    if (task.ready === true) throw new Error('unexpected fixture cache');
    try {
      await processAnalysisQuery(task.analysisJob.id);
      expect(execution).toHaveBeenCalledTimes(2);
      const result = await withPublishedRegistry(() =>
        readAnalysisQuery(site, actor, task.analysisJob.id, true),
      );
      expect(result.ready).toBe(true);
      if (result.ready) expect(result.expiresAt).toBeGreaterThan(Date.now());
    } finally {
      execution.mockRestore();
    }
  });
  it('serializes background work and yields a short unit for aged incremental and history work', async () => {
    const task = await request();
    expect(task.ready).toBe(false);
    await withAnalysisPermit('interactive', async () => {
      expect((await withAnalysisPermit('history', async () => true)).acquired).toBe(false);
    });
    await sql(
      "UPDATE liekan_analysis_background_lease SET incremental_waiting_at=clock_timestamp()-interval '31 seconds' WHERE id",
    );
    expect((await withAnalysisPermit('interactive', async () => true)).acquired).toBe(false);
    expect((await withAnalysisPermit('incremental', async () => true)).acquired).toBe(true);
    await sql(
      "UPDATE liekan_analysis_background_lease SET history_waiting_at=clock_timestamp()-interval '10 seconds',interactive_turns=5 WHERE id",
    );
    expect((await withAnalysisPermit('interactive', async () => true)).acquired).toBe(false);
    expect((await withAnalysisPermit('history', async () => true)).acquired).toBe(true);
    expect((await withAnalysisPermit('interactive', async () => true)).acquired).toBe(true);
  });
  it('records real equivalent raw and derived day measurements before any expansion decision', async () => {
    const imported = randomUUID();
    await sql(
      'INSERT INTO liekan_import(id,website_id,digest,accepted,rejected) VALUES($1::uuid,$2::uuid,$1,1,0)',
      imported,
      site,
    );
    await sql(
      `INSERT INTO liekan_log(id,website_id,import_id,created_at,path,method,status,bytes,ip_masked,ip_hash,user_agent,location,bot,vendor,bot_type,verification,ai_eligible,recognition_state)
     SELECT gen_random_uuid()::text,$1::uuid,$2::uuid,timestamptz '2026-03-20Z'+d*interval '1 day'+interval '1 hour','/fixture/'||n,'GET',200,0,'','','GPTBot/fixture','','GPTBot','OpenAI','训练','unverified',true,'recognized'
     FROM generate_series(0,2) d CROSS JOIN generate_series(1,32) n`,
      site,
      imported,
    );
    const api = await import('./analysis-rollups');
    const build = await api.createAnalysisBuild(
      site,
      { userId: actor.id },
      {
        startDate: new Date('2026-03-17Z'),
        endDate: new Date('2026-03-23Z'),
        timezone: 'UTC',
        locale: 'zh-CN',
        requestId: randomUUID(),
      },
    );
    for (let turn = 0; turn < 400; turn++) {
      const rows = await api.listAnalysisBuilds(site, { userId: actor.id });
      if (rows[0].status === 'completed') break;
      expect(['queued', 'running']).toContain(rows[0].status);
      await api.runOneAnalysisWorkUnit(build.id);
    }
    expect((await api.listAnalysisBuilds(site, { userId: actor.id }))[0].status).toBe('completed');
    const { tryFastAnalysis } = await import('./analysis-fast-read');
    const fast = await withPublishedRegistry(() =>
      tryFastAnalysis(
        { id: site, name: 'Analysis fixture', domain: 'analysis.example' },
        'native:stats',
        {
          startAt: +new Date('2026-03-20Z'),
          endAt: +new Date('2026-03-23Z'),
          timezone: 'UTC',
        },
      ),
    );
    expect(fast?.value).toMatchObject({ pageviews: 0, visitors: 0, comparison: { visitors: 0 } });
    const { probeAnalysisExpansion } = await import('./analysis-expansion');
    for (let day = 0; day < 3; day++) await probeAnalysisExpansion(site);
    const rows = await q(
      `SELECT input_rows,derived_rows,compared,raw_ms,accelerated_ms,status FROM liekan_analysis_probe WHERE website_id=$1::uuid AND family='path'`,
      site,
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toMatchObject({
        status: 'ready',
        compared: true,
        input_rows: 32n,
        derived_rows: 32n,
      });
      expect(row.raw_ms).toBeGreaterThan(0);
      expect(row.accelerated_ms).toBeGreaterThan(0);
    }
    await sql(
      `UPDATE liekan_analysis_probe SET versions=jsonb_set(versions,'{engine}','"older-engine"') WHERE website_id=$1`,
      site,
    );
    for (let day = 0; day < 3; day++) await probeAnalysisExpansion(site);
    const upgraded = await q(
      'SELECT versions,compared,input_rows FROM liekan_analysis_probe WHERE website_id=$1',
      site,
    );
    expect(upgraded).toHaveLength(3);
    for (const row of upgraded) {
      expect(row.versions.engine).toBe('analysis-rollups-v2');
      expect(row.compared).toBe(true);
      expect(row.input_rows).toBe(32n);
    }
  });
  it('limits each consumer to two distinct pending tasks', async () => {
    await request();
    await request({ endAt: parameters.endAt - 1000 });
    await expect(request({ endAt: parameters.endAt - 2000 })).rejects.toMatchObject({
      status: 429,
    });
  });
});
