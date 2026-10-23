import { measureTrafficQuality } from './liekan-traffic-benchmark';
import { benchmarkIpHeader, seedBenchmarkBrowserEvidence } from './liekan-benchmark-fixtures';
import { promisify } from 'node:util';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import pg from 'pg';
import { formatInTimeZone } from 'date-fns-tz';
type ResultValidator = (body: any, response?: Response) => boolean | Promise<boolean>;
import {
  analyticsCacheKey,
  analyticsInfrastructureKey,
  decodeAnalyticsResult,
} from '../src/lib/liekan/upstream/query-cache';
import { installPublishedCatalogResolver } from '../src/lib/liekan/crawlers/published';
import { publishedCatalogSchema } from '../src/lib/liekan/contracts/crawler-registry';
import { AnalyticsRedis } from '../src/lib/liekan/upstream/analytics-redis';
import { timedAnalyticsClient } from '../src/lib/liekan/upstream/analytics-deadline';
import { readAnalyticsVersions } from '../src/lib/liekan/upstream/analytics-revision';
import { pageReportSchema } from '../src/lib/liekan/contracts/page-report';
import { analysisAcceptedSchema } from '../src/lib/liekan/contracts/analysis-acceleration';
import { analysisQueryParameters } from '../src/lib/liekan/upstream/analysis-query-model';
import { sharedDateRange, sharedReportSchema } from '../src/lib/liekan/contracts/shared-report';
import { Decimal } from '@prisma/client/runtime/client';
import { platform, arch, cpus, totalmem } from 'node:os';
import { measureCacheBrowser } from './liekan-cache-browser.mjs';
import { controlledCacheUnavailable } from './liekan-cache-fault';
import { pairedCacheUrls } from './liekan-cache-pair';
import {
  nativeCacheMatrix,
  geoCacheMatrix,
  assertInitialGeoTodaySources,
  verifyGeoLogsDirect,
  supplementalCacheMatrix,
  seedCacheMatrix,
  statisticsEqual,
  verifyDirectCacheFreshness,
} from './liekan-cache-matrix';

// Every mutation targets this invocation's disposable containers, volume and synthetic resources.
const args = process.argv.slice(2);
const image = args.includes('--image')
  ? args[args.indexOf('--image') + 1]
  : 'liekan:cache-loading-review';
const browserDiagnostic = args.includes('--browser-diagnostic');
const smoke = args.includes('--smoke') || browserDiagnostic;
const baselineImage = args.includes('--baseline-image')
  ? args[args.indexOf('--baseline-image') + 1]
  : undefined;
const extended = args.includes('--extended');
const samples = smoke ? 20 : 200;
const maximumRangeNonce = 800003;
const scale = args.includes('--rows') ? Number(args[args.indexOf('--rows') + 1]) : undefined;
if (scale !== undefined && ![1000000, 5000000, 10000000].includes(scale))
  throw new Error('--rows must be 1000000, 5000000 or 10000000');
const rows = smoke ? 10000 : (scale ?? (extended ? 5000000 : 1000000));
const stamp = `liekan-cache-${Date.now()}-${randomBytes(6).toString('hex')}`;
const network = `${stamp}-net`,
  volume = `${stamp}-data`,
  dbName = `${stamp}-db`,
  redisName = `${stamp}-redis`;
const created: string[] = [];
let networkCreated = false;
let volumeCreated = false;
const password = randomBytes(24).toString('hex'),
  appSecret = randomBytes(32).toString('hex');
const internalDatabase = `postgresql://bench:${password}@${dbName}:5432/bench`;
const directory = resolve('outputs', stamp);
mkdirSync(directory, { recursive: true, mode: 0o700 });
const report: any = {
  image,
  mode: browserDiagnostic ? 'browser-diagnostic' : smoke ? 'smoke' : extended ? 'extended' : 'main',
  rowsPerSource: rows,
  samplesPerScenario: samples,
  startedAt: new Date().toISOString(),
  passed: false,
  scenarios: [],
  checks: [],
};
const save = () =>
  writeFileSync(
    `${directory}/report.json`,
    JSON.stringify(report, (_, value) => (typeof value === 'bigint' ? value.toString() : value), 2),
    { mode: 0o600 },
  );
const docker = (...args: string[]) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function sourceFingerprint() {
  const hash = createHash('sha256').update(
    execFileSync('git', ['diff', '--binary', 'HEAD'], { maxBuffer: 32 * 1024 * 1024 }),
  );
  const files = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
    .sort();
  for (const file of files) hash.update(file).update(readFileSync(file));
  return hash.digest('hex');
}
function otherContainerLoad() {
  const all = docker('stats', '--no-stream', '--format', '{{json .}}')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .filter(entry => !entry.Name.startsWith(stamp));
  return {
    containers: all.length,
    totalCpuPercent: all.reduce((sum, entry) => sum + parseFloat(entry.CPUPerc), 0),
    totalMemoryBytes: all.reduce((sum, entry) => {
      const used = entry.MemUsage.split(' / ')[0];
      const match = /([0-9.]+)([A-Za-z]+)/.exec(used);
      const unit = match?.[2];
      const multiplier = {
        B: 1,
        KiB: 1024,
        MiB: 1024 ** 2,
        GiB: 1024 ** 3,
        kB: 1000,
        MB: 1000 ** 2,
        GB: 1000 ** 3,
      }[unit || ''];
      assert(match && multiplier, `unknown Docker memory unit: ${unit}`);
      return sum + Number(match[1]) * multiplier;
    }, 0),
  };
}
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
let stage = 'setup';
let database: pg.Client;
let dbConnectionString: string;
let probe: pg.Client;
async function ready(url: string) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${url}/api/heartbeat`, { signal: AbortSignal.timeout(2000) })).ok) return;
    } catch {}
    await pause(1000);
  }
  throw new Error('isolated application did not become healthy');
}
function port(name: string, internal: number) {
  return Number(docker('port', name, `${internal}/tcp`).split(':').at(-1));
}
async function startApp(name: string, connection = internalDatabase, selectedImage = image) {
  docker(
    'run',
    '-d',
    '--name',
    name,
    '--network',
    network,
    '--cpus',
    '2',
    '--memory',
    '1536m',
    '-p',
    '127.0.0.1::3000',
    '-e',
    `DATABASE_URL=${connection}`,
    '-e',
    `APP_SECRET=${appSecret}`,
    '-e',
    `TWO_FACTOR_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`,
    '-e',
    `LIEKAN_ANALYTICS_REDIS_URL=redis://${redisName}:6379`,
    '-e',
    'DISABLE_TELEMETRY=1',
    '-e',
    `CLIENT_IP_HEADER=${benchmarkIpHeader}`,
    '-e',
    'DEFAULT_LOCALE=zh-CN',
    selectedImage,
  );
  created.push(name);
  const url = `http://127.0.0.1:${port(name, 3000)}`;
  await ready(url);
  return url;
}
const percentile = (values: number[], q: number) =>
  values.length
    ? [...values].sort((a, b) => a - b)[
        Math.min(values.length - 1, Math.ceil(q * values.length) - 1)
      ]
    : null;
const requestRangeMatches = (body: any, url: string) => {
  if (!body?.range) return true;
  const query = Object.fromEntries(new URL(url, 'http://analytics-benchmark.invalid').searchParams);
  return (
    ['startAt', 'endAt'].every(key => !(key in query) || body.range[key] === Number(query[key])) &&
    (!('timezone' in query) || body.range.timezone === query.timezone)
  );
};
const sameRangeStatistics = (body: any, reference: any) =>
  statisticsEqual(
    body?.range ? { ...body, range: { ...body.range, endAt: reference.range.endAt } } : body,
    reference,
  );
const identifierPattern = String.raw`(?:"(?:[^"]|"")+"|[a-z_][a-z_0-9$]*)`;
const qualifiedIdentifierPattern = String.raw`${identifierPattern}(?:\s*\.\s*${identifierPattern})?`;
function tableReadPattern(names: string[]) {
  return String.raw`\m(?:FROM|JOIN)\M\s+(?:ONLY\M\s*\(?\s*)?(?:${identifierPattern}\s*\.\s*)?"?(?:${names.join('|')})"?(?:\s|[,);]|$)`;
}
const counterPatterns = [
  String.raw`^\s*(?:SELECT|WITH)\M`,
  tableReadPattern([
    'website_event',
    'event_data',
    'session_data',
    'session',
    'session_link',
    'revenue',
    'heatmap_event',
    'session_replay',
    'session_replay_saved',
    'liekan_effective_log',
    'liekan_log',
    'liekan_catalog',
    'liekan_import',
  ]),
  String.raw`\mGROUP\s+BY\M|\m(?:COUNT|SUM|AVG|MIN|MAX|PERCENTILE_CONT|PERCENTILE_DISC|ARRAY_AGG|JSON_AGG|JSONB_AGG|STRING_AGG|BOOL_OR|BOOL_AND)\s*\(`,
  tableReadPattern(['liekan_analytics_revision', 'liekan_log_state']),
  tableReadPattern([
    'user',
    'website',
    'share',
    'team',
    'team_user',
    'api_key',
    'link',
    'pixel',
    'board',
    'report',
    'segment',
    'liekan_setting',
    'liekan_log_source',
  ]),
  String.raw`\m(?:INSERT|MERGE)\s+INTO\M|\mDELETE\s+FROM\M|\mUPDATE\s+(?:ONLY\s+)?${qualifiedIdentifierPattern}(?:\s*\*)?(?:\s+(?:AS\s+)?${identifierPattern})?\s+SET\M|\mINTO\s+(?:(?:TEMP|TEMPORARY|UNLOGGED)\s+)?${qualifiedIdentifierPattern}`,
  tableReadPattern(['pg_stat_statements']),
];
const counterClassificationSql = `classified AS (
  SELECT query,calls,
    query ~* $1 AND query !~* $6 AND query !~* $7 AS readonly,
    query ~* $2 AS source_read,
    query ~* $3 AS aggregation,
    query ~* $4 AS version_read,
    query ~* $5 AS authorization_read
  FROM statements
)`;
const counterSql = `WITH statements AS (SELECT query,calls FROM pg_stat_statements),
  ${counterClassificationSql}
  SELECT
    COALESCE(sum(calls) FILTER (WHERE readonly AND source_read),0)::float8 AS "analyticsSourceReads",
    COALESCE(sum(calls) FILTER (WHERE readonly AND source_read AND aggregation),0)::float8 AS "aggregateStatements",
    COALESCE(sum(calls) FILTER (WHERE readonly AND NOT source_read AND version_read),0)::float8 AS revisions,
    COALESCE(sum(calls) FILTER (WHERE readonly AND NOT source_read AND authorization_read),0)::float8 AS authorization
  FROM classified`;
