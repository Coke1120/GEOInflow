import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import type pg from 'pg';
import {
  assertBenchmarkSites,
  benchmarkBrowserHeaders,
  benchmarkIdentityVersion,
} from './liekan-benchmark-fixtures';
const percentile = (values: number[], fraction: number) =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * fraction))
  ] || 0;
/** Runs inside the cache harness's disposable database and container resource limits. */
export async function measureTrafficQuality({
  base,
  baseline,
  headers,
  database,
  ownerId,
  smoke,
  observe,
  volumeSites,
}: {
  base: string;
  baseline?: string;
  headers: Record<string, string>;
  database: pg.Client;
  ownerId: string;
  smoke: boolean;
  observe: () => Promise<unknown>;
  volumeSites: string[];
}) {
  const result: any = {
    passed: false,
    rates: [],
    queries: [],
    scope: 'PostgreSQL collector, quality audit, shadow worker; isolated synthetic websites',
    observationBudget:
      'Observation subprocess and analytics prewarming share the existing background container: 1 CPU / 512 MiB; includes observation startup; production uses separate worker containers',
  };
  const create = async () => {
    const id = randomUUID();
    await database.query(
      'INSERT INTO website(website_id,name,domain,user_id) VALUES($1,$2,$3,$4)',
      [id, '流量质量压测（合成数据）', 'traffic-benchmark.invalid', ownerId],
    );
    await database.query('INSERT INTO liekan_setting(website_id,is_demo) VALUES($1,true)', [id]);
    return id;
  };
  await assertBenchmarkSites(database, volumeSites);
  // Move only this invocation's synthetic reception windows into the worker's measured backlog.
  await database.query(
    `UPDATE liekan_event_quality q SET created_at=date_trunc('minute',now())-interval '3 minutes'
     FROM liekan_event_environment env WHERE q.website_id=ANY($1::uuid[]) AND env.event_id=q.event_id
       AND env.website_id=q.website_id AND env.identity_version=$2 AND 'synthetic-benchmark'=ANY(q.reasons)`,
    [volumeSites, benchmarkIdentityVersion],
  );
  await database.query(
    `INSERT INTO liekan_browser_risk_state(website_id,epoch,next_window,rule_version)
  SELECT w.website_id,COALESCE(l.epoch,1),date_trunc('minute',now())-interval '2 minutes','browser-behavior-v1' FROM website w LEFT JOIN liekan_log_state l ON l.website_id=w.website_id WHERE w.website_id=ANY($1::uuid[])
  ON CONFLICT(website_id) DO UPDATE SET next_window=EXCLUDED.next_window`,
    [volumeSites],
  );
  result.volumeQualityRows = Number(
    (
      await database.query(
        'SELECT count(*) FROM liekan_event_quality WHERE website_id=ANY($1::uuid[])',
        [volumeSites],
      )
    ).rows[0].count,
  );
  assert(result.volumeQualityRows > 0, 'volume quality fixtures must actually exist');
  const maintenanceStarted = performance.now();
  // Finish fixture maintenance before either collector's timed requests begin.
  await database.query('VACUUM (ANALYZE) liekan_event_quality');
  result.fixtureMaintenanceMs = performance.now() - maintenanceStarted;
  const current = await create(),
    old = baseline ? await create() : undefined;
  result.collectorPreparation = [];
  for (const [label, target, site] of [
    ...(baseline && old ? [['baseline', baseline, old]] : []),
    ['candidate', base, current],
  ]) {
    const started = performance.now();
    const response = await fetch(`${target}/api/send`, {
      method: 'POST',
      headers: benchmarkBrowserHeaders,
      body: JSON.stringify({
        type: 'event',
        payload: {
          website: site,
          eventId: randomUUID(),
          hostname: 'traffic-benchmark.invalid',
          url: '/synthetic/preparation',
        },
      }),
      signal: AbortSignal.timeout(40000),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.has('set-cookie'), false);
    const body: any = await response.json();
    assert(typeof body.sessionId === 'string' && body.sessionId.length > 0);
    assert(typeof body.visitId === 'string' && body.visitId.length > 0);
    if (label === 'candidate') {
      const proof = (
        await database.query(
          `SELECT q.source,env.scope,env.identity_available FROM website_event e
         JOIN liekan_event_quality q ON q.event_id=e.event_id AND q.website_id=e.website_id
         JOIN liekan_event_environment env ON env.event_id=e.event_id AND env.website_id=e.website_id
         WHERE e.website_id=$1 AND e.url_path='/synthetic/preparation'`,
          [site],
        )
      ).rows;
      assert.deepEqual(
        proof,
        [{ source: 'browser', scope: 'browser', identity_available: true }],
        'candidate collector must establish trusted browser identity',
      );
    }
    result.collectorPreparation.push({ label, elapsedMs: performance.now() - started });
  }
  const diagnosticAttempts = async () =>
    Number(
      (
        await database.query(
          'SELECT COALESCE(sum(written+duplicate),0)::float8 AS attempts FROM liekan_collection_diagnostic WHERE website_id=$1',
          [current],
        )
      ).rows[0].attempts,
    );
  const diagnosticBefore = await diagnosticAttempts();
  const durationMs = smoke ? 1000 : 10000;
  async function load(target: string, site: string, rate: number, background: boolean) {
    const attempts = Math.floor((rate * durationMs) / 1000),
      pending = new Set<Promise<void>>(),
      times: number[] = [];
    const successIds = new Set<string>(),
      allIds = new Set<string>();
    let success = 0,
      failed = 0,
      skipped = 0,
      dispatched = 0,
      cookieResponses = 0,
      dispatchEnded = 0;
    const bodies = Array.from({ length: attempts }, (_, i) => ({
      type: 'event',
      payload: {
        website: site,
        eventId: randomUUID(),
        hostname: 'traffic-benchmark.invalid',
        url: `/synthetic/load/${rate}/${i}`,
      },
    }));
    for (let i = 4; i < attempts; i += 5) bodies[i] = bodies[i - 1];
    const before = Number(
      (await database.query('SELECT count(*) FROM website_event WHERE website_id=$1', [site]))
        .rows[0].count,
    );
    let observationFixture: { website_id: string; next_window: Date; epoch: string }[] = [];
    let observationStarted: Date | undefined;
    if (background) {
      // Revisit a known due synthetic window for every rate so each load includes real analysis.
      observationFixture = (
        await database.query(
          `UPDATE liekan_browser_risk_state s SET
        next_window=(SELECT max(q.created_at)+interval '1 minute' FROM liekan_event_quality q WHERE q.website_id=s.website_id),
        computed_at=NULL,error_code=NULL,next_attempt_at=clock_timestamp()
        WHERE s.website_id=ANY($1::uuid[]) RETURNING website_id,next_window,epoch::text`,
          [volumeSites],
        )
      ).rows;
      assert.equal(observationFixture.length, volumeSites.length);
      observationStarted = (await database.query('SELECT clock_timestamp() AS now')).rows[0].now;
    }
    const start = performance.now();
    const backgroundReads: Promise<void>[] = [];
    let backgroundFailure: unknown;
    let observationResources: unknown;
    if (background)
      backgroundReads.push(
        observe()
          .then(resources => {
            observationResources = resources;
          })
          .catch(error => {
            backgroundFailure = error;
          }),
      );
    for (let i = 0; i < attempts; i++) {
      const delay = start + (i * 1000) / rate - performance.now();
      if (delay > 1) await pause(delay);
      if (pending.size >= 200 || performance.now() - (start + (i * 1000) / rate) > 100) {
        skipped++;
        continue;
      }
      dispatched++;
      dispatchEnded = performance.now();
      allIds.add(bodies[i].payload.eventId);
      const task = (async () => {
        const since = performance.now();
        try {
          const response = await fetch(`${target}/api/send`, {
            method: 'POST',
            headers: benchmarkBrowserHeaders,
            body: JSON.stringify(bodies[i]),
            signal: AbortSignal.timeout(40000),
          });
          const body = await response.json();
          if (response.headers.has('set-cookie')) cookieResponses++;
          if (
            response.status === 200 &&
            body.sessionId &&
            body.visitId &&
            !response.headers.has('set-cookie')
          ) {
            success++;
            successIds.add(bodies[i].payload.eventId);
            times.push(performance.now() - since);
          } else failed++;
        } catch {
          failed++;
        }
      })();
      pending.add(task);
      void task.finally(() => pending.delete(task));
      if (background && i % Math.max(1, rate * 2) === 0)
        backgroundReads.push(
          (async () => {
            const response = await fetch(`${base}/api/liekan/websites/${site}/traffic-quality`, {
              headers,
              signal: AbortSignal.timeout(60000),
            });
            assert.equal(response.status, 200);
            const audit: any = await response.json();
            assert(audit.available);
            assert.equal(audit.totals.rawPV, audit.totals.includedPV + audit.totals.excludedPV);
            if (i === 0) {
              const end = Date.now(),
                query = new URLSearchParams({
                  startAt: String(end - 86400000),
                  endAt: String(end),
                  timezone: 'UTC',
                });
              const exported = await fetch(`${base}/api/websites/${site}/export?${query}`, {
                headers,
                signal: AbortSignal.timeout(60000),
              });
              assert.equal(exported.status, 200);
              assert(
                ((await exported.json()) as any).zip,
                'concurrent native export must complete',
              );
            }
          })().catch(error => {
            backgroundFailure = error;
          }),
        );
    }
    await Promise.all(pending);
    const elapsedMs = performance.now() - start;
    await Promise.all(backgroundReads);
    if (backgroundFailure) throw backgroundFailure;
    assert.equal(cookieResponses, 0, 'collector must preserve the cookieless response contract');
    let observation;
    if (background) {
      const windows = (
        await database.query(
          `SELECT r.website_id,w.coverage,w.events,w.epoch::text,w.rule_version,w.computed_at,s.error_code
        FROM jsonb_to_recordset($1::jsonb) AS r(website_id uuid,next_window timestamptz,epoch text)
        LEFT JOIN liekan_browser_risk_window w ON w.website_id=r.website_id AND w.window_end=r.next_window
        LEFT JOIN liekan_browser_risk_state s ON s.website_id=r.website_id`,
          [JSON.stringify(observationFixture)],
        )
      ).rows;
      assert.equal(windows.length, volumeSites.length);
      for (const row of windows) {
        assert(
          row.computed_at && +row.computed_at >= +observationStarted!,
          'each rate must compute every synthetic website window',
        );
        assert.equal(row.error_code, null, 'background analysis must not silently fail');
        assert.equal(row.rule_version, 'browser-behavior-v1');
        assert.equal(
          row.epoch,
          observationFixture.find(r => r.website_id === row.website_id)!.epoch,
        );
        assert(row.events > 0, 'observations must analyze real seeded events');
      }
      observation = {
        sites: windows.length,
        observed: windows.filter(w => w.coverage === 'observed').length,
        partial: windows.filter(w => w.coverage === 'partial').length,
        errors: 0,
        resources: observationResources,
      };
    }
    const receipts = (
      await database.query(
        'SELECT client_event_id::text FROM liekan_collection_receipt WHERE website_id=$1 AND client_event_id=ANY($2::uuid[])',
        [site, [...allIds]],
      )
    ).rows;
    const stored = new Set(receipts.map(r => r.client_event_id));
    assert(
      [...successIds].every(id => stored.has(id)),
      'each acknowledged logical event must persist',
    );
    const after = Number(
      (await database.query('SELECT count(*) FROM website_event WHERE website_id=$1', [site]))
        .rows[0].count,
    );
    assert.equal(
      after - before,
      stored.size,
      'one stored event per UUID despite concurrent retries',
    );
    return {
      rate,
      attempts,
      dispatched,
      success,
      failed,
      skipped,
      p95: percentile(times, 0.95),
      p99: percentile(times, 0.99),
      elapsedMs,
      throughput: success / (elapsedMs / 1000),
      dispatchMs: dispatchEnded - start,
      stable:
        success / attempts >= 0.99 &&
        success / (elapsedMs / 1000) >= rate * 0.9 &&
        dispatchEnded - start <= durationMs * 1.05,
      uniqueStored: stored.size,
      observation,
    };
  }
  for (const rate of [100, 500, 1000]) {
    const previous = baseline && old ? await load(baseline, old, rate, false) : null;
    const candidate = await load(base, current, rate, true);
    result.rates.push({ rate, baseline: previous, candidate });
  }
  const common = result.rates.filter((r: any) => r.candidate.stable && r.baseline?.stable);
  result.baselineAvailable = !!baseline;
  if (baseline) {
    assert(common.length, 'a stable common offered load is required');
    const paired = common.at(-1);
    result.latency = {
      rate: paired.rate,
      extraMs: paired.candidate.p95 - paired.baseline.p95,
      passed: paired.candidate.p95 - paired.baseline.p95 <= 30,
    };
    const candidateRate = Math.max(
      0,
      ...result.rates.filter((r: any) => r.candidate.stable).map((r: any) => r.rate),
    );
    const baselineRate = Math.max(
      0,
      ...result.rates.filter((r: any) => r.baseline?.stable).map((r: any) => r.rate),
    );
    result.capacity = {
      candidateRate,
      baselineRate,
      meaning: 'highest tested stable offered rate, not an extrapolated maximum',
      passed: baselineRate > 0 && candidateRate >= baselineRate * 0.9,
    };
  }
  const accepted = result.rates.reduce((n: number, r: any) => n + r.candidate.success, 0);
  const diagnosticAfter = await diagnosticAttempts();
  result.diagnostics = {
    before: diagnosticBefore,
    after: diagnosticAfter,
    delta: diagnosticAfter - diagnosticBefore,
    acknowledged: accepted,
  };
  assert(result.diagnostics.delta >= accepted, 'committed diagnostics cover acknowledged attempts');
  for (const days of [30, 90, 365]) {
    const endAt = Date.now(),
      startAt = endAt - days * 86400000,
      times: number[] = [];
    let rawPV = 0;
    const expected = (
      await database.query(
        `SELECT count(*)::float8 AS pv,count(DISTINCT session_id)::float8 AS uv FROM website_event
      WHERE website_id=$1::uuid AND created_at BETWEEN $2 AND $3 AND event_type NOT IN(2,5)`,
        [volumeSites[0], new Date(startAt), new Date(endAt)],
      )
    ).rows[0];
    for (let i = 0; i < (smoke ? 3 : 200); i++) {
      const since = performance.now();
      const response = await fetch(
        `${base}/api/liekan/websites/${volumeSites[0]}/traffic-quality?startAt=${startAt}&endAt=${endAt}`,
        { headers, signal: AbortSignal.timeout(60000) },
      );
      assert.equal(response.status, 200);
      const audit: any = await response.json();
      assert.equal(audit.totals.rawPV, audit.totals.includedPV + audit.totals.excludedPV);
      assert(audit.totals.rawUV >= audit.totals.includedUV);
      assert.equal(audit.totals.rawPV, expected.pv);
      assert.equal(audit.totals.rawUV, expected.uv);
      rawPV = audit.totals.rawPV;
      times.push(performance.now() - since);
    }
    assert(rawPV > 0, 'volume audit must exercise a populated range');
    result.queries.push({
      days,
      samples: times.length,
      p95: percentile(times, 0.95),
      p99: percentile(times, 0.99),
      rawPV,
    });
  }

  result.passed =
    result.rates.some((r: any) => r.candidate.stable) &&
    (!baseline || (result.latency.passed && result.capacity.passed));
  return result;
}
