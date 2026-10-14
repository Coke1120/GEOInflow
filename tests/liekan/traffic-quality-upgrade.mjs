import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

export async function runTrafficQualityUpgradeChecks({
  base,
  token,
  test,
  sql,
  sqlJson,
  docker,
  json,
  http,
  names,
  websiteId,
  qualityPath,
  nativePath,
  window,
}) {
  await test('quality totals match native visitor population and read-only previews preserve policy', async () => {
    const audit = (await json(`${qualityPath}?${window}`, { auth: true })).body;
    const native = (await json(`${nativePath}/stats?${window}`, { auth: true })).body;
    assert.equal(audit.totals.includedPV, Number(native.pageviews));
    assert.equal(audit.totals.includedUV, Number(native.visitors));
    assert.equal(audit.totals.rawPV, audit.totals.includedPV + audit.totals.excludedPV);
    assert.equal(audit.totals.rawUV, audit.totals.includedUV + audit.totals.fullyExcludedUV);
    const range = Object.fromEntries(new URLSearchParams(window));
    const preview = (
      await json(`${qualityPath}/preview`, {
        method: 'POST',
        auth: true,
        body: {
          policy: { mode: 'raw', allowedHostnames: [], expectedRevision: audit.policy.revision },
          range,
        },
      })
    ).body;
    assert.equal(preview.preview.includedPV, audit.totals.rawPV);
    assert.equal(preview.preview.includedUV, audit.totals.rawUV);
    const after = (await json(`${qualityPath}?${window}`, { auth: true })).body;
    assert.deepEqual(after.policy, audit.policy);
    assert.deepEqual(after.history, audit.history);
    await json(`${qualityPath}/preview`, {
      method: 'POST',
      auth: true,
      expected: 409,
      body: { policy: { mode: 'raw', allowedHostnames: [], expectedRevision: '0' }, range },
    });
  });
  await test('diagnostic writes share the event transaction and never retain raw evidence', async () => {
    const diagnostic = await sqlJson(
      `SELECT json_build_object('written',sum(written),'withUuid',sum(with_uuid),'duplicate',sum(duplicate)) FROM liekan_collection_diagnostic WHERE website_id='${websiteId}'::uuid;`,
    );
    assert(Number(diagnostic.written) > 0);
    assert(Number(diagnostic.withUuid) > 0);
    assert(Number(diagnostic.duplicate) > 0);
    const columns = await sqlJson(
      "SELECT json_agg(column_name) FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('liekan_collection_diagnostic','liekan_browser_risk','liekan_browser_risk_window');",
    );
    assert(!columns.some(name => /ip|user_agent|url_path/.test(name)));
  });
  await test('diagnostic coverage separates missing history and partial retained evidence', async () => {
    const now = Date.now();
    const historical = (
      await json(`${qualityPath}?startAt=${now - 40 * 86400000}&endAt=${now - 35 * 86400000}`, {
        auth: true,
      })
    ).body.diagnostics;
    assert.equal(historical.coverage, 'missing');
    assert.equal(historical.written, null);
    assert.equal(historical.duplicateFraction, null);
    const current = (
      await json(`${qualityPath}?startAt=${now - 86400000}&endAt=${now}`, { auth: true })
    ).body.diagnostics;
    assert.equal(current.coverage, 'partial');
    assert(current.written > 0);
  });
  const riskSite = randomUUID(),
    session = randomUUID(),
    visit = randomUUID();
  const quality = `/api/liekan/websites/${riskSite}/traffic-quality`;
  const native = `/api/websites/${riskSite}`;
  const riskRange = new URLSearchParams({
    startAt: String(Date.now() - 3600000),
    endAt: String(Date.now() + 60000),
    timezone: 'UTC',
  }).toString();
  try {
    await json('/api/websites', {
      method: 'POST',
      auth: true,
      body: { id: riskSite, name: '行为观察验收（合成数据）', domain: 'risk-fixture.invalid' },
    });
    // Keep the new site's cardinality absent from statistics throughout the bulk import.
    await sql(`ANALYZE website_event; ANALYZE liekan_event_quality;
      ALTER TABLE website_event SET (autovacuum_enabled=false);
      ALTER TABLE liekan_event_quality SET (autovacuum_enabled=false);`);
    await sql(`INSERT INTO session(session_id,website_id,created_at,browser,os,device) VALUES('${session}','${riskSite}',now()-interval '10 minutes','chrome','mac','desktop');
    INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,url_path,event_type,hostname)
      SELECT gen_random_uuid(),'${riskSite}','${session}','${visit}',date_trunc('minute',now())-interval '5 minutes'+i*interval '2 seconds','/synthetic-observation',1,'risk-fixture.invalid' FROM generate_series(0,30) i;
    INSERT INTO liekan_event_quality(event_id,website_id,classification,source,reasons,rule_version,range_status,hostname,created_at)
      SELECT event_id,website_id,'browser','browser','{browser_compatible}','traffic-quality-v1','untrusted',hostname,created_at FROM website_event WHERE website_id='${riskSite}';
    INSERT INTO liekan_browser_risk_state(website_id,epoch,next_window,rule_version) VALUES('${riskSite}',1,date_trunc('minute',now())-interval '3 minutes','browser-behavior-v1');`);
    await test('shadow worker records explanations and preserves all native totals', async () => {
      const before = (await json(`${native}/stats?${riskRange}`, { auth: true })).body;
      await docker(
        [
          'exec',
          names.application,
          'node',
          'dist/liekan-worker.mjs',
          '--observe-browser-risk-once',
        ],
        { timeout: 180000 },
      );
      const report = (await json(`${quality}/risk?${riskRange}`, { auth: true })).body;
      assert.equal(report.mode, 'observe');
      assert(report.coverage.windows >= 1);
      assert(report.findings.length >= 1);
      assert(
        report.findings.some(
          f => f.reasons.includes('regular-timing') && f.reasons.includes('repeated-path'),
        ),
      );
      assert.equal(report.impact.flaggedPV, 31);
      assert.equal(report.impact.fullyExcludedUV, 1);
      const after = (await json(`${native}/stats?${riskRange}`, { auth: true })).body;
      assert.equal(Number(before.pageviews), 31);
      assert.equal(Number(after.pageviews), 31);
      assert.equal(Number(after.visitors), 1);
      for (const filter of [
        'source=authenticated_server',
        'hostname=unrelated.invalid',
        'classification=automated',
      ]) {
        const filtered = (await json(`${quality}/risk?${riskRange}&${filter}`, { auth: true }))
          .body;
        assert.equal(filtered.findings.length, 0);
        assert.equal(filtered.impact.flaggedPV, 0);
      }
    });
    await test('window clipping stays partial with no inferred behavioral verdicts', async () => {
      await sql(`INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,url_path,event_type,hostname)
     SELECT gen_random_uuid(),'${riskSite}','${session}','${visit}',date_trunc('minute',now())-interval '3 minutes'+i*interval '1 microsecond','/synthetic-clipping',1,'risk-fixture.invalid' FROM generate_series(0,10000) i;
     INSERT INTO liekan_event_quality(event_id,website_id,classification,source,reasons,rule_version,range_status,hostname,created_at)
     SELECT event_id,website_id,'browser','browser','{browser_compatible}','traffic-quality-v1','untrusted',hostname,created_at FROM website_event e WHERE website_id='${riskSite}' AND NOT EXISTS(SELECT 1 FROM liekan_event_quality q WHERE q.event_id=e.event_id);
     UPDATE liekan_browser_risk_state SET next_window=date_trunc('minute',now())-interval '2 minutes' WHERE website_id='${riskSite}';`);
      await docker(
        [
          'exec',
          names.application,
          'node',
          'dist/liekan-worker.mjs',
          '--observe-browser-risk-once',
        ],
        { timeout: 180000 },
      );
      const latest = await sqlJson(
        `SELECT row_to_json(t) FROM (SELECT coverage,events,flagged FROM liekan_browser_risk_window WHERE website_id='${riskSite}' ORDER BY window_end DESC LIMIT 1) t;`,
      );
      assert.equal(latest.coverage, 'partial');
      assert.equal(latest.events, 10000);
      assert.equal(latest.flagged, 0);
    });
    await test('quality cursor retains microsecond ordering and rejects changed scope', async () => {
      const began = performance.now();
      const first = (await json(`${quality}?${riskRange}`, { auth: true })).body;
      assert(
        performance.now() - began < 5000,
        'stale import statistics must not cause repeated scans',
      );
      assert.equal(first.totals.rawPV, 10032);
      assert.equal(first.totals.includedPV, 10032);
      assert.equal(first.totals.rawUV, 1);
      assert.equal(first.rows.length, 100);
      assert(first.nextCursor);
      const cursor = JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString());
      assert.match(cursor.time, /\.\d{6}Z$/);
      const dst = await sqlJson(
        `BEGIN READ ONLY; SET LOCAL TimeZone='America/New_York'; SELECT json_build_array(to_char('2026-11-01T05:30:00.123456Z'::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),to_char('2026-11-01T06:30:00.123456Z'::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')); ROLLBACK;`,
      );
      assert.deepEqual(dst, ['2026-11-01T05:30:00.123456Z', '2026-11-01T06:30:00.123456Z']);
      const second = (
        await json(`${quality}?${riskRange}&cursor=${first.nextCursor}`, { auth: true })
      ).body;
      assert.equal(second.rows.length, 100);
      assert(!second.rows.some(r => first.rows.some(p => p.eventId === r.eventId)));
      await json(`${quality}?${riskRange}&classification=browser&cursor=${first.nextCursor}`, {
        auth: true,
        expected: 409,
      });
    });
    await test('concurrent policy saves reject stale revisions without losing history', async () => {
      const revision = (await json(quality, { auth: true })).body.policy.revision;
      const saves = await Promise.all(
        ['raw', 'strict'].map(mode =>
          fetch(base + quality, {
            method: 'PUT',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ mode, allowedHostnames: [], expectedRevision: revision }),
          }),
        ),
      );
      assert.deepEqual(saves.map(r => r.status).sort(), [200, 409]);
      const audit = (await json(quality, { auth: true })).body;
      assert.equal(audit.history.length, 1);
      await json(quality, {
        auth: true,
        method: 'PUT',
        body: { mode: 'standard', allowedHostnames: [], expectedRevision: audit.policy.revision },
      });
    });
    await test('a locked new website cannot block initialization or analysis of healthy websites', async () => {
      const blocked = randomUUID(),
        blockedSession = randomUUID(),
        lockName = `quality-lock-${randomUUID()}`;
      await json('/api/websites', {
        method: 'POST',
        auth: true,
        body: { id: blocked, name: '并发锁验收（合成数据）', domain: 'locked.invalid' },
      });
      let held;
      try {
        await sql(`INSERT INTO session(session_id,website_id) VALUES('${blockedSession}','${blocked}');
          INSERT INTO website_event(event_id,website_id,session_id,visit_id,event_type,created_at,url_path) VALUES(gen_random_uuid(),'${blocked}','${blockedSession}',gen_random_uuid(),1,now(),'/synthetic');
          INSERT INTO liekan_event_quality(event_id,website_id,classification,source,reasons,rule_version,range_status) SELECT event_id,website_id,'browser','browser','{}','traffic-quality-v1','untrusted' FROM website_event WHERE website_id='${blocked}';
          UPDATE liekan_browser_risk_state SET next_window=date_trunc('minute',now())-interval '2 minutes',computed_at=NULL WHERE website_id='${riskSite}';`);
        held = sql(
          `SET application_name='${lockName}'; BEGIN; SELECT website_id FROM website WHERE website_id='${blocked}' FOR UPDATE; SELECT pg_sleep(10); ROLLBACK;`,
        );
        for (let i = 0; i < 100; i++) {
          if (
            await sqlJson(
              `SELECT to_json(EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${lockName}' AND wait_event='PgSleep'));`,
            )
          )
            break;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert(
          await sqlJson(
            `SELECT to_json(EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${lockName}' AND wait_event='PgSleep'));`,
          ),
        );
        await docker(
          [
            'exec',
            names.application,
            'node',
            'dist/liekan-worker.mjs',
            '--observe-browser-risk-once',
          ],
          { timeout: 180000 },
        );
        assert(
          await sqlJson(
            `SELECT to_json(EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${lockName}' AND wait_event='PgSleep'));`,
          ),
          'worker must complete while the other website remains locked',
        );
        assert.equal(
          await sqlJson(
            `SELECT count(*)::int FROM liekan_browser_risk_state WHERE website_id='${blocked}';`,
          ),
          0,
        );
        assert(
          await sqlJson(
            `SELECT to_json(computed_at IS NOT NULL) FROM liekan_browser_risk_state WHERE website_id='${riskSite}';`,
          ),
        );
      } finally {
        await held;
        await http('/api/websites/' + blocked, { method: 'DELETE', auth: true });
      }
    });
    await test('reset fences stale observation progress and removes derived diagnostics', async () => {
      await http(`${native}/reset`, { method: 'POST', auth: true });
      await docker(
        [
          'exec',
          names.application,
          'node',
          'dist/liekan-worker.mjs',
          '--observe-browser-risk-once',
        ],
        { timeout: 180000 },
      );
      const counts = await sqlJson(
        `SELECT json_build_array((SELECT count(*) FROM liekan_browser_risk WHERE website_id='${riskSite}'),(SELECT count(*) FROM liekan_browser_risk_window WHERE website_id='${riskSite}'),(SELECT count(*) FROM liekan_browser_risk_state WHERE website_id='${riskSite}'),(SELECT count(*) FROM liekan_collection_diagnostic WHERE website_id='${riskSite}'));`,
      );
      assert.deepEqual(counts, [0, 0, 0, 0]);
    });
  } finally {
    await http(native, { method: 'DELETE', auth: true });
  }
}
