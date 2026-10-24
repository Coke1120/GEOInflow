// @vitest-environment node
import { appendFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Client, types } from 'pg';
import { afterAll, expect, it } from 'vitest';
import { withinQuerySnapshot } from './query-snapshot';

const enabled = process.env.LIEKAN_ANALYSIS_ROLLUPS_BENCHMARK === '1';
const folder = process.env.LIEKAN_ANALYSIS_ROLLUPS_OUTPUT;
const totalRows = Number(process.env.LIEKAN_ANALYSIS_ROLLUPS_BENCHMARK_ROWS);
const samplesPerPath = 200;
const from = new Date('2026-01-01Z');
const middle = new Date(+from + 30 * 86400000);
const until = new Date(+middle + 30 * 86400000);
const windows = [
  { name: 'comparison', startDate: from, endDate: middle },
  { name: 'current', startDate: middle, endDate: until },
];
const fields = ['summary', 'daily', 'statuses', 'hours'] as const;
const lowFields = ['daily', 'statuses', 'hours'] as const;
type Captured = { sql: string; values: unknown[] };
type Plan = Record<string, any>;
let prisma: typeof import('@/lib/prisma').default;

function canonical(value: any): any {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < 0n)
      throw new Error('benchmark-unsafe-count');
    return Number(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value))
    return value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
const checksum = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
async function evidence(name: string, value: unknown) {
  await writeFile(`${folder}/${name}`, JSON.stringify(value, null, 2), { mode: 0o600 });
}
async function progress(stage: string, details: Record<string, unknown> = {}) {
  await appendFile(
    `${folder}/benchmark-progress.jsonl`,
    `${JSON.stringify({ at: new Date().toISOString(), stage, ...details })}\n`,
    { mode: 0o600 },
  );
}
async function connect() {
  const url = new URL(process.env.DATABASE_URL || 'http://invalid');
  const schema = url.searchParams.get('schema');
  if (
    url.hostname !== '127.0.0.1' ||
    url.port !== '15462' ||
    url.pathname !== '/liekan_analysis_rollups_test' ||
    !/^analysis_[a-f0-9]+$/.test(schema || '') ||
    !folder?.includes('/.local/analysis-rollups/')
  )
    throw new Error('benchmark-owned-database-required');
  url.searchParams.delete('schema');
  const client = new Client({
    connectionString: url.toString(),
    application_name: 'liekan-isolated-rollup-benchmark',
    types: { getTypeParser: oid => (oid === 20 ? BigInt : types.getTypeParser(oid)) },
  });
  await client.connect();
  await client.query('DISCARD ALL');
  await client.query(`SET search_path TO "${schema}"`);
  await client.query("SET statement_timeout='5s'");
  await client.query("SET lock_timeout='2s'");
  return client;
}
async function snapshot<T>(work: (client: Client) => Promise<T>) {
  const client = await connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const started = performance.now();
    const value = await work(client);
    const elapsedMs = performance.now() - started;
    if (elapsedMs > 30000) throw new Error('benchmark-transaction-budget-exceeded');
    await client.query('COMMIT');
    return { value, elapsedMs };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}
function executor(client: Client, observed?: Captured[]) {
  return {
    $executeRawUnsafe: async (sql: string, ...values: unknown[]) =>
      (await client.query(sql, values)).rowCount,
    $queryRawUnsafe: async (sql: string, ...values: unknown[]) => {
      if (
        sql.includes('statistics_scope AS MATERIALIZED') ||
        /^SELECT to_char\(created_at AT TIME ZONE/.test(sql)
      )
        observed?.push({ sql, values });
      return (await client.query(sql, values)).rows;
    },
  };
}
function summary(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p: number) =>
    Number(
      sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1))].toFixed(3),
    );
  return {
    samples: sorted.length,
    minMs: percentile(0),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: percentile(1),
  };
}
function rawNodes(plan: Plan): Plan[] {
  return [
    ...(['liekan_log', 'website_event'].includes(plan['Relation Name']) ? [plan] : []),
    ...(plan.Plans || []).flatMap(rawNodes),
  ];
}
afterAll(async () => {
  if (prisma) await prisma.client.$disconnect();
});

