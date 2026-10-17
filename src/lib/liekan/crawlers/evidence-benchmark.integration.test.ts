// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { describe, it, expect } from 'vitest';
import { aiTransaction } from '../upstream/ai-db';
import { queryEvidence, readCrawlerEvidence } from './evidence-read';
import { readOutcomes } from './outcomes-read';
import { readPerformance } from './performance-read';
import { readObservations } from './observation-read';
import { knownCrawlerDirectory } from './directory';
const enabled =
  process.env.LIEKAN_CRAWLER_TEST === '1' && process.env.LIEKAN_EVIDENCE_BENCHMARK === '1';
describe.skipIf(!enabled)('traffic evidence capacity benchmark', () => {
  it('returns correct 100k/1m results within the approved 7/90-day budgets', async () => {
    const target = new URL(process.env.DATABASE_URL);
    if (
      target.hostname !== '127.0.0.1' ||
      target.port !== '15440' ||
      target.pathname !== '/liekan_crawler_acceptance'
    )
      throw new Error('Isolated benchmark database required');
    const site = randomUUID(),
      owner = randomUUID(),
      importId = randomUUID();
    const exec = (sql: string, ...args: unknown[]) =>
      aiTransaction(tx => tx.execute(sql, ...args), { timeout: 120000 });
    const botIds = knownCrawlerDirectory
      .filter(row => row.id)
      .slice(0, 20)
      .map(row => row.id);
    expect(botIds).toHaveLength(20);
    const endAt = Math.floor(Date.now() / 86400000) * 86400000,
      startAt = endAt - 7 * 86400000;
    const p = {
      startAt,
      endAt,
      timezone: 'UTC',
      population: 'recognized_crawlers' as const,
      dimension: 'bot' as const,
      view: 'matrix' as const,
      page: 1,
      sort: 'requests' as const,
      direction: 'desc' as const,
      crawlerIdentityScope: 'all' as const,
      crawlerMetricsVersion: 1 as const,
      sourceId: 'manual',
    };
    const report: any = {
      seed: 17017,
      runtime: JSON.parse(process.env.LIEKAN_BENCHMARK_RUNTIME || '{}'),
      cpu: cpus()[0]?.model,
      cpus: cpus().length,
      totalMemory: totalmem(),
      databaseCache: 'warm after one unmeasured query; application cache bypassed for every run',
      measurements: [],
    };
    try {
      await exec(
        "INSERT INTO \"user\"(user_id,username,password,role) VALUES($1::uuid,$2,'test-no-login','user')",
        owner,
        `benchmark-${owner}`,
      );
      await exec(
        "INSERT INTO website(website_id,name,domain,user_id) VALUES($1::uuid,'test-demo-capacity','example.com',$2::uuid)",
        site,
        owner,
      );
      await exec(
        'INSERT INTO liekan_import(id,website_id,digest,accepted,rejected) VALUES($1::uuid,$2::uuid,$3,1000000,0)',
        importId,
        site,
        'benchmark-test',
      );
      await exec(
        "INSERT INTO liekan_catalog(website_id,path,title,content_type) SELECT $1::uuid,'/page-'||n,'Test page','article' FROM generate_series(1,10000) n",
        site,
      );
      for (const size of [100000, 1000000]) {
        const from = size === 100000 ? 1 : 100001;
        await exec(
          `INSERT INTO liekan_log(id,website_id,import_id,created_at,path,method,status,bytes,ip_masked,ip_hash,user_agent,location,bot,vendor,bot_type,verification)
          SELECT md5(n::text),$1::uuid,$2::uuid,$3::timestamptz+((n*17017::bigint)%604800)*interval '1 second','/page-'||((n*17)%10000+1),CASE WHEN n%20=0 THEN 'HEAD' ELSE 'GET' END,
            CASE WHEN n%10=0 THEN 403 WHEN n%7=0 THEN 304 ELSE 200 END,n%8192,'test','test','test','','test-bot-'||(n%20),'test','训练',CASE WHEN n%3=0 THEN 'verified_range' ELSE 'unverified' END
          FROM generate_series($4::int,$5::int) n ON CONFLICT DO NOTHING`,
          site,
          importId,
          new Date(startAt),
          from,
          size,
        );
        await exec(
          `INSERT INTO liekan_crawler_evidence(website_id,log_id,crawler_id,classification_version,cache_status,measurement,edge_observation)
          SELECT $1::uuid,md5(n::text),($4::text[])[n%20+1],'benchmark-v1',CASE WHEN n%5=0 THEN NULL WHEN n%2=0 THEN 'hit' ELSE 'miss' END,
          jsonb_build_object('bytesAvailability',CASE WHEN n%10=0 THEN 'missing' ELSE 'present' END,'bytesUnit',CASE WHEN n%2=0 THEN 'edge_body' ELSE 'combined_response' END),
          CASE WHEN n%4=0 THEN NULL ELSE jsonb_build_object('fields',jsonb_build_object('edgeDurationMs',jsonb_build_object('state','present','value',n%200))) END
          FROM generate_series($2::int,$3::int) n ON CONFLICT DO NOTHING`,
          site,
          from,
          size,
          botIds,
        );
        // A repeated batch has no additional logical events.
        await exec(
          `INSERT INTO liekan_log SELECT * FROM liekan_log WHERE website_id=$1::uuid LIMIT 1000 ON CONFLICT DO NOTHING`,
          site,
        );
        await exec('ANALYZE liekan_log');
        await exec('ANALYZE liekan_crawler_evidence');
        if (size === 100000) {
          const all = await queryEvidence(
            { id: owner, role: 'user' },
            site,
            p,
            'outcomes',
            readOutcomes,
            true,
          );
          expect(all.rows.length).toBeGreaterThan(1000);
          const first = await queryEvidence(
            { id: owner, role: 'user' },
            site,
            p,
            'outcomes',
            readOutcomes,
          );
          const second = await queryEvidence(
            { id: owner, role: 'user' },
            site,
            { ...p, page: 2, snapshot: first.meta.snapshot },
            'outcomes',
            readOutcomes,
          );
          expect(first.meta.total).toBe(all.rows.length);
          expect(first.rows).toHaveLength(20);
          expect(second.rows).toHaveLength(20);
          expect(second.meta.reset).toBe(false);
          expect(second.rows).toEqual(all.rows.slice(20, 40));
        }
        for (const days of [7, 90])
          for (const [kind, reader] of [
            ['evidence', readCrawlerEvidence],
            ['performance', readPerformance],
          ] as const) {
            const values = [];
            for (let attempt = 0; attempt < 6; attempt++) {
              const started = performance.now();
              const result = await queryEvidence(
                { id: owner, role: 'user' },
                site,
                { ...p, startAt: endAt - days * 86400000 },
                kind,
                reader,
                true,
              );
              const elapsed = performance.now() - started;
              expect(result.totals.requests).toBe(size);
              if (attempt) values.push(elapsed);
            }
            const sorted = [...values].sort((a, b) => a - b),
              median = sorted[2],
              maximum = sorted[4];
            report.measurements.push({ size, days, kind, milliseconds: values, median, maximum });
            if (process.env.LIEKAN_BENCHMARK_OUTPUT)
              await writeFile(
                process.env.LIEKAN_BENCHMARK_OUTPUT,
                JSON.stringify(report, null, 2),
                { mode: 0o600 },
              );
            expect(maximum).toBeLessThan(60000);
            if (days === 7) expect(median).toBeLessThan(size === 100000 ? 5000 : 15000);
          }
      }
      const browserSession = randomUUID(),
        browserVisit = randomUUID();
      await exec(
        "INSERT INTO session(session_id,website_id,browser) VALUES($1::uuid,$2::uuid,'Chrome')",
        browserSession,
        site,
      );
      await exec(
        `INSERT INTO liekan_raw_website_event(event_id,website_id,session_id,visit_id,event_type,created_at,url_path)
        SELECT md5('observation-'||n)::uuid,$1::uuid,$2::uuid,$3::uuid,1,CASE WHEN n<=1000000 THEN now()-interval '60 days' ELSE $4::timestamptz END,'/test-observation' FROM generate_series(1,1000100) n`,
        site,
        browserSession,
        browserVisit,
        new Date(endAt - 86400000),
      );
      await exec(
        `INSERT INTO liekan_event_quality(event_id,website_id,classification,source,reasons,rule_version,range_status,created_at)
        SELECT event_id,website_id,'browser','browser',ARRAY['browser_compatible'],'traffic-quality-v2','missing',created_at FROM liekan_raw_website_event WHERE website_id=$1::uuid`,
        site,
      );
      await exec('ANALYZE website_event');
      await exec('ANALYZE liekan_event_quality');
      const observationTimes = [];
      for (let i = 0; i < 6; i++) {
        const started = performance.now();
        const observed = await queryEvidence(
          { id: owner, role: 'user' },
          site,
          { ...p, subset: 'raw' },
          'observations',
          readObservations,
          true,
        );
        expect(observed.totals.pv).toBe(100);
        if (i) observationTimes.push(performance.now() - started);
      }
      const median = [...observationTimes].sort((a, b) => a - b)[2];
      report.observationHistory = {
        historicalPv: 1000000,
        recentPv: 100,
        milliseconds: observationTimes,
        median,
      };
      if (process.env.LIEKAN_BENCHMARK_OUTPUT)
        await writeFile(process.env.LIEKAN_BENCHMARK_OUTPUT, JSON.stringify(report, null, 2), {
          mode: 0o600,
        });
      expect(median).toBeLessThan(15000);
    } finally {
      await exec('DELETE FROM liekan_crawler_evidence WHERE website_id=$1::uuid', site);
      await exec('DELETE FROM liekan_log WHERE website_id=$1::uuid', site);
      await exec('DELETE FROM liekan_import WHERE website_id=$1::uuid', site);
      await exec('DELETE FROM liekan_catalog WHERE website_id=$1::uuid', site);
      await exec('DELETE FROM website WHERE website_id=$1::uuid', site);
      await exec('DELETE FROM "user" WHERE user_id=$1::uuid', owner);
    }
  }, 900000);
});