const counterFixtures: [string, string, boolean, boolean, boolean, boolean][] = [
  [
    'event count without grouping',
    'SELECT count(*) FROM website_event WHERE event_type=$1',
    true,
    true,
    false,
    false,
  ],
  [
    'event distinct without grouping',
    'SELECT count(DISTINCT session_id) FROM website_event',
    true,
    true,
    false,
    false,
  ],
  [
    'performance percentile',
    'SELECT percentile_cont($1) WITHIN GROUP (ORDER BY load_time) FROM website_event',
    true,
    true,
    false,
    false,
  ],
  [
    'revenue CTE',
    'WITH filtered AS (SELECT * FROM revenue) SELECT sum(amount) FROM filtered',
    true,
    true,
    false,
    false,
  ],
  [
    'heatmap grouped read',
    'SELECT x,y,count(*) FROM heatmap_event GROUP BY x,y',
    true,
    true,
    false,
    false,
  ],
  [
    'effective log aggregate',
    'SELECT count(*) FROM liekan_effective_log',
    true,
    true,
    false,
    false,
  ],
  ['raw log aggregate', 'SELECT count(*) FROM liekan_log', true, true, false, false],
  ['catalog aggregate', 'SELECT count(*) FROM liekan_catalog', true, true, false, false],
  ['import aggregate', 'SELECT count(*) FROM liekan_import', true, true, false, false],
  [
    'schema quoted session',
    'SELECT count(*) FROM "public"."session" AS s',
    true,
    true,
    false,
    false,
  ],
  ['semicolon boundary', 'SELECT count(*) FROM website_event;', true, true, false, false],
  [
    'quoted schema punctuation',
    'SELECT count(*) FROM "analytics-test"."website_event";',
    true,
    true,
    false,
    false,
  ],
  [
    'ONLY parenthesized source',
    'SELECT count(*) FROM ONLY("public"."website_event")',
    true,
    true,
    false,
    false,
  ],
  [
    'linked session aggregate',
    'SELECT min(created_at) FROM session_link GROUP BY distinct_id',
    true,
    true,
    false,
    false,
  ],
  ['linked session read', 'SELECT distinct_id FROM session_link', true, false, false, false],
  ['property read', 'SELECT * FROM "public"."event_data"', true, false, false, false],
  ['session property read', 'SELECT * FROM session_data', true, false, false, false],
  ['replay read', 'SELECT * FROM session_replay', true, false, false, false],
  ['version metadata', 'SELECT revision FROM liekan_analytics_revision', false, false, true, false],
  ['log version metadata', 'SELECT data_revision FROM liekan_log_state', false, false, true, false],
  [
    'user authorization',
    'SELECT * FROM "public"."user" WHERE user_id=$1',
    false,
    false,
    false,
    true,
  ],
  [
    'team authorization',
    'SELECT tu.role FROM team_user tu JOIN team t ON t.team_id=tu.team_id',
    false,
    false,
    false,
    true,
  ],
  ['share authorization', 'SELECT * FROM share', false, false, false, true],
  ['resource metadata', 'SELECT * FROM website', false, false, false, true],
  ['saved report metadata', 'SELECT * FROM report', false, false, false, true],
  ['saved segment metadata', 'SELECT * FROM segment', false, false, false, true],
  ['pure settings metadata', 'SELECT * FROM liekan_setting', false, false, false, true],
  ['log source metadata', 'SELECT * FROM liekan_log_source', false, false, false, true],
  [
    'aggregate joining resource metadata',
    'SELECT count(*) FROM website_event JOIN website USING(website_id)',
    true,
    true,
    false,
    false,
  ],
  ['authorization with row lock', 'SELECT * FROM website FOR UPDATE', false, false, false, true],
  [
    'similarly named metadata',
    'SELECT count(*) FROM website_event_backup',
    false,
    false,
    false,
    false,
  ],
  [
    'session word in identifier',
    'SELECT count(*) FROM authentication_session',
    false,
    false,
    false,
    false,
  ],
  ['session word in projection', 'SELECT session_id FROM "user"', false, false, false, true],
  [
    'insert statement',
    'INSERT INTO website_event SELECT * FROM website_event',
    false,
    false,
    false,
    false,
  ],
  ['update statement', 'UPDATE website SET name=$1', false, false, false, false],
  [
    'writable CTE',
    'WITH deleted AS (DELETE FROM website_event RETURNING *) SELECT count(*) FROM deleted',
    false,
    false,
    false,
    false,
  ],
  [
    'writable materialized CTE',
    'WITH changed AS MATERIALIZED (UPDATE website SET name=$1 RETURNING *) SELECT * FROM changed',
    false,
    false,
    false,
    false,
  ],
  [
    'write after read CTE',
    'WITH total AS (SELECT count(*) FROM website_event) INSERT INTO snapshot SELECT * FROM total',
    false,
    false,
    false,
    false,
  ],
  [
    'aliased update CTE',
    'WITH changed AS (UPDATE website AS w SET name=$1 RETURNING *) SELECT * FROM changed',
    false,
    false,
    false,
    false,
  ],
  [
    'quoted update alias CTE',
    'WITH w AS (UPDATE "public"."website_event" AS "e" SET event_name=$1 RETURNING *) SELECT count(*) FROM website_event',
    false,
    false,
    false,
    false,
  ],
  [
    'ONLY update CTE',
    'WITH w AS (UPDATE ONLY "public"."website_event" AS "e" SET event_name=$1 RETURNING *) SELECT count(*) FROM website_event',
    false,
    false,
    false,
    false,
  ],
  [
    'SELECT INTO table creation',
    'SELECT count(*) INTO TEMP snapshot FROM website_event',
    false,
    false,
    false,
    false,
  ],
  [
    'DDL with read',
    'CREATE TABLE snapshot AS SELECT count(*) FROM website_event',
    false,
    false,
    false,
    false,
  ],
  ['EXPLAIN', 'EXPLAIN SELECT count(*) FROM website_event', false, false, false, false],
  ['SET', 'SET LOCAL statement_timeout=$1', false, false, false, false],
  [
    'statistics observer',
    'SELECT count(*) FROM pg_stat_statements JOIN website_event ON true',
    false,
    false,
    false,
    false,
  ],
];
const fixtureSql = `WITH statements AS (
  SELECT query,1 AS calls,ordinality FROM unnest($8::text[]) WITH ORDINALITY AS q(query,ordinality)
), ${counterClassificationSql}
SELECT query,
  readonly AND source_read AS "analyticsSourceReads",
  readonly AND source_read AND aggregation AS "aggregateStatements",
  readonly AND NOT source_read AND version_read AS revisions,
  readonly AND NOT source_read AND authorization_read AS authorization
FROM classified`;

async function dbCounters() {
  return (await database.query(counterSql, counterPatterns)).rows[0];
}
async function verifyCounterClassification() {
  const classifications = (
    await database.query(fixtureSql, [
      ...counterPatterns,
      counterFixtures.map(([, query]) => query),
    ])
  ).rows;
  for (const [label, sql, ...expected] of counterFixtures) {
    const row = classifications.find(row => row.query === sql);
    assert(row, `${label}: missing counter fixture`);
    assert.deepEqual(
      [row.analyticsSourceReads, row.aggregateStatements, row.revisions, row.authorization],
      expected,
      `${label}: database statement classification`,
    );
  }
  report.checks.push({
    name: 'database-query-counter-classification',
    postgresql: 15,
    fixtures: counterFixtures.length,
    passed: true,
  });
  report.counterDefinitions = {
    analyticsSourceReads:
      'readonly SQL statement calls reading a registered analytics source table',
    aggregateStatements:
      'subset of analyticsSourceReads containing GROUP BY or an aggregate function',
    revisions:
      'persistent resource and log-state version reads, excluding statements reading analytics sources',
    authorization:
      'authorization and resource metadata reads, excluding statements reading analytics sources',
    scope: 'database-wide statement calls; overlapping background work may be included',
  };
  save();
}
async function scenario(
  name: string,
  makeUrl: (index: number) => string,
  headers: Record<string, string>,
  expectedViews?: number,
  concurrency = 1,
  options?: {
    prepare?: (index: number) => Promise<unknown>;
    validate?: ResultValidator;
    allowControlledUnavailable?: boolean;
  },
) {
  if (options?.allowControlledUnavailable)
    assert.equal(name, 'Redis-outage-bounded-computation', 'Fault allowance is Redis-outage only');
  stage = name;
  console.log(`Benchmark ${name}: ${samples} requests`);
  const outcomes: any[] = [];
  let next = 0;
  const before = await dbCounters();
  const preparationCounters = Object.fromEntries(Object.keys(before).map(key => [key, 0]));
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const index = next++;
        if (index >= samples) return;
        let start = performance.now();
        let response: Response;
        let phase = options?.prepare ? 'preparation' : 'measurement';
        try {
          if (options?.prepare) {
            assert.equal(
              concurrency,
              1,
              'shared-cache preparation and measurement counters require serial sampling',
            );
            const beforePreparation = await dbCounters();
            try {
              await options.prepare(index);
            } finally {
              const afterPreparation = await dbCounters();
              for (const key of Object.keys(afterPreparation))
                preparationCounters[key] += afterPreparation[key] - beforePreparation[key];
            }
          }
          phase = 'measurement';
          start = performance.now();
          const requestUrl = makeUrl(index);
          response = await fetch(requestUrl, {
            headers,
            signal: AbortSignal.timeout(65000),
          });
          const body = await response.json();
          const responseMs = performance.now() - start;
          const validationBegan = performance.now();
          const correct =
            response.ok &&
            requestRangeMatches(body, requestUrl) &&
            (expectedViews === undefined || Number(body.pageviews) === expectedViews) &&
            (!options?.validate || (await options.validate(body, response)));
          const controlledUnavailable =
            !!options?.allowControlledUnavailable &&
            controlledCacheUnavailable(response, body, responseMs);
          outcomes.push({
            index,
            status: response.status,
            ms: responseMs,
            validationMs: performance.now() - validationBegan,
            correct,
            controlledUnavailable,
            retryAfter: response.headers.get('retry-after'),
            tier: response.headers.get('x-liekan-cache-tier'),
            cache: response.headers.get('x-liekan-cache'),
            generatedAt: Number(response.headers.get('x-liekan-generated-at')),
            expiresAt: Number(response.headers.get('x-liekan-expires-at')),
            hasExpiry: response.headers.has('x-liekan-expires-at'),
            serverTime: Number(response.headers.get('x-liekan-server-time')),
            bytes:
              Number(response.headers.get('content-length')) ||
              Buffer.byteLength(JSON.stringify(body)),
          });
        } catch (error) {
          outcomes.push({
            index,
            status: response?.status || (error as any)?.status || 'transport-error',
            phase: response ? 'response-body' : phase,
            tier: response?.headers.get('x-liekan-cache-tier'),
            cache: response?.headers.get('x-liekan-cache'),
            ms: performance.now() - start,
            correct: false,
            reason: error instanceof Error ? error.name : 'Error',
          });
        }
      }
    }),
  );
  const after = await dbCounters();
  const entry = {
    name,
    kind: options?.allowControlledUnavailable ? 'fault' : 'normal',
    attempted: samples,
    completed: outcomes.length,
    p50: percentile(
      outcomes.map(o => o.ms),
      0.5,
    ),
    p95: percentile(
      outcomes.map(o => o.ms),
      0.95,
    ),
    p99: percentile(
      outcomes.map(o => o.ms),
      0.99,
    ),
    correct: outcomes.filter(o => o.correct).length,
    controlledUnavailable: outcomes.filter(o => o.controlledUnavailable).length,
    accepted: outcomes.filter(o => o.correct || o.controlledUnavailable).length,
    concurrency,
    preparationCounters,
    countersScope:
      'database-wide activity during sampling, including background work and any recorded day-oracle validation; preparation excluded',
    counters: Object.fromEntries(
      Object.keys(after).map(k => [k, after[k] - before[k] - preparationCounters[k]]),
    ),
    outcomes,
  };
  report.scenarios.push(entry);
  save();
  assert.equal(entry.completed, samples);
  assert.equal(
    options?.allowControlledUnavailable ? entry.accepted : entry.correct,
    samples,
    `${name}: wrong results or uncontrolled responses`,
  );
  if (name.endsWith('-uncached'))
    assert(
      outcomes.every(o => o.cache === 'miss' && o.tier === 'computed'),
      `${name}: cold path must execute computation`,
    );
  if (/-L1$|-Redis$|-preheated$/.test(name))
    assert(
      outcomes.every(
        o =>
          o.hasExpiry &&
          Number.isFinite(o.expiresAt) &&
          Number.isFinite(o.serverTime) &&
          o.expiresAt > o.serverTime,
      ),
      `${name}: reusable cache hits must retain a positive real expiry`,
    );
  if (name.endsWith('-L1') || name.endsWith('-preheated'))
    assert(
      outcomes.every(o => o.cache === 'hit' && o.tier === 'memory'),
      `${name}: warm measurement must use memory results`,
    );
  return entry;
}
async function prepareCachedResult(
  url: string,
  headers: Record<string, string>,
  validate: ResultValidator,
  index: number,
) {
  const began = performance.now();
  let response: Response;
  const evidence: any = { scenario: stage, index, path: new URL(url).pathname, correct: false };
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(65000) });
    Object.assign(evidence, {
      status: response.status,
      cache: response.headers.get('x-liekan-cache'),
      tier: response.headers.get('x-liekan-cache-tier'),
      retryAfter: response.headers.get('retry-after'),
      generatedAt: Number(response.headers.get('x-liekan-generated-at')),
      expiresAt: Number(response.headers.get('x-liekan-expires-at')),
      serverTime: Number(response.headers.get('x-liekan-server-time')),
    });
    const body = await response.json();
    evidence.correct =
      response.ok && requestRangeMatches(body, url) && (await validate(body, response));
  } catch (error) {
    Object.assign(evidence, {
      status: response?.status || 'transport-error',
      reason: error instanceof Error ? error.name : 'Error',
    });
  } finally {
    evidence.ms = performance.now() - began;
    (report.preparationResponses ||= []).push(evidence);
  }
  if (!evidence.correct)
    throw Object.assign(new Error(`Shared-cache preparation failed (${evidence.status})`), {
      name: 'CachePreparationError',
      status: evidence.status,
    });
  return evidence;
}

