import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import type pg from 'pg';
const browser =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
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
  observe: () => Promise<void>;
  volumeSites: string[];
}) {
  const result: any = {
    passed: false,
    rates: [],
    queries: [],
    scope: 'PostgreSQL collector, quality audit, shadow worker; isolated synthetic websites',
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
  await database.query(
    `INSERT INTO liekan_event_quality(event_id,website_id,classification,source,reasons,rule_version,range_status,hostname,created_at)
  SELECT event_id,website_id,'browser','browser','{synthetic-benchmark}','traffic-quality-v1','untrusted',hostname,date_trunc('minute',now())-interval '3 minutes'
  FROM website_event WHERE website_id=ANY($1::uuid[]) ON CONFLICT DO NOTHING`,
    [volumeSites],
  );
  await database.query(
    `INSERT INTO liekan_browser_risk_state(website_id,epoch,next_window,rule_version)
  SELECT website_id,1,date_trunc('minute',now())-interval '2 minutes','browser-behavior-v1' FROM website WHERE website_id=ANY($1::uuid[])
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
  const current = await create(),
    old = baseline ? await create() : undefined;
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
    const start = performance.now();
    const backgroundReads: Promise<void>[] = [];
    let backgroundFailure: unknown;
    if (background)
      backgroundReads.push(
        observe().catch(error => {
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
            headers: { 'Content-Type': 'application/json', 'User-Agent': browser },
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
  const diagnostic = (
    await database.query(
      'SELECT COALESCE(sum(written+duplicate),0)::float8 AS attempts FROM liekan_collection_diagnostic WHERE website_id=$1',
      [current],
    )
  ).rows[0];
  assert(
    Number(diagnostic.attempts) >= accepted,
    'committed diagnostics cover acknowledged attempts',
  );
  for (const days of [30, 90, 365]) {
    const endAt = Date.now(),
      startAt = endAt - days * 86400000,
      times: number[] = [];
    let rawPV = 0;
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