it.skipIf(!enabled)(
  'measures exact original raw SQL and covered readers at an explicitly selected synthetic scale',
  async () => {
    if (![10000, 1000000, 10000000].includes(totalRows))
      throw new Error('benchmark-scale-required');
    const api = await import('./analysis-rollups');
    const db = await import('./analysis-rollups-db');
    const logs = await import('./logs');
    const { withPublishedRegistry } = await import('./crawler-registry-context');
    ({ default: prisma } = await import('@/lib/prisma'));
    const actor = { userId: randomUUID() },
      sites = Array.from({ length: 10 }, () => randomUUID()),
      target = sites[0];
    const rawStatements: Captured[][] = [],
      lowRawStatements: Captured[][] = [];
    const expected: any[] = [],
      lowExpected: any[] = [];
    const plans: { raw: unknown[]; covered: unknown[] } = { raw: [], covered: [] };
    let workUnits = 0;
    const fixtureMaintenance: { table: string; elapsedMs: number }[] = [];
    const started = performance.now();
    await progress('setup', { totalRows, siteCount: sites.length, selectedSite: target });
    await withPublishedRegistry(async catalog => {
      const client = await connect();
      try {
        await client.query(
          "INSERT INTO \"user\"(user_id,username,password,role) VALUES($1::uuid,$1::text,'fixture','user')",
          [actor.userId],
        );
        const identity =
          catalog.payload.identities.find(item => item.name === 'GPTBot') ||
          catalog.payload.identities[0];
        for (let siteIndex = 0; siteIndex < sites.length; siteIndex++) {
          const site = sites[siteIndex],
            imported = randomUUID(),
            rows = totalRows / 10;
          await client.query(
            "INSERT INTO website(website_id,name,domain,user_id) VALUES($1,'Synthetic scale fixture','benchmark.invalid',$2)",
            [site, actor.userId],
          );
          await client.query(
            'INSERT INTO liekan_import(id,website_id,digest,accepted,rejected) VALUES($1::uuid,$2::uuid,$1::text,$3::int,0)',
            [imported, site, rows],
          );
          for (let offset = 0; offset < rows; offset += 2000) {
            await client.query('BEGIN');
            try {
              await client.query(
                `WITH inserted AS (
              INSERT INTO liekan_log(id,website_id,import_id,created_at,path,method,status,bytes,ip_masked,ip_hash,user_agent,location,bot,vendor,bot_type,verification,ai_eligible,recognition_state)
              SELECT gen_random_uuid()::text,$1::uuid,$2::uuid,$3::timestamptz+(n::double precision/$4::double precision)*interval '60 days',
               '/synthetic/'||(n%32),'GET',CASE WHEN n%17=0 THEN 404 ELSE 200 END,0,'','',CASE WHEN n%97=0 THEN 'Liekan-Crawler-Check/benchmark' ELSE 'GPTBot/benchmark' END,'',
               'GPTBot','OpenAI','训练',CASE WHEN n%7=0 THEN 'unverified' ELSE 'verified_range' END,CASE WHEN n%13=0 THEN NULL ELSE true END,'recognized'
              FROM generate_series($5::int,least($5::int+1999,$4::int-1)) n RETURNING id,website_id
             ) INSERT INTO liekan_crawler_evidence(website_id,log_id,classification_version,crawler_id,catalog_version)
             SELECT website_id,id,'synthetic-benchmark-v1',$6,$7::uuid FROM inserted`,
                [site, imported, from, rows, offset, identity.id, catalog.version],
              );
              await client.query('COMMIT');
            } catch (error) {
              await client.query('ROLLBACK');
              throw error;
            }
          }
          await progress('seed-site', { siteIndex, rows });
        }
        await client.query("SET statement_timeout='30s'");
        try {
          for (const table of ['liekan_log', 'liekan_crawler_evidence', 'liekan_analysis_dirty']) {
            const started = performance.now();
            await client.query(`VACUUM ANALYZE ${table}`);
            fixtureMaintenance.push({ table, elapsedMs: performance.now() - started });
          }
        } finally {
          await client.query("SET statement_timeout='5s'");
        }
      } finally {
        await client.end();
      }
      // Capture the unchanged existing native statements while this site has no derived coverage.
      // Measured raw reads replay those actual statements; client/cursor metadata is outside that timing.
      for (const window of windows) {
        const captured: Captured[] = [];
        const original = await snapshot(client =>
          withinQuerySnapshot(executor(client, captured), async () => {
            const facts = await logs.getLogFacts(
              target,
              window.startDate,
              window.endDate,
              'UTC',
              1,
              '',
              '',
              '',
              'after',
              fields,
              { crawlerMetricsVersion: 1, crawlerIdentityScope: 'all' },
            );
            const series = await logs.getPlotLogs(
              target,
              window.startDate,
              window.endDate,
              'UTC',
              false,
              { crawlerMetricsVersion: 1, crawlerIdentityScope: 'all' },
            );
            return {
              facts: Object.fromEntries(fields.map(field => [field, facts[field]])),
              series,
            };
          }),
        );
        expect(captured).toHaveLength(2);
        rawStatements.push(captured);
        expected.push(canonical(original.value));
        const lowCaptured: Captured[] = [];
        const lowOriginal = await snapshot(client =>
          withinQuerySnapshot(executor(client, lowCaptured), async () => {
            const facts = await logs.getLogFacts(
              target,
              window.startDate,
              window.endDate,
              'UTC',
              1,
              '',
              '',
              '',
              'after',
              lowFields,
              { crawlerMetricsVersion: 1, crawlerIdentityScope: 'all' },
            );
            const series = await logs.getPlotLogs(
              target,
              window.startDate,
              window.endDate,
              'UTC',
              false,
              { crawlerMetricsVersion: 1, crawlerIdentityScope: 'all' },
            );
            return {
              facts: Object.fromEntries(lowFields.map(field => [field, facts[field]])),
              series,
            };
          }),
        );
        expect(lowCaptured).toHaveLength(2);
        for (const field of lowFields)
          expect(lowOriginal.value.facts[field].length).toBeGreaterThan(0);
        expect(lowOriginal.value.series.length).toBeGreaterThan(0);
        lowRawStatements.push(lowCaptured);
        lowExpected.push(canonical(lowOriginal.value));
      }
      await evidence('benchmark-original-dto.json', expected);
      const buildStarted = performance.now();
      const build = await api.createAnalysisBuild(target, actor, {
        startDate: from,
        endDate: until,
        timezone: 'UTC',
        locale: 'en-US',
        requestId: randomUUID(),
      });
      const workLimit = Math.ceil(totalRows / 10 / 2000) + 2 * 60 * 24 + 200;
      for (; workUnits < workLimit; workUnits++) {
        const [row] = await db.analysisTransaction(tx =>
          tx.$queryRawUnsafe<{ status: string; error_code: string | null }[]>(
            'SELECT status,error_code FROM liekan_analysis_build WHERE id=$1::uuid',
            build.id,
          ),
        );
        if (row.status === 'completed') break;
        if (!['queued', 'running'].includes(row.status))
          throw new Error(`benchmark-build-${row.status}-${row.error_code}`);
        await api.runOneAnalysisWorkUnit(build.id);
        if (workUnits % 100 === 0) await progress('build', { workUnits, workLimit });
      }
      if (workUnits >= workLimit) throw new Error('benchmark-build-work-bound-exceeded');
      const buildMs = performance.now() - buildStarted;
      const coveredReadFor = (selectedFields: readonly string[]) => async (client: Client) =>
        withinQuerySnapshot(executor(client), async () => {
          const results = [];
          for (const window of windows) {
            const input = {
              websiteId: target,
              startDate: window.startDate,
              endDate: window.endDate,
              timezone: 'UTC',
              crawlerMetricsVersion: 1 as const,
              fields: selectedFields,
            };
            const facts = await api.readAnalysisLogRollup(input);
            if (!facts || facts.coverage.rawFallback)
              throw new Error('benchmark-incomplete-log-coverage');
            const series = await api.readAnalysisLogSeries({ ...input, grain: 'day' });
            if (!series) throw new Error('benchmark-series-unavailable');
            results.push({
              facts: Object.fromEntries(selectedFields.map(field => [field, facts[field]])),
              series,
            });
          }
          return canonical(results);
        });
      const rawReadFor =
        (statementsByWindow: Captured[][], selectedFields: readonly string[]) =>
        async (client: Client) => {
          const results = [];
          for (const statements of statementsByWindow) {
            const [facts] = (await client.query(statements[0].sql, statements[0].values)).rows;
            const series = (await client.query(statements[1].sql, statements[1].values)).rows;
            results.push({
              facts: Object.fromEntries(
                selectedFields.map(field => [
                  field,
                  field === 'summary' ? facts.summary[0] : facts[field],
                ]),
              ),
              series,
            });
          }
          return canonical(results);
        };
      const coveredRead = coveredReadFor(fields),
        rawRead = rawReadFor(rawStatements, fields);
      const lowCoveredRead = coveredReadFor(lowFields),
        lowRawRead = rawReadFor(lowRawStatements, lowFields);
      expect((await snapshot(rawRead)).value).toEqual(expected);
      expect((await snapshot(coveredRead)).value).toEqual(expected);
      await snapshot(async client => {
        for (const statements of rawStatements)
          for (const statement of statements)
            plans.raw.push(
              (
                await client.query(
                  `EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) ${statement.sql}`,
                  statement.values,
                )
              ).rows[0]['QUERY PLAN'],
            );
        await withinQuerySnapshot(
          {
            ...executor(client),
            $queryRawUnsafe: async (sql: string, ...values: unknown[]) => {
              if (sql.includes('raw_gaps_edges') || sql.includes('series_gaps_edges')) {
                const plan = (
                  await client.query(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) ${sql}`, values)
                ).rows[0]['QUERY PLAN'];
                plans.covered.push(plan);
              }
              return (await client.query(sql, values)).rows;
            },
          },
          async () => {
            for (const window of windows) {
              const input = {
                websiteId: target,
                ...window,
                timezone: 'UTC',
                crawlerMetricsVersion: 1 as const,
                fields,
              };
              await api.readAnalysisLogRollup(input);
              await api.readAnalysisLogSeries({ ...input, grain: 'day' });
            }
          },
        );
      });
      const scans = plans.covered.flatMap((plan: any) => rawNodes(plan[0].Plan));
      expect(plans.covered).toHaveLength(4);
      expect(scans.length).toBeGreaterThan(0);
      expect(scans.every(node => node['Actual Loops'] === 0)).toBe(true);
      await evidence('benchmark-plans.json', plans);
      const rawMs: number[] = [],
        coveredMs: number[] = [];
      const expectedChecksum = checksum(expected);
      for (let sample = 0; sample < samplesPerPath; sample++) {
        // Alternate order to distribute shared-buffer warming across the two real query paths.
        for (const path of sample % 2 ? ['covered', 'raw'] : ['raw', 'covered']) {
          const result = await snapshot(path === 'raw' ? rawRead : coveredRead);
          if (checksum(result.value) !== expectedChecksum)
            throw new Error(`benchmark-dto-mismatch-${path}-${sample}`);
          (path === 'raw' ? rawMs : coveredMs).push(result.elapsedMs);
        }
        if (sample % 20 === 0) await progress('sample', { completed: sample + 1, samplesPerPath });
      }
      let lowCardinality: unknown;
      if (summary(coveredMs).p95Ms > 1000) {
        await progress('low-cardinality-sampling-start', { fields: lowFields, samplesPerPath });
        const raw: number[] = [],
          covered: number[] = [],
          lowPlans: { raw: unknown[]; covered: unknown[] } = { raw: [], covered: [] };
        const expectedLowChecksum = checksum(lowExpected);
        expect((await snapshot(lowRawRead)).value).toEqual(lowExpected);
        expect((await snapshot(lowCoveredRead)).value).toEqual(lowExpected);
        await snapshot(async client => {
          for (const statements of lowRawStatements)
            for (const statement of statements)
              lowPlans.raw.push(
                (
                  await client.query(
                    `EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) ${statement.sql}`,
                    statement.values,
                  )
                ).rows[0]['QUERY PLAN'],
              );
          await withinQuerySnapshot(
            {
              ...executor(client),
              $queryRawUnsafe: async (statement: string, ...values: unknown[]) => {
                if (statement.includes('raw_gaps_edges') || statement.includes('series_gaps_edges'))
                  lowPlans.covered.push(
                    (
                      await client.query(
                        `EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) ${statement}`,
                        values,
                      )
                    ).rows[0]['QUERY PLAN'],
                  );
                return (await client.query(statement, values)).rows;
              },
            },
            async () => {
              for (const window of windows) {
                const input = {
                  websiteId: target,
                  ...window,
                  timezone: 'UTC',
                  crawlerMetricsVersion: 1 as const,
                  fields: lowFields,
                };
                await api.readAnalysisLogRollup(input);
                await api.readAnalysisLogSeries({ ...input, grain: 'day' });
              }
            },
          );
        });
        const lowScans = lowPlans.covered.flatMap((plan: any) => rawNodes(plan[0].Plan));
        expect(lowPlans.covered).toHaveLength(4);
        expect(lowScans.length).toBeGreaterThan(0);
        expect(lowScans.every(node => node['Actual Loops'] === 0)).toBe(true);
        await evidence('benchmark-low-cardinality-plans.json', lowPlans);
        await evidence('benchmark-low-cardinality-original-dto.json', lowExpected);
        for (let sample = 0; sample < samplesPerPath; sample++) {
          for (const path of sample % 2 ? ['covered', 'raw'] : ['raw', 'covered']) {
            const value = await snapshot(path === 'raw' ? lowRawRead : lowCoveredRead);
            if (checksum(value.value) !== expectedLowChecksum)
              throw new Error(`benchmark-low-dto-mismatch-${path}-${sample}`);
            (path === 'raw' ? raw : covered).push(value.elapsedMs);
          }
          if (sample % 20 === 0)
            await progress('low-cardinality-sample', { completed: sample + 1, samplesPerPath });
        }
        lowCardinality = {
          fields: lowFields,
          includesSeries: true,
          checksum: expectedLowChecksum,
          allSamplesEqual: true,
          zeroExecutedRawScans: true,
          raw: summary(raw),
          covered: summary(covered),
          rawSamplesMs: raw,
          coveredSamplesMs: covered,
          withinOneSecondP95: summary(covered).p95Ms <= 1000,
        };
      }
      // A separate exact visit oracle retains cross-day IDs, custom-event bounce suppression and duration.
      const visitSite = sites[1],
        session = randomUUID(),
        visit = randomUUID(),
        visitIdentityVersion = 'synthetic-rollup-visit-v1';
      await snapshot(async client => {
        await client.query(
          "INSERT INTO session(session_id,website_id,browser) VALUES($1,$2,'Synthetic')",
          [session, visitSite],
        );
        await client.query(
          `INSERT INTO liekan_session_source(website_id,session_id,source,scope,identity_version,identity_available)
           VALUES($1,$2,'browser','browser',$3,true)`,
          [visitSite, session, visitIdentityVersion],
        );
        const inserted = await client.query<{ event_id: string }>(
          `WITH events AS (
       INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,hostname,url_path,event_type)
       SELECT gen_random_uuid(),$1::uuid,$2::uuid,$3::uuid,t.at,'benchmark.invalid','/visit',t.kind FROM (VALUES(timestamptz '2026-01-31T23:59:59.900Z',1),(timestamptz '2026-02-01T00:00:00.100Z',1),(timestamptz '2026-02-01T00:01:00Z',2)) t(at,kind) RETURNING event_id)
       INSERT INTO liekan_event_quality(event_id,website_id,classification,source,reasons,rule_version,range_status) SELECT event_id,$1::uuid,'browser','browser','{}','synthetic','missing' FROM events RETURNING event_id`,
          [visitSite, session, visit],
        );
        expect(inserted.rows).toHaveLength(3);
        await client.query(
          `INSERT INTO liekan_event_environment(event_id,website_id,scope,identity_version,identity_available,browser,os,device,screen,language)
           SELECT event_id,website_id,'browser',$3,true,'Synthetic','Synthetic','Synthetic','1280x720','en-US'
           FROM website_event WHERE website_id=$1 AND session_id=$2 AND event_id=ANY($4::uuid[])`,
          [visitSite, session, visitIdentityVersion, inserted.rows.map(row => row.event_id)],
        );
      });
      const { getWebsiteStats } = await import('@/queries/sql/getWebsiteStats');
      const visitWindow = {
        startDate: new Date('2026-01-31T23:00Z'),
        endDate: new Date('2026-02-01T02:00Z'),
      };
      const visitRaw = await snapshot(client =>
        withinQuerySnapshot(executor(client), () => getWebsiteStats(visitSite, visitWindow)),
      );
      const { population: visitPopulation, ...visitCounts } = visitRaw.value;
      expect(visitPopulation.identity).toMatchObject({
        status: 'complete',
        eligibleEvents: 3,
        eligiblePV: 2,
        qualifiedPV: 2,
        qualifiedVisitors: 1,
        versions: [visitIdentityVersion],
      });
      const visitBuild = await api.createAnalysisBuild(visitSite, actor, {
        ...visitWindow,
        timezone: 'UTC',
        locale: 'en-US',
        requestId: randomUUID(),
      });
      await db.analysisTransaction(tx =>
        tx.$executeRawUnsafe(
          `UPDATE liekan_analysis_build SET family='visit',work_total=3,checkpoint=jsonb_set(checkpoint,'{family}','"visit"') WHERE id=$1::uuid`,
          visitBuild.id,
        ),
      );
      for (let unit = 0; unit < 20; unit++) {
        await api.runOneAnalysisWorkUnit(visitBuild.id);
        const rows = await api.listAnalysisBuilds(visitSite, actor);
        if (rows[0].status === 'completed') break;
        if (!['queued', 'running'].includes(rows[0].status))
          throw new Error(`benchmark-visit-build-${rows[0].status}`);
      }
      const visitCovered = await api.readAnalysisVisitTotals({
        websiteId: visitSite,
        ...visitWindow,
      });
      const coveredVisitPopulation = await api.readAnalysisVisitPopulation({
        websiteId: visitSite,
        ...visitWindow,
        timezone: 'UTC',
      });
      await evidence('benchmark-visit-population.json', {
        nativePopulation: canonical(visitPopulation),
        coveredPopulation: canonical(coveredVisitPopulation),
        nativeCounts: canonical(visitCounts),
        coveredCounts: canonical(visitCovered),
      });
      expect(canonical(coveredVisitPopulation)).toEqual(canonical(visitPopulation));
      expect(canonical(visitCovered)).toEqual(canonical(visitCounts));
      expect(visitCovered).toMatchObject({
        pageviews: 2,
        visitors: 1,
        visits: 1,
        bounces: 0,
        totaltime: 0,
      });
      const status = await api.getAnalysisStatus(target, actor);
      const inventory = await snapshot(async client => {
        const population = [];
        for (const site of sites) {
          const [row] = (
            await client.query(
              `SELECT $1::uuid AS website_id,(SELECT count(*)::text FROM liekan_log WHERE website_id=$1::uuid) AS raw_rows,
        (SELECT count(*)::text FROM liekan_analysis_manifest WHERE website_id=$1::uuid AND family='log') AS log_manifests,
        (SELECT count(*)::text FROM liekan_analysis_manifest WHERE website_id=$1::uuid AND family='visit') AS visit_manifests`,
              [site],
            )
          ).rows;
          population.push(row);
        }
        const sizes = (
          await client.query(
            `WITH RECURSIVE relations(root,oid) AS (
       SELECT c.relname,c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[])
       UNION ALL SELECT r.root,i.inhrelid FROM relations r JOIN pg_inherits i ON i.inhparent=r.oid)
       SELECT root,sum(pg_total_relation_size(oid))::text AS bytes FROM relations GROUP BY root ORDER BY root`,
            [[...db.analysisTables]],
          )
        ).rows;
        const settings = (
          await client.query(
            'SELECT name,setting,unit FROM pg_settings WHERE name=ANY($1::text[]) ORDER BY name',
            [
              [
                'shared_buffers',
                'work_mem',
                'maintenance_work_mem',
                'max_parallel_workers_per_gather',
                'max_parallel_maintenance_workers',
                'max_connections',
              ],
            ],
          )
        ).rows;
        return { population, sizes, settings };
      });
      const actualRows = inventory.value.population.reduce(
        (sum, row) => sum + Number(row.raw_rows),
        0,
      );
      expect(actualRows).toBe(totalRows);
      expect(inventory.value.population.slice(1).every(row => row.log_manifests === '0')).toBe(
        true,
      );
      const result = {
        schemaVersion: 1,
        scale: totalRows === 10000 ? 'smoke' : 'scale',
        postgres: process.env.LIEKAN_ANALYSIS_ROLLUPS_PG_IMAGE || 'postgres:15-alpine',
        population: {
          totalRows: actualRows,
          siteCount: 10,
          selectedSite: target,
          selectedSiteRows: Number(inventory.value.population[0].raw_rows),
          sites: inventory.value.population,
        },
        coverage: {
          builtLogSites: [target],
          otherLogSitesBuilt: false,
          smallVisitOracleSite: visitSite,
          current: windows[1],
          comparison: windows[0],
        },
        samplesPerPath,
        resources: {
          sharedMemoryLimitBytes: 256 * 1024 ** 2,
          settings: inventory.value.settings,
          fixtureMaintenance,
          bounds: {
            seedRowsPerUnit: 2000,
            measurementStatementMs: 5000,
            buildTransactionMs: 30000,
            fixtureMaintenanceStatementMs: 30000,
          },
        },
        cacheCondition:
          'Each sample uses a fresh PostgreSQL connection, DISCARD ALL and a new repeatable-read transaction. App/result/connection-plan caches are bypassed. PostgreSQL shared buffers and OS page cache are uncontrolled; this is logical-cold measurement.',
        rawMethod:
          'Replay the actual unchanged native aggregate/series statements captured before coverage existed. Native cursor/client metadata is excluded. Covered timing uses the real rollup reader including metadata/coverage checks.',
        ordering:
          'Canonical object keys and row multisets; native same-day tie order is unspecified.',
        exact: {
          checksum: expectedChecksum,
          allSamplesEqual: true,
          visitRaw: canonical(visitRaw.value),
          visitCovered,
          coveredVisitPopulation,
          zeroExecutedRawScans: scans.every(node => node['Actual Loops'] === 0),
          rawPlanNodes: scans.length,
        },
        build: {
          elapsedMs: Number(buildMs.toFixed(3)),
          workUnits,
          rangeStart: from,
          rangeEnd: until,
        },
        reads: {
          scope:
            'Combined includes exact distinct paths in summary.pages; this total is not the isolated low-cardinality gate.',
          lowCardinality: lowCardinality || {
            status: 'not-required',
            reason: 'Combined p95 was at most one second.',
          },
          raw: summary(rawMs),
          covered: summary(coveredMs),
          rawSamplesMs: rawMs,
          coveredSamplesMs: coveredMs,
        },
        storage: {
          physicalDerivedTables: inventory.value.sizes,
          selectedSiteConservativeBytes: status.capacity.siteBytes,
          globalDerivedPhysicalBytes: status.capacity.globalBytes,
          siteLimit: status.capacity.siteLimit,
          globalLimit: status.capacity.globalLimit,
        },
        elapsedMs: Number((performance.now() - started).toFixed(3)),
        limitations: [
          'Synthetic low-cardinality distribution; high-cardinality paths are outside this benchmark.',
          'Only one of ten sites receives full log backfill.',
          'The separate visit oracle has three synthetic events and provides correctness evidence only.',
          'No storage-device cache flush or speedup threshold is applied.',
        ],
      };
      await evidence('benchmark.json', result);
      await progress('complete', { checksum: expectedChecksum, elapsedMs: result.elapsedMs });
    });
  },
  7200000,
);