// A fresh, data-equivalent range starts the genuine TTL immediately before warm measurements.
async function prepareWarmResult(
  name: string,
  url: string,
  headers: Record<string, string>,
  validate: ResultValidator,
) {
  const previousStage = stage;
  stage = `${name}-L1-preparation`;
  try {
    const evidence = await prepareCachedResult(url, headers, validate, -1);
    (report.warmPreparation ||= []).push({
      name,
      query: new URL(url).search,
      ...evidence,
    });
    save();
    assert.equal(evidence.cache, 'miss', `${name}: independent warm key must begin cold`);
    assert.equal(evidence.tier, 'computed', `${name}: warm preparation must compute its snapshot`);
    assert(evidence.expiresAt > evidence.serverTime, `${name}: warm preparation must retain TTL`);
  } finally {
    stage = previousStage;
  }
}

// Keep service/module initialization visible and separate from shared-cache latency samples.
async function primeSharedRoute(
  name: string,
  url: string,
  headers: Record<string, string>,
  validate: ResultValidator,
) {
  const began = performance.now();
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(65000) });
  const body = await response.json();
  const responseMs = performance.now() - began;
  const evidence = {
    name,
    ms: responseMs,
    status: response.status,
    tier: response.headers.get('x-liekan-cache-tier'),
    correct: response.ok && requestRangeMatches(body, url) && (await validate(body, response)),
  };
  (report.servicePreparation ||= []).push(evidence);
  save();
  assert(evidence.correct, `${name}: service preparation must return correct data`);
}
let pairedSequence = 0;
/** Measure equal, data-equivalent ranges with a fresh cache lifetime for every adjacent pair. */
async function pairedBaseline(
  name: string,
  oldUrl: string,
  currentUrl: string,
  headers: Record<string, string>,
  validate: ResultValidator,
) {
  const sequence = pairedSequence++;
  const outcomes: any[] = [];
  const preparations: any[] = [];
  const comparison: any = {
    name: `${name}-L1`,
    method: 'adjacent equal per-pair ranges with alternating preparation and measurement order',
    rangeNonceBase: 600001 + sequence * 1000,
    plannedPairs: samples,
    attempted: 0,
    completed: 0,
    pairs: 0,
    concurrency: 1,
    passed: false,
    outcomes,
    preparations,
  };
  (report.baseline.pairedComparisons ||= []).push(comparison);
  const read = async (url: string) => {
    const began = performance.now();
    let response: Response;
    try {
      response = await fetch(url, { headers, signal: AbortSignal.timeout(65000) });
      const body = await response.json();
      const responseMs = performance.now() - began;
      return {
        ms: responseMs,
        status: response.status,
        correct: response.ok && requestRangeMatches(body, url) && (await validate(body, response)),
        tier: response.headers.get('x-liekan-cache-tier'),
        cache: response.headers.get('x-liekan-cache'),
        generatedAt: Number(response.headers.get('x-liekan-generated-at')),
        expiresAt: Number(response.headers.get('x-liekan-expires-at')),
        serverTime: Number(response.headers.get('x-liekan-server-time')),
      };
    } catch (error) {
      return {
        ms: performance.now() - began,
        status: response?.status || 'transport-error',
        phase: response ? 'response-body' : 'transport',
        correct: false,
        tier: response?.headers.get('x-liekan-cache-tier'),
        cache: response?.headers.get('x-liekan-cache'),
        reason: error instanceof Error ? error.name : 'Error',
      };
    }
  };
  stage = `paired-old-${name}`;
  console.log(`Benchmark adjacent old/current ${name}: ${samples} pairs`);
  for (let index = 0; index < samples; index++) {
    const pair = pairedCacheUrls(oldUrl, currentUrl, sequence, index);
    comparison.attempted++;
    const order = index % 2 === 0 ? 'old-current' : 'current-old';
    let primeOld: any, primeCurrent: any;
    if (index % 2 === 0) {
      primeOld = await read(pair.oldUrl);
      primeCurrent = await read(pair.currentUrl);
    } else {
      primeCurrent = await read(pair.currentUrl);
      primeOld = await read(pair.oldUrl);
    }
    preparations.push({ index, order, endAt: pair.endAt, old: primeOld, current: primeCurrent });
    assert(primeOld.correct && primeCurrent.correct, `${name}: paired preparation correctness`);
    assert(primeCurrent.expiresAt > primeCurrent.serverTime, `${name}: paired preparation TTL`);
    let old: any, current: any;
    if (index % 2 === 0) {
      old = await read(pair.oldUrl);
      current = await read(pair.currentUrl);
    } else {
      current = await read(pair.currentUrl);
      old = await read(pair.oldUrl);
    }
    outcomes.push({ index, order, endAt: pair.endAt, old, current });
    comparison.completed = outcomes.length;
    if (index % 50 === 0) save();
    assert(old.correct && current.correct, `${name}: paired response correctness`);
    assert(current.tier === 'memory' && current.cache === 'hit', `${name}: paired current L1 hit`);
    assert(current.expiresAt > current.serverTime, `${name}: paired measured TTL`);
  }
  assert.equal(comparison.completed, samples);
  const oldP95 = percentile(
    outcomes.map(pair => pair.old.ms),
    0.95,
  );
  const currentP95 = percentile(
    outcomes.map(pair => pair.current.ms),
    0.95,
  );
  Object.assign(comparison, {
    pairs: outcomes.length,
    oldP95,
    currentP95,
    extraMs: currentP95 - oldP95,
    passed: oldP95 >= 500 || currentP95 - oldP95 <= 30,
  });
  save();
  return comparison;
}

async function comparePreviousRoute(
  name: string,
  base: string | undefined,
  path: string,
  headers: Record<string, string>,
  validate: ResultValidator,
  currentBase: string,
) {
  if (!base) return;
  const response = await fetch(base + path, { headers });
  let body: any;
  try {
    body = JSON.parse(await response.text());
  } catch {}
  let matches = false;
  try {
    matches =
      response.ok && requestRangeMatches(body, base + path) && (await validate(body, response));
  } catch {}
  if (matches) {
    const old = await scenario(`old-${name}`, () => base + path, headers, undefined, 1, {
      validate,
    });
    report.baseline.comparisons.push({ old: old.name, current: `${name}-L1` });
    await pairedBaseline(name, base + path, currentBase + path, headers, validate);
  } else {
    (report.baseline.unmatchedContracts ||= []).push({
      name,
      status: response.status,
      reason: 'old image response contract differs; latency comparison unavailable',
    });
  }
}
const redisCommand = (...command: string[]) =>
  docker('exec', redisName, 'redis-cli', '--raw', ...command);
async function preheat(
  websiteId: string,
  target: string,
  parameters: Record<string, unknown>,
  actorId?: string,
  shareId?: string,
  scope?: any,
) {
  const registry = (
    await database.query(`SELECT v.* FROM liekan_crawler_registry_current c
    JOIN liekan_crawler_registry_version v ON v.version=c.version AND v.revision=c.revision WHERE c.id=1`)
  ).rows[0];
  assert(registry, 'preheat requires the actual published registry');
  const catalog = publishedCatalogSchema.parse({
    version: registry.version,
    revision: String(registry.revision),
    contentHash: registry.content_hash,
    publishedAt: registry.published_at.toISOString(),
    payload: registry.payload,
    state: 'published',
  });
  installPublishedCatalogResolver(() => catalog);
  const tx = {
    $queryRawUnsafe: async (sql: string, ...args: any[]) => (await database.query(sql, args)).rows,
  };
  const version = await readAnalyticsVersions(tx, [`website:${websiteId}`]);
  const namespace = `liekan:analytics:hot:${analyticsInfrastructureKey('database-v1', ['postgresql:', `${dbName}:5432`, '/bench', 'public'])}`;
  const scopeHash = analyticsInfrastructureKey('scope-v1', scope || { private: true });
  const fingerprint = analyticsCacheKey('hot-query-v1', [target, websiteId, parameters, scopeHash]);
  stage = `preheat:${target}`;
  const qualificationDeadline = Date.now() + 65000;
  for (;;) {
    const round = Number(redisCommand('PTTL', `${namespace}:${websiteId}:round`));
    const budget = Number(
      redisCommand('GET', `${namespace}:worker-budget:${Math.floor(Date.now() / 60000)}`),
    );
    if (round <= 0 && budget < 10) break;
    assert(Date.now() < qualificationDeadline, 'bounded worker budget did not become available');
    await pause(500);
  }
  const scheduledAt = Date.now();
  const job = {
    websiteId,
    target,
    parameters,
    actorId,
    shareId,
    scopeHash,
    fingerprint,
    scheduledAt,
    expectedStrongVersion: version.strong,
  };
  // The isolated harness qualifies a synthetic demand so worker execution can be measured independently of access-frequency timing.
  redisCommand(
    'HSET',
    `${namespace}:${websiteId}:counts`,
    fingerprint,
    JSON.stringify({
      visits: [scheduledAt - 60000, scheduledAt - 30000, scheduledAt],
      round: 'synthetic-benchmark',
    }),
  );
  redisCommand('ZADD', `${namespace}:${websiteId}:recent`, String(scheduledAt), fingerprint);
  redisCommand('HSET', `${namespace}:${websiteId}:tasks`, fingerprint, JSON.stringify(job));
  redisCommand('ZADD', `${namespace}:due`, String(scheduledAt), `${websiteId}|${fingerprint}`);
  const deadline = scheduledAt + 30000;
  while (Date.now() < deadline) {
    const completed = await database.query(
      "SELECT count(*)::int AS n FROM liekan_jobs.job WHERE name='liekan-analytics-refresh' AND state='completed' AND data->>'fingerprint'=$1 AND (data->>'scheduledAt')::bigint >= $2",
      [fingerprint, scheduledAt],
    );
    if (completed.rows[0].n) {
      // Remove this synthetic demand after its completed round; later scenarios retain production budgets.
      redisCommand('HDEL', `${namespace}:${websiteId}:counts`, fingerprint);
      redisCommand('ZREM', `${namespace}:${websiteId}:recent`, fingerprint);
      redisCommand('HDEL', `${namespace}:${websiteId}:tasks`, fingerprint);
      redisCommand('ZREM', `${namespace}:due`, `${websiteId}|${fingerprint}`);
      return { target, scheduledAt, fingerprint };
    }
    await pause(500);
  }
  report.preheatFailure = {
    target,
    queues: (
      await database.query(
        'SELECT name,state,count(*)::int AS jobs FROM liekan_jobs.job GROUP BY name,state ORDER BY name,state',
      )
    ).rows,
    permit: (
      await database.query(
        'SELECT epoch,lease_until,last_incremental_at,incremental_waiting_at,history_waiting_at,interactive_turns FROM liekan_analysis_background_lease',
      )
    ).rows,
    builds: (
      await database.query(
        'SELECT status,actor_id IS NULL AS incremental,count(*)::int AS builds FROM liekan_analysis_build GROUP BY status,actor_id IS NULL',
      )
    ).rows,
  };
  save();
  throw new Error('preheat did not complete');
}

async function provePreheat(
  job: { target: string; scheduledAt: number; fingerprint: string },
  url: string,
  headers: Record<string, string>,
  validate: ResultValidator,
) {
  const response = await fetch(url, { headers });
  const body = await response.json();
  const generatedAt = Number(response.headers.get('x-liekan-generated-at'));
  const tier = response.headers.get('x-liekan-cache-tier');
  const evidence = {
    name: 'worker-preheat',
    ...job,
    syntheticDemand: true,
    status: response.status,
    tier,
    generatedAt,
    correct: response.ok && requestRangeMatches(body, url) && (await validate(body, response)),
  };
  report.checks.push(evidence);
  save();
  assert(evidence.correct, 'preheated result must pass its data contract');
  assert.equal(
    tier,
    'redis',
    'preheated probe must read the shared store after clearing application memory',
  );
  assert(
    Number.isFinite(generatedAt) && generatedAt >= job.scheduledAt,
    'preheated result must have been generated by this scheduled job',
  );
}

try {
  report.head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  report.sourceFingerprint = sourceFingerprint();
  report.imageId = docker('image', 'inspect', image, '--format', '{{.Id}}');
  report.host = {
    platform: platform(),
    architecture: arch(),
    cpus: cpus().length,
    memoryBytes: totalmem(),
  };
  const [dockerCpus, dockerMemory] = docker('info', '--format', '{{.NCPU}} {{.MemTotal}}')
    .split(' ')
    .map(Number);
  report.dockerHost = { cpus: dockerCpus, memoryBytes: dockerMemory };
  report.otherContainerLoadAtStart = otherContainerLoad();
  report.containerBudgets = {
    application: { cpus: 2, memoryMiB: 1536 },
    worker: { cpus: 1, memoryMiB: 512 },
    redis: { cacheMiB: 256 },
    database: { cpus: 2, memoryMiB: 2048 },
  };
  report.seed = {
    eventRows: rows,
    logRows: rows,
    sites: 10,
    distribution:
      '365-day deterministic modulo time in hour midpoint buckets, explicitly synthetic',
  };
  const knownNetworks = docker('network', 'ls', '-q').split('\n').filter(Boolean);
  const subnets = JSON.parse(docker('network', 'inspect', ...knownNetworks)).flatMap((entry: any) =>
    (entry.IPAM.Config || []).map((config: any) => config.Subnet).filter(Boolean),
  );
  const overlap = (candidate: string, existing: string) => {
    const number = (ip: string) =>
      ip.split('.').reduce((value, octet) => (value << 8) | Number(octet), 0) >>> 0;
    if (!existing.includes('.')) return false;
    const [address, bits] = existing.split('/');
    const mask = (0xffffffff << (32 - Number(bits))) >>> 0;
    return (number(candidate) & mask) === (number(address) & mask);
  };
  const subnet = Array.from({ length: 254 }, (_, index) => `10.253.${index + 1}.0`).find(
    candidate => !subnets.some((existing: string) => overlap(candidate, existing)),
  );
  assert(subnet, 'an unused isolated Docker subnet is required');
  docker('network', 'create', '--subnet', `${subnet}/24`, network);
  report.networkSubnet = `${subnet}/24`;
  networkCreated = true;
  docker('volume', 'create', volume);
  volumeCreated = true;
  docker(
    'run',
    '-d',
    '--name',
    dbName,
    '--network',
    network,
    '-p',
    '127.0.0.1::5432',
    '--shm-size',
    '256m',
    '--cpus',
    '2',
    '--memory',
    '2g',
    '-e',
    'POSTGRES_DB=bench',
    '-e',
    'POSTGRES_USER=bench',
    '-e',
    `POSTGRES_PASSWORD=${password}`,
    '-v',
    `${volume}:/var/lib/postgresql/data`,
    'postgres:15-alpine',
    'postgres',
    '-c',
    'shared_preload_libraries=pg_stat_statements',
    '-c',
    'compute_query_id=on',
  );
  created.push(dbName);
  docker(
    'run',
    '-d',
    '--name',
    redisName,
    '--network',
    network,
    '--memory',
    '384m',
    '-p',
    '127.0.0.1::6379',
    'redis:7.4-alpine',
    'redis-server',
    '--maxmemory',
    '256mb',
    '--maxmemory-policy',
    'allkeys-lru',
    '--save',
    '',
    '--appendonly',
    'no',
  );
  created.push(redisName);
  const databaseReadyDeadline = Date.now() + 60000;
  for (;;) {
    try {
      docker('exec', dbName, 'pg_isready', '-U', 'bench', '-d', 'bench');
      break;
    } catch {}
    assert(Date.now() < databaseReadyDeadline, 'isolated database did not become ready');
    await pause(500);
  }
  const first = await startApp(`${stamp}-app1`);
  dbConnectionString = `postgresql://bench:${password}@127.0.0.1:${port(dbName, 5432)}/bench`;
  database = new pg.Client({ connectionString: dbConnectionString });
  await database.connect();
  await database.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
  await verifyCounterClassification();
  stage = 'initial-admin-login';
  const login = await fetch(`${first}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'liekan' }),
  });
  if (!login.ok) {
    report.initialLogin = { status: login.status, body: await login.json() };
    throw new Error(`Isolated initial administrator login returned ${login.status}`);
  }
  const authentication = (await login.json()) as any;
  const headers = { authorization: `Bearer ${authentication.token}` };
  const sites = Array.from({ length: 10 }, () => randomUUID());
  for (const [i, id] of sites.entries()) {
    await database.query(
      'INSERT INTO website(website_id,name,domain,user_id) VALUES($1,$2,$3,$4)',
      [id, `缓存基准合成站点 ${i + 1}`, 'analytics-benchmark.invalid', authentication.user.id],
    );
    await database.query('INSERT INTO liekan_setting(website_id,is_demo) VALUES($1,true)', [id]);
    // Isolate the existing result-cache matrix from historical maintenance; rollup scale has its own exact benchmark.
    await database.query(
      "UPDATE liekan_analysis_site SET mode='disabled' WHERE website_id=$1::uuid",
      [id],
    );
  }
  report.rollupMaintenance = {
    mode: 'disabled-for-result-cache-matrix',
    websites: sites,
    scaleSuite: 'pnpm test:analytics-rollups -- --benchmark --rows <1000000|10000000>',
  };
  console.log(
    `Seeding ${rows} synthetic events and ${rows} synthetic logs across 10 isolated sites`,
  );
  // Date offsets used for distinct cold keys remain inside the same hour and calendar buckets.
  const end = Math.floor(Date.now() / 3600000) * 3600000 + 60000;
  await database.query(
    `CREATE TEMP TABLE benchmark_sessions AS SELECT i,gen_random_uuid() AS session_id,
    ($1::uuid[])[1+((i-1)%10)] AS website_id FROM generate_series(1,$2::int) i`,
    [sites, Math.floor(rows / 10)],
  );
  await database.query(
    `INSERT INTO session(session_id,website_id,created_at,browser,os,device,country,city)
    SELECT session_id,website_id,to_timestamp($1/1000.0)-interval '365 days','chrome','mac','desktop','CN','合成城市' FROM benchmark_sessions`,
    [end],
  );
  await database.query(
    `INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,url_path,event_type,hostname,referrer_domain)
    SELECT gen_random_uuid(),s.website_id,s.session_id,s.session_id,
      date_trunc('hour',to_timestamp($1/1000.0)-(((e.i*97)%31536000)+60)*interval '1 second')+interval '30 minutes',
      '/synthetic/'||(e.i%100),1,'analytics-benchmark.invalid','chatgpt.com'
    FROM generate_series(1,$2::int) e(i) JOIN benchmark_sessions s ON s.i=1+((e.i-1)%$3::int)`,
    [end, rows, Math.floor(rows / 10)],
  );
  for (const id of sites)
    await database.query(
      `INSERT INTO liekan_import(id,website_id,digest,accepted,rejected) VALUES(gen_random_uuid(),$1,$2,$3,0)`,
      [id, analyticsCacheKey('synthetic-import', id), rows / 10],
    );
  await database.query(
    `INSERT INTO liekan_log(id,website_id,import_id,created_at,path,method,status,bytes,ip_masked,ip_hash,user_agent,location,bot,vendor,bot_type,verification)
    SELECT md5(i::text)||md5('cursor-'||i),($1::uuid[])[1+((i-1)%10)],(SELECT id FROM liekan_import WHERE website_id=($1::uuid[])[1+((i-1)%10)]),
      date_trunc('hour',to_timestamp($2/1000.0)-(((i*97)%31536000)+60)*interval '1 second')+interval '30 minutes',
      '/synthetic/'||(i%100),'GET',CASE WHEN i%10=0 THEN 404 ELSE 200 END,1024,'synthetic',md5('synthetic-'||i),
      'SyntheticBenchmarkBot','合成地区',
      CASE ((i-1)/10)%4 WHEN 0 THEN 'SyntheticTrainingBot' WHEN 1 THEN 'SyntheticSearchBot' WHEN 2 THEN 'SyntheticUserBot' ELSE '其他' END,'benchmark',
      CASE ((i-1)/10)%4 WHEN 0 THEN '训练' WHEN 1 THEN '搜索' WHEN 2 THEN '用户触发' ELSE '其他' END,'未验证' FROM generate_series(1,$3::int) i`,
    [sites, end, rows],
  );
  await database.query('ANALYZE website_event');
  await database.query('ANALYZE liekan_log');
  report.additionalSources = await seedCacheMatrix(
    database,
    rows,
    end,
    sites,
    authentication.user.id,
  );
  await seedBenchmarkBrowserEvidence(database, sites);
  for (const table of [
    'liekan_event_quality',
    'liekan_event_environment',
    'liekan_session_source',
    'liekan_session_data_source',
  ])
    await database.query(`ANALYZE ${table}`);
  report.seed.identityEvidence =
    "Explicit synthetic browser sidecars; restricted to this connection's benchmark registry and demo websites";
  report.sourceCounts = (
    await database.query(`SELECT
    (SELECT count(*)::int FROM website_event) events,(SELECT count(*)::int FROM liekan_log) logs,
    (SELECT count(*)::int FROM liekan_effective_website_event) eligibleEvents,
    (SELECT count(*)::int FROM revenue) revenue,(SELECT count(*)::int FROM heatmap_event) heatmaps,
    (SELECT count(*)::int FROM liekan_effective_log) effectiveLogs,(SELECT count(*)::int FROM liekan_catalog) catalog`)
  ).rows[0];
  const ranges = [30, 90, 365].map(days => ({
    startAt: end - days * 86400000,
    endAt: end,
    timezone: 'Asia/Shanghai',
    unit: 'day',
  }));
  const expected = async (range: any, id = sites[0]) =>
    Number(
      (
        await database.query(
          'SELECT count(*) AS count FROM website_event WHERE website_id=$1 AND event_type NOT IN (2,5) AND created_at BETWEEN to_timestamp($2/1000.0) AND to_timestamp($3/1000.0)',
          [id, range.startAt, range.endAt],
        )
      ).rows[0].count,
    );
  const maxima = (
    await database.query(`SELECT
    (SELECT max(created_at) FROM website_event) AS events,
    (SELECT max(created_at) FROM liekan_log) AS logs`)
  ).rows[0];
  assert(
    Object.values(maxima).every(value => new Date(value as any).getTime() <= end),
    'frozen statistical seed must precede the original range end',
  );
  // Report coverage clamps future bounds to its read time. Wait until every nonce is
  // historical so adjacent old/current requests describe the same frozen population.
  const rangesReadyAt = end + maximumRangeNonce;
  report.seedRange = {
    endAt: end,
    timezone: 'Asia/Shanghai',
    sourceMaxima: maxima,
    rangesReadyAt,
    clockWaitMs: Math.max(0, rangesReadyAt - Date.now()),
  };
  if (Date.now() < rangesReadyAt) {
    stage = 'frozen-fixture-clock-bound';
    save();
    console.log(`Waiting for synthetic range bounds: ${new Date(rangesReadyAt).toISOString()}`);
    while (Date.now() < rangesReadyAt) await pause(Math.min(10000, rangesReadyAt - Date.now()));
  }
  stage = 'GEO-initial-nonempty-today-and-ai-sources';
  for (const resource of ['overview', 'conversions']) {
    const parameters = new URLSearchParams({
      startAt: String(end - 365 * 86400000),
      endAt: String(end),
      timezone: 'Asia/Shanghai',
      resource,
    });
    const response = await fetch(
      `${first}/api/liekan/websites/${report.additionalSources.geoSite}/page-report?${parameters}`,
      { headers },
    );
    const body = await response.json();
    assert(response.ok && pageReportSchema.safeParse(body).success);
    (report.initialGeoSources ||= []).push({
      resource,
      range: body.range,
      states: body.states,
      cards: body.cards,
    });
    save();
    assertInitialGeoTodaySources(body);
  }
  report.checks.push({
    name: 'GEO-initial-today-fixtures',
    passed: true,
    localDay: report.additionalSources.geoSeedDay,
  });
  stage = 'GEO-log-filters-pages-cursors-and-source-interval';
  report.checks.push(
    await verifyGeoLogsDirect(first, headers, ranges[2], report.additionalSources),
  );
  save();
  let second = await startApp(`${stamp}-app2`);
  const oldBase = baselineImage
    ? await startApp(`${stamp}-baseline`, internalDatabase, baselineImage)
    : undefined;
  if (baselineImage)
    report.baseline = {
      image: baselineImage,
      imageId: docker('image', 'inspect', '--format', '{{.Id}}', baselineImage),
      comparisons: [],
    };
  const workerName = `${stamp}-worker`;
  docker(
    'run',
    '-d',
    '--name',
    workerName,
    '--network',
    network,
    '--cpus',
    '1',
    '--memory',
    '512m',
    '-e',
    `DATABASE_URL=${internalDatabase}`,
    '-e',
    `APP_SECRET=${appSecret}`,
    '-e',
    `LIEKAN_ANALYTICS_REDIS_URL=redis://${redisName}:6379`,
    image,
    'node',
    'dist/liekan-analytics-worker.mjs',
  );
  created.push(workerName);
  const renewSecond = async () => {
    docker('restart', `${stamp}-app2`);
    second = `http://127.0.0.1:${port(`${stamp}-app2`, 3000)}`;
    await ready(second);
  };
  for (const [position, range] of ranges.entries()) {
    if (browserDiagnostic) continue;
    const site = sites[position];
    const suffix = new URLSearchParams(
      Object.fromEntries(Object.entries(range).map(([key, value]) => [key, String(value)])),
    );
    const views = await expected(range, site);
    assert(views > 0);
    const path = `/api/websites/${site}/stats?${suffix}`;
    const nativeReference = await (await fetch(`${first}${path}`, { headers })).json();
    assert.equal(Number(nativeReference.pageviews), views);
    const validateNative = (body: any) => statisticsEqual(body, nativeReference);
    if (oldBase) {
      assert((await fetch(`${oldBase}${path}`, { headers })).ok);
      const old = await scenario(
        `old-native-${(range.endAt - range.startAt) / 86400000}d`,
        () => `${oldBase}${path}`,
        headers,
        views,
        1,
        { validate: validateNative },
      );
      await pairedBaseline(
        `native-${(range.endAt - range.startAt) / 86400000}d`,
        oldBase + path,
        first + path,
        headers,
        validateNative,
      );
      report.baseline.comparisons.push({
        old: old.name,
        current: `native-${(range.endAt - range.startAt) / 86400000}d-L1`,
      });
    }
    await scenario(
      `native-${(range.endAt - range.startAt) / 86400000}d-uncached`,
      i => `${first}${path}&endAt=${range.endAt + i + 1}`,
      headers,
      views,
      1,
      { validate: validateNative },
    );
    const warmUrl = `${first}${path}&endAt=${range.endAt + 5001}`;
    await prepareWarmResult(
      `native-${(range.endAt - range.startAt) / 86400000}d`,
      warmUrl,
      headers,
      validateNative,
    );
    await scenario(
      `native-${(range.endAt - range.startAt) / 86400000}d-L1`,
      () => warmUrl,
      headers,
      views,
      1,
      { validate: validateNative },
    );
    await primeSharedRoute(
      `native-${(range.endAt - range.startAt) / 86400000}d`,
      `${second}${path}`,
      headers,
      validateNative,
    );
    const sharedPath = (i: number) => `${path}&endAt=${range.endAt + i + 1001}`;
    const l2 = await scenario(
      `native-${(range.endAt - range.startAt) / 86400000}d-Redis`,
      i => `${second}${sharedPath(i)}`,
      headers,
      views,
      1,
      {
        validate: validateNative,
        prepare: async i => {
          await prepareCachedResult(`${first}${sharedPath(i)}`, headers, validateNative, i);
        },
      },
    );
    assert(
      l2.outcomes.every((o: any) => o.tier === 'redis'),
      'Redis scenario must read shared entries',
    );
    await renewSecond();
    const job = await preheat(site, 'native:stats', range, authentication.user.id);
    await provePreheat(job, `${second}${path}`, headers, validateNative);
    await scenario(
      `native-${(range.endAt - range.startAt) / 86400000}d-preheated`,
      () => `${second}${path}`,
      headers,
      views,
      1,
      { validate: validateNative },
    );
  }
  const range = ranges[2],
    p = { ...range, resource: 'human/overview', chartPeriod: '30d' };
  const page = `/api/liekan/websites/${sites[3]}/page-report?${new URLSearchParams(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)])))}`;
  const pageReference = await (await fetch(`${first}${page}`, { headers })).json();
  const validatePage = (body: any) =>
    pageReportSchema.safeParse(body).success &&
    sameRangeStatistics(body, pageReference) &&
    body.resource === 'human/overview' &&
    body.cards.some(
      (c: any) => c.label === '浏览量 PV' && Number(String(c.value).replace(/[^0-9.-]/g, '')) > 0,
    );
  await comparePreviousRoute('GEO-page', oldBase, page, headers, validatePage, first);
  await scenario(
    'GEO-page-uncached',
    i => `${first}${page}&endAt=${end + i + 1}`,
    headers,
    undefined,
    1,
    { validate: validatePage },
  );
  const pageWarmUrl = `${first}${page}&endAt=${end + 5001}`;
  await prepareWarmResult('GEO-page', pageWarmUrl, headers, validatePage);
  await scenario('GEO-page-L1', () => pageWarmUrl, headers, undefined, 1, {
    validate: validatePage,
  });
  await primeSharedRoute('GEO-page', `${second}${page}`, headers, validatePage);
  const geoL2 = await scenario(
    'GEO-page-Redis',
    i => `${second}${page}&endAt=${end + i + 1001}`,
    headers,
    undefined,
    1,
    {
      prepare: async i => {
        await prepareCachedResult(
          `${first}${page}&endAt=${end + i + 1001}`,
          headers,
          validatePage,
          i,
        );
      },
      validate: validatePage,
    },
  );
  assert(geoL2.outcomes.every((o: any) => o.tier === 'redis'));
  await renewSecond();
  const geoJob = await preheat(sites[3], 'feature:page-report', p, authentication.user.id);
  await provePreheat(geoJob, `${second}${page}`, headers, validatePage);
  await scenario('GEO-page-preheated', () => `${second}${page}`, headers, undefined, 1, {
    validate: validatePage,
  });
  const slug = `cache-${randomBytes(8).toString('hex')}`,
    shareId = randomUUID();
  await database.query(
    'INSERT INTO share(share_id,entity_id,share_type,name,slug,parameters) VALUES($1,$2,1,$3,$4,$5::jsonb)',
    [shareId, sites[4], '隔离合成分享', slug, JSON.stringify({ overview: true, goals: false })],
  );
  const publicAccess = (await (await fetch(`${first}/api/share/${slug}`)).json()) as any;
  const publicHeaders = {
    'x-umami-share-token': publicAccess.token,
    'x-umami-share-context': slug,
  };
  const publicParameters = {
    startAt: range.startAt,
    endAt: end,
    timezone: range.timezone,
    chartPeriod: '30d',
  };
  const publicPath = `/api/liekan/websites/${sites[4]}/shared-report?${new URLSearchParams(Object.fromEntries(Object.entries(publicParameters).map(([k, v]) => [k, String(v)])))}`;
  const publicReference = await (
    await fetch(`${first}${publicPath}`, { headers: publicHeaders })
  ).json();
  const validatePublic = (body: any) =>
    sharedReportSchema.safeParse(body).success &&
    sameRangeStatistics(body, publicReference) &&
    body.cards.some(
      (card: any) =>
        card.label === 'AI 蜘蛛请求' && typeof card.value === 'number' && card.value > 0,
    ) &&
    body.charts.d2.series.some((series: any) =>
      series.values.some((value: any) => typeof value === 'number' && value > 0),
    ) &&
    body.tables.cityBody.some((row: any) => row.city === 'Synthetic US City' && row.sessions > 0) &&
    body.capabilities.goals === false &&
    !body.tables.goalBody &&
    body.cards.some(
      (card: any) =>
        card.label === '浏览量 PV' && Number(String(card.value).replace(/[^0-9.-]/g, '')) > 0,
    );
  await comparePreviousRoute(
    'share-page',
    oldBase,
    publicPath,
    publicHeaders,
    validatePublic,
    first,
  );
  await scenario(
    'share-page-uncached',
    i => `${first}${publicPath}&endAt=${end + i + 1}`,
    publicHeaders,
    undefined,
    1,
    { validate: validatePublic },
  );
  const publicWarmUrl = `${first}${publicPath}&endAt=${end + 5001}`;
  await prepareWarmResult('share-page', publicWarmUrl, publicHeaders, validatePublic);
  await scenario('share-page-L1', () => publicWarmUrl, publicHeaders, undefined, 1, {
    validate: validatePublic,
  });
  await primeSharedRoute('share-page', `${second}${publicPath}`, publicHeaders, validatePublic);
  const shareL2 = await scenario(
    'share-page-Redis',
    i => `${second}${publicPath}&endAt=${end + i + 1001}`,
    publicHeaders,
    undefined,
    1,
    {
      prepare: async i => {
        await prepareCachedResult(
          `${first}${publicPath}&endAt=${end + i + 1001}`,
          publicHeaders,
          validatePublic,
          i,
        );
      },
      validate: validatePublic,
    },
  );
  assert(shareL2.outcomes.every((o: any) => o.tier === 'redis'));
  await renewSecond();
  const shareJob = await preheat(
    sites[4],
    'feature:shared-report',
    publicParameters,
    undefined,
    shareId,
    {
      shareId,
      parameters: publicAccess.parameters,
      websiteId: sites[4],
    },
  );
  await provePreheat(shareJob, `${second}${publicPath}`, publicHeaders, validatePublic);
  await scenario(
    'share-page-preheated',
    () => `${second}${publicPath}`,
    publicHeaders,
    undefined,
    1,
    { validate: validatePublic },
  );

  let matrixIndex = 0;
  for (const entry of [
    ...nativeCacheMatrix(sites),
    ...supplementalCacheMatrix(sites, report.additionalSources),
    ...geoCacheMatrix(report.additionalSources),
    {
      label: 'native-goal',
      site: sites[6],
      target: 'goals/stats',
      extra: { type: 'path', value: '/synthetic/7' },
      preheat: 'native:goals/stats',
      validate: (body: any) => Number(body.num) > 0 && Number(body.total) >= Number(body.num),
    },
    {
      label: 'native-attribution',
      site: sites[7],
      target: 'attribution',
      extra: { model: 'first-click', type: 'path', step: '/synthetic/8' },
      preheat: 'native:attribution',
      validate: (body: any) =>
        Number(body.total?.pageviews) > 0 &&
        Array.isArray(body.referrer) &&
        body.referrer.length > 0,
    },
    {
      label: 'native-breakdown',
      site: sites[8],
      target: 'breakdown',
      extra: { fields: '["country","browser"]' },
      preheat: 'native:breakdown',
      validate: (body: any) => Array.isArray(body) && body.length > 0,
    },
  ]) {
    if (browserDiagnostic) continue;
    const offset = ++matrixIndex * 10000;
    const parameters = { ...range, ...entry.extra };
    const path = `${('path' in entry && entry.path) || `/api/websites/${entry.site}/${entry.target}`}?${new URLSearchParams(Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, String(value)])))}`;
    const baselineUrl = `${first}${path}&endAt=${end + 100000}`;
    const baselineResponse = await fetch(baselineUrl, { headers });
    const baselineBody = await baselineResponse.json();
    assert(
      baselineResponse.ok &&
        requestRangeMatches(baselineBody, baselineUrl) &&
        entry.validate(baselineBody),
      `${entry.label}: nonempty source required`,
    );
    let oracleDay = formatInTimeZone(
      baselineBody.meta?.generatedAt || Date.now(),
      range.timezone,
      'yyyy-MM-dd',
    );
    const references = new Map<string, any>([[oracleDay, baselineBody]]);
    const todayResource = ['overview', 'conversions'].includes(String(entry.extra.resource));
    const validate: ResultValidator = async (body, response) => {
      const serverTime = Number(response?.headers.get('x-liekan-server-time')) || Date.now();
      const day = formatInTimeZone(serverTime, range.timezone, 'yyyy-MM-dd');
      if (todayResource && day !== oracleDay) {
        const oracleUrl = `${first}${path}&endAt=${end + 500000 + references.size}`;
        const began = performance.now();
        const response = await fetch(oracleUrl, { headers, signal: AbortSignal.timeout(65000) });
        const reference = await response.json();
        assert(
          response.ok && requestRangeMatches(reference, oracleUrl) && entry.validate(reference),
          `${entry.label}: new local-day oracle must be a correct real response`,
        );
        (report.dayOracleTransitions ||= []).push({
          name: entry.label,
          previousDay: oracleDay,
          day,
          status: response.status,
          ms: performance.now() - began,
          generatedAt: reference.meta.generatedAt,
        });
        references.set(day, reference);
        oracleDay = day;
        save();
      }
      if (!entry.validate(body)) return false;
      if (!todayResource) return sameRangeStatistics(body, baselineBody);
      const generatedAt = Number(body.meta.generatedAt);
      const expiresAt = Number(body.meta.expiresAt);
      const snapshotDay = formatInTimeZone(generatedAt, range.timezone, 'yyyy-MM-dd');
      const reference = references.get(snapshotDay);
      // A previous local-day snapshot is reusable only inside its original 30-second lifetime.
      const validOldSnapshot =
        generatedAt <= serverTime &&
        expiresAt > serverTime &&
        serverTime - generatedAt < 30000 &&
        expiresAt <= generatedAt + 30000;
      return (
        !!reference &&
        (snapshotDay === day || validOldSnapshot) &&
        sameRangeStatistics(body, reference)
      );
    };
    await comparePreviousRoute(entry.label, oldBase, path, headers, validate, first);
    await scenario(
      `${entry.label}-uncached`,
      index => `${first}${path}&endAt=${end + offset + index + 1}`,
      headers,
      undefined,
      1,
      { validate },
    );
    const warmUrl = `${first}${path}&endAt=${end + offset + 5001}`;
    await prepareWarmResult(entry.label, warmUrl, headers, validate);
    await scenario(`${entry.label}-L1`, () => warmUrl, headers, undefined, 1, {
      validate,
    });
    await primeSharedRoute(entry.label, `${second}${path}`, headers, validate);
    const l2 = await scenario(
      `${entry.label}-Redis`,
      index => `${second}${path}&endAt=${end + offset + index + 1001}`,
      headers,
      undefined,
      1,
      {
        prepare: async index => {
          await prepareCachedResult(
            `${first}${path}&endAt=${end + offset + index + 1001}`,
            headers,
            validate,
            index,
          );
        },
        validate,
      },
    );
    assert(l2.outcomes.every((outcome: any) => outcome.tier === 'redis'));
    if (!entry.preheat) {
      report.checks.push({
        name: entry.label,
        preheat: 'excluded by bounded automatic-preheat policy',
        fullFieldComparison: true,
      });
      continue;
    }
    await renewSecond();
    const job = await preheat(entry.site, entry.preheat, parameters, authentication.user.id);
    await provePreheat(job, `${second}${path}`, headers, validate);
    await scenario(`${entry.label}-preheated`, () => `${second}${path}`, headers, undefined, 1, {
      validate,
    });
  }

  const detailSite = report.additionalSources.savedSite;
  const detailEntries = [
    {
      label: 'feature-sessions-list',
      path: `/api/liekan/websites/${detailSite}/analytics`,
      extra: { kind: 'sessions', page: 1 },
      validate: (b: any) => b.rows?.length > 0 && Number(b.count) > 0,
    },
    {
      label: 'native-revenue-sessions',
      path: `/api/websites/${detailSite}/revenue/sessions`,
      extra: { currency: 'CNY', page: 1, pageSize: 25 },
      validate: (b: any) => b.data?.length > 0 && Number(b.count) > 0,
    },
    {
      label: 'native-revenue-sessions-page2',
      path: `/api/websites/${detailSite}/revenue/sessions`,
      extra: { currency: 'CNY', page: 2, pageSize: 25 },
      validate: (b: any) => b.data?.length > 0 && Number(b.page) === 2,
    },
    {
      label: 'feature-revenue-details',
      path: `/api/liekan/websites/${detailSite}/analytics`,
      extra: { kind: 'revenue', currency: 'CNY', page: 1 },
      validate: (b: any) => b.rows?.length > 0 && Number(b.count) > 0,
    },
    {
      label: 'feature-session-details',
      path: `/api/liekan/websites/${detailSite}/analytics`,
      extra: { kind: 'session', sessionId: report.additionalSources.knownSession },
      validate: (b: any) =>
        b.rows?.length > 0 &&
        b.rows.every((r: any) => r.sessionId === report.additionalSources.knownSession),
    },
    {
      label: 'feature-session-properties',
      path: `/api/liekan/websites/${detailSite}/analytics`,
      extra: { kind: 'session-properties' },
      validate: (b: any) =>
        b.rows?.some((r: any) => r.name === 'plan' && r.value === 'synthetic-plan'),
    },
    {
      label: 'feature-journey-details',
      path: `/api/liekan/websites/${detailSite}/journeys/details`,
      extra: {
        steps: 2,
        type: 'pages',
        startStep: '/synthetic/start',
        endStep: '/synthetic/finish',
        sequence: JSON.stringify(['/synthetic/start', '/synthetic/finish']),
      },
      validate: (b: any) => b.sessions?.length > 0 && Number(b.count) > 0 && b.rows?.length > 0,
    },
    {
      label: 'GEO-logs-details',
      path: `/api/liekan/websites/${detailSite}/page-report`,
      extra: { resource: 'logs' },
      validate: (b: any) => b.resource === 'logs' && b.tables?.logBody?.length > 0,
    },
  ];
  for (const entry of detailEntries) {
    const path = `${entry.path}?${new URLSearchParams(Object.fromEntries(Object.entries({ ...range, ...entry.extra }).map(([k, v]) => [k, String(v)])))}`;
    const result = await scenario(
      `${entry.label}-direct`,
      () => `${first}${path}`,
      headers,
      undefined,
      2,
      { validate: entry.validate },
    );
    assert(
      result.outcomes.every(
        (r: any) =>
          (!r.hasExpiry ||
            (Number.isFinite(r.expiresAt) &&
              Number.isFinite(r.serverTime) &&
              r.serverTime > 0 &&
              r.expiresAt <= r.serverTime)) &&
          r.cache !== 'hit',
      ),
      'detail response must have no reusable expiry',
    );
  }
  stage = 'detail-freshness-after-new-data';
  const revenuePath = `/api/liekan/websites/${detailSite}/analytics?${new URLSearchParams(Object.fromEntries(Object.entries({ ...range, kind: 'revenue', currency: 'CNY' }).map(([k, v]) => [k, String(v)])))}`;
  const beforePayment = (await (await fetch(first + revenuePath, { headers })).json()) as any;
  await database.query(
    `INSERT INTO revenue(revenue_id,website_id,session_id,event_id,event_name,currency,revenue,created_at)
    SELECT gen_random_uuid(),website_id,session_id,event_id,'synthetic-new-payment','CNY',2.3401,to_timestamp($2/1000.0)-interval '1 second'
    FROM website_event WHERE website_id=$1 AND event_type=2 LIMIT 1`,
    [detailSite, end],
  );
  const afterPayment = (await (await fetch(first + revenuePath, { headers })).json()) as any;
  assert(Number(afterPayment.count) >= Number(beforePayment.count));
  assert(
    afterPayment.rows.some(
      (r: any) => r.event === 'synthetic-new-payment' && r.amount === '2.3401',
    ),
  );
  report.checks.push({
    name: 'direct-transaction-freshness',
    newRowVisibleImmediately: true,
    decimalPreserved: true,
    aggregateCountUsesBoundedShortTtl: true,
  });
  report.checks.push(
    ...(await verifyDirectCacheFreshness(
      database,
      first,
      headers,
      range,
      report.additionalSources,
    )),
  );
  save();

  stage = 'isolated-browser-loading-and-share';
  report.browser = await measureCacheBrowser({
    base: first,
    token: authentication.token,
    site: sites[3],
    siteHandle: String(
      (await database.query('SELECT site_number FROM website WHERE website_id=$1', [sites[3]]))
        .rows[0].site_number || sites[3],
    ),
    slug,
    range,
    canonicalShareRange: sharedDateRange(),
    samples,
    directory,
  });
  save();

  const spikePath = `/api/websites/${sites[0]}/stats?${new URLSearchParams({ ...Object.fromEntries(Object.entries(range).map(([k, v]) => [k, String(v)])), endAt: String(end + 9010) })}`;
  if (!smoke) {
    stage = 'original-visual-reference';
    const credentialFile = `${directory}/synthetic-visual-credentials.env`;
    writeFileSync(credentialFile, 'LIEKAN_TEST_USERNAME=admin\nLIEKAN_TEST_PASSWORD=liekan\n', {
      mode: 0o600,
    });
    try {
      const output = execFileSync(
        process.execPath,
        ['--import', 'tsx', 'scripts/liekan-visual.mjs'],
        {
          encoding: 'utf8',
          maxBuffer: 8 * 1024 * 1024,
          env: { ...process.env, LIEKAN_URL: first, LIEKAN_TEST_CREDENTIAL_FILE: credentialFile },
        },
      );
      writeFileSync(`${directory}/visual.log`, output, { mode: 0o600 });
      report.visual = JSON.parse(readFileSync('test-results/liekan-visual/geometry.json', 'utf8'));
      assert(report.visual.passed, 'original visual reference must pass');
      save();
    } finally {
      unlinkSync(credentialFile);
    }
  }
  stage = 'fifty-cross-instance-viewers';
  // Isolate the controlled foreground burst from unrelated scheduled aggregations.
  const workerActiveBefore = (
    await database.query(
      "SELECT count(*)::int AS count FROM liekan_jobs.job WHERE name='liekan-analytics-refresh' AND state='active'",
    )
  ).rows[0].count;
  docker('stop', '--time', '40', workerName);
  const workerActiveAfter = (
    await database.query(
      "SELECT count(*)::int AS count FROM liekan_jobs.job WHERE name='liekan-analytics-refresh' AND state='active'",
    )
  ).rows[0].count;
  assert.equal(workerActiveAfter, 0, 'graceful worker pause must finish its active jobs');
  const spikeViews = await expected(range);
  const beforeSpike = await dbCounters();
  const beforeSpikeKeys = new Set(redisCommand('KEYS', 'liekan:analytics:v1:*:result').split('\n'));
  const spike = await Promise.all(
    Array.from({ length: 50 }, async (_, i) => {
      const began = performance.now();
      try {
        const response = await fetch(`${i % 2 ? first : second}${spikePath}`, {
          headers,
          signal: AbortSignal.timeout(65000),
        });
        return {
          index: i,
          ms: performance.now() - began,
          status: response.status,
          body: await response.json(),
          cache: response.headers.get('x-liekan-cache'),
          tier: response.headers.get('x-liekan-cache-tier'),
          generatedAt: Number(response.headers.get('x-liekan-generated-at')),
        };
      } catch (error) {
        return {
          index: i,
          ms: performance.now() - began,
          status: 'transport-error',
          reason: error instanceof Error ? error.name : 'Error',
        };
      }
    }),
  );
  const afterSpike = await dbCounters();
  report.checks.push({
    name: 'fifty-cross-instance-viewers',
    attempted: 50,
    successful: spike.filter(r => r.status === 200).length,
    expectedViews: spikeViews,
    workerPause: {
      isolatedForegroundBurst: true,
      activeBefore: workerActiveBefore,
      activeAfter: workerActiveAfter,
    },
    outcomes: spike.map(({ body, ...outcome }) => ({ ...outcome, pageviews: body?.pageviews })),
    aggregateStatements: afterSpike.aggregateStatements - beforeSpike.aggregateStatements,
    sharedResults: redisCommand('KEYS', 'liekan:analytics:v1:*:result')
      .split('\n')
      .filter(Boolean)
      .map(key => ({
        key,
        entry: JSON.parse(redisCommand('GET', key) || '{}'),
        ttl: Number(redisCommand('PTTL', key)),
      }))
      .filter(item => !beforeSpikeKeys.has(item.key))
      .map(({ key, entry, ttl }) => ({
        key,
        generatedAt: entry.generatedAt,
        ttl,
        value: entry.bytes
          ? decodeAnalyticsResult(Buffer.from(entry.bytes, 'base64'))
          : entry.marker,
      })),
  });
  save();
  assert(
    spike.every(
      r =>
        r.status === 200 &&
        Number(r.body?.pageviews) === spikeViews &&
        Number.isFinite(r.generatedAt) &&
        r.generatedAt > 0,
    ),
  );
  assert.equal(new Set(spike.map(r => r.generatedAt)).size, 1);
  assert(afterSpike.aggregateStatements - beforeSpike.aggregateStatements <= 2);

  stage = 'durable-async-control';
  const asyncParameters = {
    resource: p.resource,
    chartPeriod: p.chartPeriod,
    timezone: p.timezone,
    startAt: p.startAt + 112345,
    endAt: p.endAt - 123456,
  };
  analysisQueryParameters('feature:page-report', asyncParameters);
  const asyncPath = `/api/liekan/websites/${sites[3]}/page-report?${new URLSearchParams(
    Object.fromEntries(Object.entries(asyncParameters).map(([key, value]) => [key, String(value)])),
  )}`;
  const beforeAsyncControl = await dbCounters();
  const asyncOutcomes: Array<{ status: number; ms: number; jobId: string }> = [];
  for (let index = 0; index < samples; index++) {
    const began = performance.now();
    const response = await fetch(`${index % 2 ? first : second}${asyncPath}`, {
      headers: { ...headers, Prefer: 'respond-async' },
      signal: AbortSignal.timeout(10000),
    });
    const body = await response.json();
    asyncOutcomes.push({
      status: response.status,
      ms: performance.now() - began,
      jobId: body.analysisJob?.id,
    });
    report.asyncControl = { samples, outcomes: asyncOutcomes, workerPaused: true, passed: false };
    save();
    assert.equal(response.status, 202, 'a cold asynchronous report must return a control response');
    const accepted = analysisAcceptedSchema.parse(body);
    assert.equal(accepted.analysisJob.status, 'queued');
    assert.equal(response.headers.get('retry-after'), '3');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
  const afterAsyncControl = await dbCounters();
  assert.equal(new Set(asyncOutcomes.map(outcome => outcome.jobId)).size, 1);
  assert.equal(afterAsyncControl.aggregateStatements - beforeAsyncControl.aggregateStatements, 0);
  const asyncJob = asyncOutcomes[0].jobId;
  const queued = (
    await database.query(
      'SELECT status,attempts FROM liekan_analysis_query WHERE website_id=$1::uuid AND id=$2::uuid',
      [sites[3], asyncJob],
    )
  ).rows;
  assert.deepEqual(queued, [{ status: 'queued', attempts: 0 }]);
  const controlP95 = percentile(
    asyncOutcomes.map(outcome => outcome.ms),
    0.95,
  );
  assert(
    controlP95 !== null && controlP95 <= 500,
    'asynchronous control p95 must stay within 500ms',
  );
  const completionBegan = performance.now();
  docker('start', workerName);
  let asyncResult: any;
  for (;;) {
    const response = await fetch(
      `${first}/api/liekan/websites/${sites[3]}/analytics-jobs/${asyncJob}/result`,
      { headers, signal: AbortSignal.timeout(10000) },
    );
    const body = await response.json();
    if (response.status === 200) {
      asyncResult = pageReportSchema.parse(body);
      break;
    }
    assert.equal(response.status, 202, 'durable report must complete without an error response');
    assert.equal(analysisAcceptedSchema.parse(body).analysisJob.id, asyncJob);
    assert(performance.now() - completionBegan < 120000, 'durable report did not complete in time');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const completionMs = performance.now() - completionBegan;
  assert(requestRangeMatches(asyncResult, asyncPath));
  const exactResponse = await fetch(`${first}${asyncPath}&refresh=1`, {
    headers,
    signal: AbortSignal.timeout(65000),
  });
  assert.equal(exactResponse.status, 200);
  const exactResult = pageReportSchema.parse(await exactResponse.json());
  writeFileSync(
    resolve(directory, 'async-control-result.json'),
    JSON.stringify(asyncResult, null, 2),
    { mode: 0o600 },
  );
  writeFileSync(
    resolve(directory, 'async-control-exact.json'),
    JSON.stringify(exactResult, null, 2),
    { mode: 0o600 },
  );
  assert(
    sameRangeStatistics(asyncResult, exactResult),
    'asynchronous DTO must match the precise report',
  );
  assert(
    asyncResult.cards.some(
      card => card.label === '浏览量 PV' && Number(String(card.value).replace(/[^0-9.-]/g, '')) > 0,
    ),
  );
  const completed = (
    await database.query('SELECT status,attempts FROM liekan_analysis_query WHERE id=$1::uuid', [
      asyncJob,
    ])
  ).rows;
  assert.deepEqual(completed, [{ status: 'ready', attempts: 1 }]);
  docker('stop', '--time', '40', workerName);
  report.asyncControl = {
    ...report.asyncControl,
    p95Ms: controlP95,
    aggregateStatements:
      afterAsyncControl.aggregateStatements - beforeAsyncControl.aggregateStatements,
    durableComputations: completed.length,
    attempts: completed[0].attempts,
    completionMs,
    exactDtoEqual: true,
    passed: true,
  };
  save();

  stage = 'manual-refresh-publishes-normal-result';
  const manualRange = {
    startAt: end - 86400000,
    endAt: end + maximumRangeNonce,
    timezone: range.timezone,
  };
  const cardViews = (body: any) =>
    Number(
      String(body.cards.find((card: any) => card.label === '浏览量 PV').value).replace(
        /[^0-9.-]/g,
        '',
      ),
    );
  for (const entry of [
    {
      name: 'native-stats',
      site: sites[0],
      path: `/api/websites/${sites[0]}/stats`,
      extra: {},
      access: headers,
      metric: (body: any) => Number(body.pageviews),
    },
    {
      name: 'private-page-report',
      site: sites[3],
      path: `/api/liekan/websites/${sites[3]}/page-report`,
      extra: { resource: 'human/overview', chartPeriod: '30d' },
      access: headers,
      metric: cardViews,
    },
    {
      name: 'public-shared-report',
      site: sites[4],
      path: `/api/liekan/websites/${sites[4]}/shared-report`,
      extra: { chartPeriod: '30d' },
      access: publicHeaders,
      metric: cardViews,
    },
    {
      name: 'feature-events',
      site: sites[5],
      path: `/api/liekan/websites/${sites[5]}/analytics`,
      extra: { kind: 'events' },
      access: headers,
      metric: (body: any) => Number(body.totals.total),
    },
  ]) {
    const url = `${first}${entry.path}?${new URLSearchParams(Object.fromEntries(Object.entries({ ...manualRange, ...entry.extra }).map(([key, value]) => [key, String(value)])))}`;
    const read = async (target: string) => {
      const response = await fetch(target, {
        headers: entry.access,
        signal: AbortSignal.timeout(65000),
      });
      const body = await response.json();
      assert(
        response.ok && requestRangeMatches(body, target),
        `${entry.name}: valid manual-refresh response`,
      );
      return {
        body,
        cache: response.headers.get('x-liekan-cache'),
        tier: response.headers.get('x-liekan-cache-tier'),
        generatedAt: Number(response.headers.get('x-liekan-generated-at')),
        expiresAt: Number(response.headers.get('x-liekan-expires-at')),
        serverTime: Number(response.headers.get('x-liekan-server-time')),
      };
    };
    const before = await read(url);
    assert(Number.isFinite(entry.metric(before.body)));
    const versions = () =>
      database
        .query(
          "SELECT revision::text FROM liekan_analytics_revision WHERE resource_type='website' AND resource_id=$1",
          [entry.site],
        )
        .then(result => result.rows);
    const priorVersions = await versions();
    const inserted = await database.query(
      `INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,url_path,event_type,event_name,hostname)
       SELECT gen_random_uuid(),website_id,session_id,gen_random_uuid(),to_timestamp($2/1000.0)-interval '2 seconds',
         '/synthetic/manual-refresh',$3,CASE WHEN $3=2 THEN 'synthetic-manual-refresh' END,'analytics-benchmark.invalid'
       FROM session WHERE website_id=$1 ORDER BY session_id LIMIT 1 RETURNING event_id`,
      [entry.site, end, entry.name === 'feature-events' ? 2 : 1],
    );
    assert.equal(inserted.rowCount, 1);
    await seedBenchmarkBrowserEvidence(
      database,
      [entry.site],
      inserted.rows.map(row => row.event_id),
    );
    assert.deepEqual(
      await versions(),
      priorVersions,
      'tracker-like data write must preserve strong version',
    );
    const cachedBeforeForce = await read(url);
    assert.equal(cachedBeforeForce.cache, 'hit');
    assert.equal(entry.metric(cachedBeforeForce.body), entry.metric(before.body));
    const forced = await read(`${url}&refresh=1`);
    assert.equal(entry.metric(forced.body), entry.metric(before.body) + 1);
    assert.equal(forced.cache, 'miss');
    assert(forced.generatedAt > before.generatedAt);
    const normal = await read(url);
    const remote = await read(url.replace(first, second));
    for (const result of [normal, remote]) {
      assert.equal(result.cache, 'hit');
      assert.equal(result.generatedAt, forced.generatedAt);
      assert(result.expiresAt > result.serverTime);
      assert(
        statisticsEqual(result.body, forced.body),
        `${entry.name}: normal read must reuse forced data`,
      );
    }
    assert.equal(normal.tier, 'memory');
    assert.equal(remote.tier, 'redis');
    report.checks.push({
      name: `manual-refresh-${entry.name}`,
      passed: true,
      before: entry.metric(before.body),
      after: entry.metric(normal.body),
      forcedGeneration: forced.generatedAt,
      normalGeneration: normal.generatedAt,
      remoteGeneration: remote.generatedAt,
      normalTier: normal.tier,
      remoteTier: remote.tier,
      unchangedStrongVersion: true,
    });
    save();
  }
  docker('start', workerName);
  const changed = await fetch(`${first}/api/websites/${sites[0]}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '缓存基准更新后的站点', domain: 'analytics-benchmark.invalid' }),
  });
  assert(changed.ok);
  const freshAfterWrite = await fetch(`${second}${spikePath}`, { headers });
  assert(freshAfterWrite.ok);
  assert.equal(freshAfterWrite.headers.get('x-liekan-cache'), 'miss');
  report.checks.push({
    name: 'cross-instance-primary-strong-version-after-write',
    cache: freshAfterWrite.headers.get('x-liekan-cache'),
  });

  stage = 'cross-instance-primary-team-revocation';
  const memberPassword = randomBytes(20).toString('hex');
  const memberId = randomUUID(),
    teamId = randomUUID();
  const createdMember = await fetch(`${first}/api/users`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: memberId,
      username: 'synthetic-cache-member',
      password: memberPassword,
      role: 'user',
    }),
  });
  assert(createdMember.ok);
  await database.query('INSERT INTO team(team_id,name) VALUES($1,$2)', [
    teamId,
    '缓存基准合成团队',
  ]);
  await database.query(
    'INSERT INTO team_user(team_user_id,team_id,user_id,role) VALUES($1,$2,$3,$4)',
    [randomUUID(), teamId, memberId, 'team-member'],
  );
  await database.query('UPDATE website SET user_id=NULL,team_id=$2 WHERE website_id=$1', [
    sites[9],
    teamId,
  ]);
  const memberLogin = await fetch(`${first}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'synthetic-cache-member', password: memberPassword }),
  });
  assert(memberLogin.ok);
  const memberAuth = (await memberLogin.json()) as any;
  const memberHeaders = { authorization: `Bearer ${memberAuth.token}` };
  const memberPath = `/api/websites/${sites[9]}/stats?${new URLSearchParams(Object.fromEntries(Object.entries(range).map(([key, value]) => [key, String(value)])))}`;
  assert((await fetch(`${first}${memberPath}`, { headers: memberHeaders })).ok);
  await database.query('DELETE FROM team_user WHERE team_id=$1 AND user_id=$2', [teamId, memberId]);
  const rejectedMember = await fetch(`${second}${memberPath}`, { headers: memberHeaders });
  assert([401, 403, 404].includes(rejectedMember.status));
  report.checks.push({
    name: 'cross-instance-team-revocation-on-warm-result',
    status: rejectedMember.status,
  });

  const redis = new AnalyticsRedis(`redis://127.0.0.1:${port(redisName, 6379)}`),
    codecKey = `${stamp}:codec`;
  const owner = await redis.claim(codecKey);
  assert.equal(typeof owner, 'string');
  const value = {
    decimal: new Decimal('1.23456789'),
    date: new Date(1000),
    count: 12345678901234567890n,
  };
  const cached = {
    value,
    generatedAt: Date.now(),
    expiresAt: Date.now() + 10000,
    status: 'miss' as const,
  };
  assert.equal(await redis.publish(codecKey, 'different-owner', cached), false);
  assert.equal(await redis.renew(codecKey, owner as string), true);
  assert.equal(await redis.publish(codecKey, owner as string, cached), true);
  const decoded = await redis.read<typeof value>(codecKey);
  assert(decoded && typeof decoded !== 'string');
  assert.equal(decoded.value.decimal.toString(), value.decimal.toString());
  assert.equal(+decoded.value.date, 1000);
  assert.equal(decoded.value.count, value.count);
  assert(decoded.expiresAt <= cached.expiresAt);
  redis.close();
  report.checks.push({ name: 'Redis-owner-lease-codec-and-original-expiry', passed: true });

  probe = new pg.Client({ connectionString: dbConnectionString });
  await probe.connect();
  const probeId = Number((await probe.query('SELECT pg_backend_pid() AS id')).rows[0].id);
  await probe.query('BEGIN');
  const began = performance.now();
  const timed = timedAnalyticsClient(
    {
      $executeRawUnsafe: async (sql: string) => probe.query(sql),
      $queryRawUnsafe: async (sql: string) => probe.query(sql),
    },
    Date.now() + 300,
  );
  const slow = await Promise.allSettled([
    timed.$queryRawUnsafe('SELECT pg_sleep(0.2)'),
    timed.$queryRawUnsafe('SELECT pg_sleep(0.2)'),
  ]);
  await probe.query('ROLLBACK');
  const elapsed = performance.now() - began;
  assert(slow.some(r => r.status === 'rejected'));
  assert(elapsed < 700);
  const activity = await database.query(
    "SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=$1 AND state='active'",
    [probeId],
  );
  assert.equal(activity.rows[0].n, 0);
  await probe.end();
  probe = undefined;
  report.checks.push({
    name: 'PG15-concurrent-snapshot-deadline-and-actual-termination',
    elapsedMs: elapsed,
    passed: true,
  });
  await database.query(
    "UPDATE share SET parameters='{" +
      '"overview":false,"enabled":false' +
      "}'::jsonb WHERE share_id=$1",
    [shareId],
  );
  const revoked = await fetch(`${second}${publicPath}`, { headers: publicHeaders });
  assert([401, 403, 404].includes(revoked.status));
  report.checks.push({ name: 'share-revocation-after-warm-hit', status: revoked.status });
  docker('stop', redisName);
  await scenario(
    'Redis-outage-bounded-computation',
    i =>
      `${second}/api/websites/${sites[0]}/stats?${new URLSearchParams({ startAt: String(range.startAt), endAt: String(end + i + 1000), timezone: range.timezone })}`,
    headers,
    await expected(range),
    2,
    { allowControlledUnavailable: true },
  );
  docker('start', redisName);
  await pause(11000);
  const recoveryPath = `/api/websites/${sites[0]}/stats?${new URLSearchParams({ startAt: String(range.startAt), endAt: String(end + 9000), timezone: range.timezone })}`;
  const recovered = await fetch(`${second}${recoveryPath}`, { headers });
  assert(recovered.ok);
  await renewSecond();
  const recoveryHit = await fetch(`${second}${recoveryPath}`, { headers });
  const recoveryBody = await recoveryHit.json();
  report.checks.push({
    name: 'Redis-recovery',
    status: recoveryHit.status,
    tier: recoveryHit.headers.get('x-liekan-cache-tier'),
    generatedAt: recoveryHit.headers.get('x-liekan-generated-at'),
    correct: Number(recoveryBody.pageviews) === (await expected(range)),
  });
  save();
  assert(recoveryHit.ok && Number(recoveryBody.pageviews) === (await expected(range)));
  assert.equal(recoveryHit.headers.get('x-liekan-cache-tier'), 'redis');
  stage = 'isolated-joined-migration-restore';
  const beforeRestore = (
    await database.query(
      'SELECT (SELECT count(*)::int FROM website_event) AS events,(SELECT count(*)::int FROM liekan_log) AS logs,(SELECT count(*)::int FROM website) AS websites',
    )
  ).rows[0];
  await database.query(
    'UPDATE "user" SET username=$1,password=(SELECT password FROM "user" WHERE user_id=$2) WHERE user_id=$3',
    ['custom-benchmark-admin', memberId, authentication.user.id],
  );
  docker(
    'exec',
    dbName,
    'sh',
    '-c',
    'createdb -U bench bench_restore && pg_dump -U bench -Fc bench | pg_restore -U bench -d bench_restore --no-owner',
  );
  docker(
    'exec',
    dbName,
    'psql',
    '-U',
    'bench',
    '-d',
    'bench_restore',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    "DROP TABLE liekan_analytics_revision; DELETE FROM liekan_migration WHERE name='012_analytics_revision.sql'",
  );
  const restoreConnection = new URL(internalDatabase);
  restoreConnection.pathname = '/bench_restore';
  const restoreApp = await startApp(`${stamp}-restore`, restoreConnection.toString());
  const restored = JSON.parse(
    docker(
      'exec',
      dbName,
      'psql',
      '-U',
      'bench',
      '-d',
      'bench_restore',
      '-Atc',
      "SELECT json_build_object('events',(SELECT count(*) FROM website_event),'logs',(SELECT count(*) FROM liekan_log),'websites',(SELECT count(*) FROM website),'migration12',(SELECT count(*) FROM liekan_migration WHERE name='012_analytics_revision.sql'))",
    ),
  );
  assert.equal(restored.events, beforeRestore.events);
  assert.equal(restored.logs, beforeRestore.logs);
  assert.equal(restored.websites, beforeRestore.websites);
  assert.equal(restored.migration12, 1);
  const customLogin = await fetch(`${restoreApp}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'custom-benchmark-admin', password: memberPassword }),
  });
  assert(customLogin.ok);
  const restoredAuthentication = (await customLogin.json()) as any;
  assert.equal(typeof restoredAuthentication.token, 'string');
  // The restore fixture changes the password in both copies, invalidating the previous session.
  headers.authorization = `Bearer ${restoredAuthentication.token}`;
  report.checks.push({
    name: 'migration-11-to-12-and-restored-data-custom-credentials',
    countsPreserved: true,
    customLogin: customLogin.status,
  });
  stage = 'traffic-quality-collection-and-background-observation';
  report.trafficQuality = await measureTrafficQuality({
    base: first,
    baseline: oldBase,
    headers,
    database,
    ownerId: authentication.user.id,
    smoke,
    volumeSites: sites,
    observe: async () => {
      const resourceScript = `const fs=require('node:fs');
        const counters=path=>Object.fromEntries(fs.readFileSync(path,'utf8').trim().split('\\n').map(line=>{const [key,value]=line.split(/\\s+/);return [key,Number(value)]}));
        console.log(JSON.stringify({cpu:counters('/sys/fs/cgroup/cpu.stat'),memoryEvents:counters('/sys/fs/cgroup/memory.events'),memoryPeakBytes:Number(fs.readFileSync('/sys/fs/cgroup/memory.peak','utf8'))}));`;
      const resources = async () =>
        JSON.parse(
          (await promisify(execFile)('docker', ['exec', workerName, 'node', '-e', resourceScript]))
            .stdout,
        );
      const before = await resources();
      await promisify(execFile)(
        'docker',
        ['exec', workerName, 'node', 'dist/liekan-worker.mjs', '--observe-browser-risk-once'],
        { timeout: 180000 },
      );
      const after = await resources();
      const difference = (key: 'cpu' | 'memoryEvents') =>
        Object.fromEntries(
          Object.keys(after[key]).map(name => [name, after[key][name] - before[key][name]]),
        );
      const memoryEvents = difference('memoryEvents');
      assert.equal(memoryEvents.oom, 0, 'background observation must fit its memory budget');
      assert.equal(memoryEvents.oom_kill, 0, 'background observation must not kill a worker');
      return {
        container: workerName,
        before,
        after,
        delta: { cpu: difference('cpu'), memoryEvents },
        memoryPeakMeaning: 'container lifetime peak before and after this observation',
      };
    },
  });
  save();
  assert(report.trafficQuality.passed, 'collector throughput or latency regression');
  stage = 'post-timing-heavy-query-execution-plans';
  const { collectHeavyExplains } = await import('./liekan-cache-explain');
  report.heavyExplain = await collectHeavyExplains({
    connectionString: dbConnectionString,
    benchmarkStamp: stamp,
    timingsFinished: true,
    sites,
    matrixSeed: {
      savedSite: report.additionalSources.savedSite,
      goal: report.additionalSources.goal,
      funnel: report.additionalSources.funnel,
      link: report.additionalSources.link,
      pixel: report.additionalSources.pixel,
    },
    startAt: range.startAt,
    endAt: range.endAt,
    timezone: range.timezone,
    chartPeriod: '30d',
  });
  save();
  assert(report.heavyExplain.passed, 'actual heavy-query execution plans must be collected');
  report.resources = docker(
    'stats',
    '--no-stream',
    '--format',
    '{{json .}}',
    `${stamp}-app1`,
    `${stamp}-app2`,
    workerName,
    dbName,
    redisName,
  )
    .split('\n')
    .map(line => JSON.parse(line));
  report.performance = report.scenarios
    .filter((entry: any) => /-L1$|-Redis$|-preheated$/.test(entry.name))
    .map((entry: any) => ({
      name: entry.name,
      p95: entry.p95,
      p99: entry.p99,
      passed: entry.p95 <= 250 && entry.p99 <= 500,
    }));
  report.improvement = report.scenarios
    .filter((entry: any) => entry.name.endsWith('-uncached'))
    .map((cold: any) => {
      const prefix = cold.name.replace(/-uncached$/, '');
      const warm = report.scenarios.find((entry: any) => entry.name === `${prefix}-L1`);
      assert.equal(
        cold.concurrency,
        warm.concurrency,
        'reuse comparison must use the same concurrency',
      );
      const fraction = 1 - warm.p95 / cold.p95;
      return {
        name: prefix,
        coldP95: cold.p95,
        warmP95: warm.p95,
        improvement: fraction,
        applicable: cold.p95 >= 500,
        reason:
          cold.p95 >= 500
            ? 'heavy uncached computation requires at least 60% reduction'
            : 'reuse benefit recorded; fast-interface overhead is evaluated against the matching old image',
        passed: cold.p95 < 500 || fraction >= 0.6,
      };
    });
  report.correctnessPassed = report.scenarios
    .filter((entry: any) => entry.kind !== 'fault')
    .every((entry: any) => entry.correct === samples);
  const faultScenarios = report.scenarios.filter((entry: any) => entry.kind === 'fault');
  report.faultsPassed =
    faultScenarios.length === 1 &&
    faultScenarios.every((entry: any) => entry.completed === samples && entry.accepted === samples);
  if (report.baseline) {
    assert.equal(
      report.baseline.pairedComparisons.length,
      report.baseline.comparisons.length,
      'every matching old contract requires an adjacent paired comparison',
    );
    report.baseline.overhead = report.baseline.pairedComparisons.map(
      ({ name, oldP95, currentP95, extraMs, passed, method, pairs, concurrency }) => ({
        name,
        oldP95,
        currentP95,
        extraMs,
        passed,
        method,
        pairs,
        concurrency,
      }),
    );
    report.baseline.batchOverhead = report.baseline.comparisons.map(({ old, current }) => {
      const a = report.scenarios.find((s: any) => s.name === old),
        b = report.scenarios.find((s: any) => s.name === current);
      assert.equal(
        a.concurrency,
        b.concurrency,
        'old-image comparison must use the same concurrency',
      );
      return {
        name: current,
        method:
          'separate batches with fresh data-equivalent L1 endAt nonce; adjacent same-URL pairs decide overhead',
        oldP95: a.p95,
        currentP95: b.p95,
        extraMs: b.p95 - a.p95,
        passed: a.p95 >= 500 || b.p95 - a.p95 <= 30,
      };
    });
  }
  report.passed =
    report.correctnessPassed &&
    report.trafficQuality.passed &&
    report.faultsPassed &&
    report.browser.passed &&
    report.asyncControl.passed &&
    report.performance.every((entry: any) => entry.passed) &&
    report.improvement.every((entry: any) => entry.passed);
  if (report.baseline)
    report.passed &&= report.baseline.overhead.every((entry: any) => entry.passed);
  report.finishedAt = new Date().toISOString();
  report.otherContainerLoadAtEnd = otherContainerLoad();
  report.sourceUnchanged = sourceFingerprint() === report.sourceFingerprint;
  report.passed &&= report.sourceUnchanged;
  save();
  assert(report.passed, 'performance targets or correctness did not pass');
  console.log(`Benchmark report: ${directory}/report.json`);
} catch (error) {
  report.passed = false;
  report.failure = {
    stage,
    kind: error instanceof Error ? error.name : 'Error',
    assertion: error instanceof assert.AssertionError ? error.message : undefined,
    diagnostic: String((error as any)?.stderr || (error instanceof Error ? error.message : 'Error'))
      .replaceAll(password, '[redacted]')
      .replaceAll(appSecret, '[redacted]')
      .replace(
        /(?:APP_SECRET|TWO_FACTOR_ENCRYPTION_KEY|POSTGRES_PASSWORD)=[^\s'"`]+/g,
        '[redacted-env]',
      )
      .replace(/postgresql:\/\/[^\s'"`]+/g, '[database-url]')
      .slice(0, 2000),
  };
  save();
  process.exitCode = 1;
  console.error(`Cache benchmark failed; sanitized evidence: ${directory}/report.json`);
} finally {
  if (!report.passed) {
    const sanitize = (text: string) =>
      text
        .replaceAll(password, '[redacted]')
        .replaceAll(appSecret, '[redacted]')
        .replace(
          /(?:APP_SECRET|TWO_FACTOR_ENCRYPTION_KEY|POSTGRES_PASSWORD)=[^\s'"`]+/g,
          '[redacted-env]',
        )
        .replace(/postgresql:\/\/[^\s'"`]+/g, '[database-url]')
        .slice(-100000);
    report.failureLogs = created.map(name => {
      const result = spawnSync('docker', ['logs', '--tail', '200', name], { encoding: 'utf8' });
      return {
        container: name,
        status: result.status,
        output: sanitize(`${result.stdout || ''}\n${result.stderr || ''}`),
      };
    });
  }
  await probe?.end().catch(() => {});
  await database?.end().catch(() => {});
  const cleanup: { type: string; name: string; removed: boolean }[] = [];
  const remove = (type: string, name: string, command: string[]) => {
    try {
      docker(...command);
      cleanup.push({ type, name, removed: true });
    } catch {
      cleanup.push({ type, name, removed: false });
    }
  };
  for (const name of created.reverse()) remove('container', name, ['rm', '-f', '-v', name]);
  if (volumeCreated) remove('volume', volume, ['volume', 'rm', volume]);
  if (networkCreated) remove('network', network, ['network', 'rm', network]);
  report.cleanup = { passed: cleanup.every(entry => entry.removed), resources: cleanup };
  if (!report.cleanup.passed) {
    report.passed = false;
    process.exitCode = 1;
  }
  save();
}
