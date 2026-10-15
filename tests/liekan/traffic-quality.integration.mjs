#!/usr/bin/env node
// Run only against resources created by this process. The candidate image is built separately.
import { runTrafficQualityUpgradeChecks } from './traffic-quality-upgrade.mjs';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { gzipSync, inflateRawSync } from 'node:zlib';
import { buildSync, transformSync } from 'esbuild';
import ipaddr from 'ipaddr.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const runId = randomUUID().replaceAll('-', '');
const ownerLabel = 'io.liekan.traffic-test';
const names = {
  network: `liekan-tq-${runId}`,
  database: `liekan-tq-db-${runId}`,
  application: `liekan-tq-app-${runId}`,
  volume: `liekan-tq-data-${runId}`,
};
const dbUser = 'traffic_quality_test';
const dbName = 'traffic_quality_test';
const dbPassword = randomBytes(32).toString('hex');
const appSecret = randomBytes(32).toString('hex');
const twoFactorKey = randomBytes(32).toString('hex');
const websiteId = randomUUID();
const websiteSql = `'${websiteId}'::uuid`;
const browserUa =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const botUa =
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.0; +https://openai.com/gptbot)';
const normalIp = '192.0.2.17';
// Synthetic request address within a reviewed, GPTBot-exclusive public range.
const rangeIp = '20.125.66.81';
const fixtures = [];
let base,
  token,
  stage = 'preflight',
  cases = 0,
  cleanupPromise;
let stopping = false,
  uncertainCreation = false;
const activeCommands = new Set();
const createdResources = new Set();

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}
function same(actual, expected, message) {
  ensure(JSON.stringify(actual) === JSON.stringify(expected), message);
}
function number(value, message) {
  const parsed = Number(value);
  ensure(Number.isFinite(parsed), message);
  return parsed;
}
async function command(
  binary,
  args,
  { env = process.env, input, timeout = 90000, optional = false, cleanupOperation = false } = {},
) {
  if (stopping && !cleanupOperation) throw new Error('Integration run cancelled');
  const createsResource =
    binary === 'docker' &&
    (args[0] === 'run' || (['network', 'volume'].includes(args[0]) && args[1] === 'create'));
  const operation = new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    let size = 0,
      stopped = false;
    const timer = setTimeout(() => {
      stopped = true;
      if (createsResource) uncertainCreation = true;
      child.kill('SIGKILL');
    }, timeout);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) {
        stopped = true;
        if (createsResource) uncertainCreation = true;
        child.kill('SIGKILL');
      } else chunks.push(chunk);
    });
    // CLI diagnostics may contain connection arguments; keep them out of test output.
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error(`${binary} could not start`));
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (createsResource && code === 0 && !stopped)
        createdResources.add(args[0] === 'run' ? args[args.indexOf('--name') + 1] : args.at(-1));
      else if (createsResource) uncertainCreation = true;
      const result = { code, stdout: Buffer.concat(chunks).toString('utf8').trim() };
      if (!optional && (code !== 0 || stopped))
        reject(new Error(`${binary} operation failed${stopped ? ' or exceeded its bound' : ''}`));
      else resolve(result);
    });
    child.stdin.end(input);
  });
  activeCommands.add(operation);
  try {
    return await operation;
  } finally {
    activeCommands.delete(operation);
  }
}
const docker = (args, options) => command('docker', args, options);
async function sql(statement) {
  return (
    await docker(
      [
        'exec',
        '-i',
        names.database,
        'psql',
        '-U',
        dbUser,
        '-d',
        dbName,
        '-qAt',
        '-v',
        'ON_ERROR_STOP=1',
      ],
      { input: statement },
    )
  ).stdout;
}
async function sqlJson(statement) {
  const result = await sql(statement);
  try {
    return JSON.parse(result);
  } catch {
    throw new Error('Database fixture query returned invalid JSON');
  }
}
async function owned(kind, name) {
  const format =
    kind === 'container'
      ? `{{index .Config.Labels "${ownerLabel}"}}`
      : `{{index .Labels "${ownerLabel}"}}`;
  const result = await docker([kind, 'inspect', '--format', format, name], {
    optional: true,
    cleanupOperation: true,
  });
  if (result.code === 0 && result.stdout === runId) return true;
  return createdResources.has(name) ? null : false;
}
function cleanup() {
  return (cleanupPromise ??= (async () => {
    await Promise.allSettled([...activeCommands]);
    let failed = false;
    for (const name of [names.application, names.database]) {
      const ownership = await owned('container', name);
      if (ownership === null) failed = true;
      if (ownership === true)
        failed =
          (await docker(['rm', '-f', '-v', name], { optional: true, cleanupOperation: true }))
            .code !== 0 || failed;
    }
    const volumeOwnership = await owned('volume', names.volume);
    if (volumeOwnership === null) failed = true;
    if (volumeOwnership === true)
      failed =
        (await docker(['volume', 'rm', names.volume], { optional: true, cleanupOperation: true }))
          .code !== 0 || failed;
    const networkOwnership = await owned('network', names.network);
    if (networkOwnership === null) failed = true;
    if (networkOwnership === true)
      failed =
        (await docker(['network', 'rm', names.network], { optional: true, cleanupOperation: true }))
          .code !== 0 || failed;
    ensure(
      !failed && !uncertainCreation,
      'Owned Docker resource cleanup could not be fully confirmed',
    );
  })());
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    stopping = true;
    cleanup().finally(() => process.exit(130));
  });
async function poll(label, work, timeout = 180000) {
  const deadline = Date.now() + timeout;
  let heartbeat = Date.now();
  while (Date.now() < deadline) {
    try {
      if (await work()) return;
    } catch {
      /* Startup may still be migrating. */
    }
    if (Date.now() - heartbeat >= 20000) {
      console.log(`WAIT ${label}`);
      heartbeat = Date.now();
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`${label} did not become ready within the deadline`);
}
async function test(label, work) {
  stage = label;
  await work();
  cases++;
  console.log(`PASS ${String(cases).padStart(2, '0')} ${label}`);
}
async function http(
  path,
  { method = 'GET', body, auth = false, headers = {}, expected = 200 } = {},
) {
  let response;
  try {
    response = await fetch(base + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(auth ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(70000),
    });
  } catch {
    throw new Error('Isolated HTTP request failed or timed out');
  }
  ensure(
    response.status === expected,
    `HTTP status mismatch for ${method} ${path.split('?')[0]} (expected ${expected}, received ${response.status})`,
  );
  return response;
}
async function json(path, options) {
  const response = await http(path, options);
  try {
    return { response, body: await response.json() };
  } catch {
    throw new Error('HTTP response was not JSON');
  }
}
function event(path, extra = {}) {
  return {
    type: 'event',
    payload: {
      website: websiteId,
      eventId: randomUUID(),
      hostname: 'quality.example',
      url: path,
      language: 'en-US',
      screen: '1920x1080',
      id: randomUUID(),
      ...extra,
    },
  };
}
async function collect(
  body,
  {
    authenticated = false,
    authHeader = false,
    userAgent = browserUa,
    ip = normalIp,
    expected = 200,
  } = {},
) {
  const result = await json(authenticated ? '/api/liekan/collect' : '/api/send', {
    method: 'POST',
    body,
    auth: authenticated || authHeader,
    expected,
    headers: { 'user-agent': userAgent, 'x-real-ip': ip },
  });
  ensure(!result.response.headers.has('set-cookie'), 'Collection must remain cookie-free');
  if (expected === 200) {
    ensure(
      typeof result.body.cache === 'string' && /^[a-f0-9-]{36}$/i.test(result.body.sessionId),
      'Collection success contract is incomplete',
    );
  }
  return result.body;
}
async function record(body, quality, options = {}) {
  const result = await collect(body, options);
  fixtures.push({
    path: new URL(body.payload.url, 'https://quality.example').pathname,
    fullPath: body.payload.url,
    host: quality.hostname ?? body.payload.hostname?.toLowerCase().replace(/^www\./, ''),
    classification: quality.classification,
    source: quality.source,
    sessionId: result.sessionId,
    clientEventId: body.payload.eventId,
    pageview: !body.payload.name,
    browser: (options.userAgent ?? browserUa) === botUa ? 'searchbot' : 'chrome',
    channel: body.payload.referrer?.includes('www.google.com/search') ? 'organicSearch' : 'direct',
    keyword: body.payload.referrer?.includes('www.google.com/search')
      ? new URL(body.payload.referrer).searchParams.get('q')
      : null,
    revenue: body.payload.data?.revenue ?? 0,
    properties: Object.keys(body.payload.data ?? {}).length,
    reason: quality.reason,
    missingVerdict: false,
  });
  return result;
}
async function counts() {
  return sqlJson(`SELECT json_build_object(
    'events',(SELECT count(*) FROM website_event WHERE website_id=${websiteSql}),
    'quality',(SELECT count(*) FROM liekan_event_quality WHERE website_id=${websiteSql}),
    'receipts',(SELECT count(*) FROM liekan_collection_receipt WHERE website_id=${websiteSql}),
    'properties',(SELECT count(*) FROM event_data WHERE website_id=${websiteSql}),
    'revenue',(SELECT count(*) FROM revenue WHERE website_id=${websiteSql}));`);
}
function expectedCounts() {
  return {
    events: fixtures.length,
    quality: fixtures.filter(f => !f.missingVerdict).length,
    receipts: fixtures.filter(f => f.clientEventId).length,
    properties: fixtures.reduce((n, f) => n + f.properties, 0),
    revenue: fixtures.filter(f => f.revenue > 0).length,
  };
}
function included(mode, hosts = []) {
  return fixtures.filter(
    f =>
      mode === 'raw' ||
      (f.classification !== 'automated' &&
        (mode !== 'strict' || f.classification !== 'suspected') &&
        (!hosts.length || hosts.includes(f.host))),
  );
}
function unique(rows, field = 'sessionId') {
  return new Set(rows.map(row => row[field])).size;
}
function metricMap(rows) {
  ensure(Array.isArray(rows), 'Metrics response must contain rows');
  return Object.fromEntries(
    rows
      .map(row => [String(row.x), number(row.y, 'Metric count must be numeric')])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}
function expectedPaths(rows, full = false) {
  const paths = new Map();
  for (const row of rows.filter(f => f.pageview)) {
    const path = full ? row.fullPath : row.path;
    if (!paths.has(path)) paths.set(path, new Set());
    paths.get(path).add(row.sessionId);
  }
  return Object.fromEntries(
    [...paths]
      .map(([path, visitors]) => [path, visitors.size])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}
function unzip(input) {
  const bytes = Buffer.from(input, 'base64');
  ensure(bytes.length <= 5 * 1024 * 1024, 'Fixture export exceeded its bound');
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  ensure(end >= 0, 'Native export ZIP directory is missing');
  const files = new Map();
  let offset = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < bytes.readUInt16LE(end + 10); index++) {
    ensure(bytes.readUInt32LE(offset) === 0x02014b50, 'Native export ZIP entry is invalid');
    const method = bytes.readUInt16LE(offset + 10),
      size = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28),
      extraLength = bytes.readUInt16LE(offset + 30),
      commentLength = bytes.readUInt16LE(offset + 32);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString();
    const local = bytes.readUInt32LE(offset + 42);
    ensure(
      bytes.readUInt32LE(local) === 0x04034b50 && [0, 8].includes(method),
      'Native export ZIP compression is unsupported',
    );
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const data = bytes.subarray(start, start + size);
    files.set(
      name,
      (method === 8 ? inflateRawSync(data, { maxOutputLength: 5 * 1024 * 1024 }) : data).toString(),
    );
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
function csvRows(text) {
  ensure(typeof text === 'string', 'Native export CSV is missing');
  const lines = [],
    row = [];
  let value = '',
    quoted = false;
  for (let i = 0; i <= text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n' || char === undefined)) {
      row.push(value.replace(/\r$/, ''));
      value = '';
      if (char !== ',') {
        if (row.some(Boolean)) lines.push([...row]);
        row.length = 0;
      }
    } else value += char;
  }
  const keys = lines.shift() ?? [];
  return lines.map(line => Object.fromEntries(keys.map((key, index) => [key, line[index]])));
}

try {
  ensure(
    Number(process.versions.node.split('.')[0]) >= 22,
    'Run this integration harness with Node 22 or later',
  );
  const revision = (await command('git', ['rev-parse', 'HEAD'])).stdout;
  ensure(/^[a-f0-9]{40}$/.test(revision), 'Candidate revision is invalid');
  const image = process.env.LIEKAN_TRAFFIC_IMAGE ?? `liekan:candidate-${revision.slice(0, 12)}`;
  const portText = process.env.LIEKAN_TRAFFIC_PORT ?? '3324';
  ensure(/^\d{4}$/.test(portText), 'LIEKAN_TRAFFIC_PORT must name an isolated test port');
  const port = Number(portText);
  ensure(
    port >= 3300 && port <= 3399 && ![3302, 3305, 3352].includes(port),
    'Use an unused isolated port from 3300 through 3399, excluding 3302, 3305 and 3352',
  );
  base = `http://127.0.0.1:${port}`;
  await test('candidate identity and isolated port', async () => {
    const inspected = await docker([
      'image',
      'inspect',
      '--format',
      '{{json .Config.Labels}}',
      image,
    ]);
    let labels;
    try {
      labels = JSON.parse(inspected.stdout);
    } catch {
      throw new Error('Candidate image metadata is invalid');
    }
    ensure(
      labels?.['org.opencontainers.image.revision'] === revision,
      'Candidate image revision must equal the current full HEAD',
    );
    await new Promise((resolve, reject) => {
      const server = createServer();
      server.once('error', () => reject(new Error('Isolated test port is already in use')));
      server.listen(port, '127.0.0.1', () => server.close(resolve));
    });
  });
  stage = 'isolated database startup';
  await docker(['network', 'create', '--label', `${ownerLabel}=${runId}`, names.network]);
  await docker(['volume', 'create', '--label', `${ownerLabel}=${runId}`, names.volume]);
  await docker(
    [
      'run',
      '-d',
      '--name',
      names.database,
      '--network',
      names.network,
      '--label',
      `${ownerLabel}=${runId}`,
      '-v',
      `${names.volume}:/var/lib/postgresql/data`,
      '-e',
      'POSTGRES_USER',
      '-e',
      'POSTGRES_DB',
      '-e',
      'POSTGRES_PASSWORD',
      'postgres:15-alpine',
    ],
    {
      env: {
        ...process.env,
        POSTGRES_USER: dbUser,
        POSTGRES_DB: dbName,
        POSTGRES_PASSWORD: dbPassword,
      },
    },
  );
  await poll(
    'private PostgreSQL startup',
    async () =>
      (
        await docker(['exec', names.database, 'pg_isready', '-U', dbUser, '-d', dbName], {
          optional: true,
          timeout: 5000,
        })
      ).code === 0,
    60000,
  );
  await docker(
    [
      'run',
      '-d',
      '--name',
      names.application,
      '--network',
      names.network,
      '--label',
      `${ownerLabel}=${runId}`,
      '-p',
      `127.0.0.1:${port}:3000`,
      '-e',
      'DATABASE_URL',
      '-e',
      'APP_SECRET',
      '-e',
      'TWO_FACTOR_ENCRYPTION_KEY',
      '-e',
      'CLIENT_IP_HEADER=x-real-ip',
      image,
    ],
    {
      env: {
        ...process.env,
        DATABASE_URL: `postgresql://${dbUser}:${dbPassword}@${names.database}:5432/${dbName}`,
        APP_SECRET: appSecret,
        TWO_FACTOR_ENCRYPTION_KEY: twoFactorKey,
      },
    },
  );
  await poll('candidate default migration and HTTP startup', async () => {
    const response = await fetch(base + '/api/heartbeat', { signal: AbortSignal.timeout(3000) });
    return response.ok;
  });

  let migrationBefore;
  await test('empty database uses default entrypoint migrations', async () => {
    const filenames = (await readdir(new URL('../../db/liekan/migrations/', import.meta.url)))
      .filter(name => name.endsWith('.sql'))
      .sort();
    const expected = await Promise.all(
      filenames.map(async name => ({
        name,
        checksum: createHash('sha256')
          .update(await readFile(new URL(`../../db/liekan/migrations/${name}`, import.meta.url)))
          .digest('hex'),
      })),
    );
    migrationBefore = await sqlJson(
      'SELECT json_agg(t ORDER BY name) FROM (SELECT name,checksum FROM liekan_migration) t;',
    );
    same(
      migrationBefore,
      expected,
      'Installed migration names and checksums must match this candidate',
    );
    ensure(
      filenames.includes('016_traffic_quality.sql'),
      'Traffic quality migration must be installed',
    );
    const runtime = JSON.parse(
      (await docker(['inspect', '--format', '{{json .Config.Env}}', names.application])).stdout,
    );
    ensure(
      !runtime.some(value => /^DISABLE_BOT_CHECK=.+/.test(value)),
      'Bot classification must remain enabled',
    );
  });
  await test('repeated policy reads push website predicates into base event scans', async () => {
    const source = await readFile(
      new URL('../../src/lib/liekan/upstream/traffic-query.ts', import.meta.url),
      'utf8',
    );
    const module = { exports: {} };
    runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, {
      module,
      exports: module.exports,
    });
    const statement = module.exports.withTrafficPolicy(`SELECT
      (SELECT count(*) FROM website_event WHERE website_id=${websiteSql} AND created_at>=now()-interval '1 day') AS events,
      (SELECT count(*) FROM website_event WHERE website_id=${websiteSql} AND created_at>=now()-interval '1 day' AND event_type=1) AS pageviews`);
    const [explained] = await sqlJson(`EXPLAIN (FORMAT JSON) ${statement}`);
    const nodes = [];
    const visit = node => {
      nodes.push(node);
      for (const child of node.Plans ?? []) visit(child);
    };
    visit(explained.Plan);
    ensure(
      !nodes.some(node => node['Node Type'] === 'CTE Scan' && node['CTE Name'] === 'website_event'),
      'Repeated policy reads must not materialize every website event before filtering',
    );
    const events = nodes.filter(node => node['Relation Name'] === 'website_event');
    ensure(events.length >= 2, 'The plan must exercise both actual base event reads');
    ensure(
      events.every(node =>
        /website_id/.test(
          `${node['Index Cond'] ?? ''} ${node.Filter ?? ''} ${node['Recheck Cond'] ?? ''}`,
        ),
      ),
      'Each base event scan must retain its website predicate',
    );
  });
  await test('login and create a unique private fixture site', async () => {
    const login = (
      await json('/api/auth/login', {
        method: 'POST',
        body: { username: 'admin', password: 'liekan' },
      })
    ).body;
    ensure(
      typeof login.token === 'string' && login.user?.isAdmin === true,
      'Fresh Liekan admin login failed',
    );
    token = login.token;
    const created = (
      await json('/api/websites', {
        method: 'POST',
        auth: true,
        body: {
          id: websiteId,
          name: 'Traffic quality integration fixture',
          domain: 'quality.example',
          shareId: `tq-${runId}`,
        },
      })
    ).body;
    ensure(created.id === websiteId, 'Fixture website identity must match the requested UUID');
    same(
      await counts(),
      { events: 0, quality: 0, receipts: 0, properties: 0, revenue: 0 },
      'Fixture site must begin empty',
    );
  });
  const startAt = Math.floor(Date.now() / 1000) * 1000 - 60000;
  const endAt = Date.now() + 20 * 60000;
  const window = new URLSearchParams({
    startAt: String(startAt),
    endAt: String(endAt),
    timezone: 'UTC',
  }).toString();
  const qualityPath = `/api/liekan/websites/${websiteId}/traffic-quality`;
  const nativePath = `/api/websites/${websiteId}`;
  const sitePath = `/api/liekan/websites/${websiteId}`;
  // Keep fixtures after site creation. The short future boundary is reached before analytics reads.
  const timestamp = Math.ceil(Date.now() / 1000);
  const browserQuality = {
    classification: 'browser',
    source: 'browser',
    reason: 'browser_compatible',
  };
  const legacyQuality = {
    classification: 'suspected',
    source: 'legacy_override',
    reason: 'legacy_payload_override',
  };
  const serverQuality = {
    classification: 'browser',
    source: 'authenticated_server',
    reason: 'browser_compatible',
  };
  const uaBotQuality = { classification: 'automated', source: 'browser', reason: 'ua_bot' };
  const rangeQuality = {
    classification: 'automated',
    source: 'browser',
    reason: 'official_range_match',
  };

  let rangeFixture;
  const rangeFixtureState = () =>
    sqlJson(`SELECT row_to_json(t) FROM (
      SELECT s.current_version AS version,s.current_observed_at AS "observedAt",
        s.last_success_at AS "lastSuccessAt",r.source_url AS source,r.parser_version AS parser,
        r.names,r.crawler_ids AS "crawlerIds",r.prefixes,r.published_at AS "publishedAt",
        r.observed_at AS "archivedAt",EXISTS(SELECT 1 FROM liekan_crawler_range_observation o
          WHERE o.source_id=s.source_id AND o.version=s.current_version
          AND o.observed_at=s.current_observed_at) AS "hasObservation"
      FROM liekan_crawler_range_source s JOIN liekan_crawler_range_snapshot r
        ON r.source_id=s.source_id AND r.version=s.current_version
      WHERE s.source_id='openai-gpt') t;`);
  await test('fresh official range fixture precedes intake cache', async () => {
    const module = { exports: {} };
    const built = buildSync({
      stdin: {
        contents: `export { rangeBaselines,isQualifiedRangeContent } from './src/lib/liekan/crawlers/range-check';
          export { rangeSources } from './src/lib/liekan/crawlers/range-sources';`,
        resolveDir: root,
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      packages: 'external',
      write: false,
    });
    runInNewContext(built.outputFiles[0].text, {
      module,
      exports: module.exports,
      require: createRequire(import.meta.url),
    });
    const { rangeBaselines, rangeSources, isQualifiedRangeContent } = module.exports;
    const source = rangeSources.find(source => source.id === 'openai-gpt');
    const baseline = rangeBaselines[source.id];
    const { content } = baseline;
    ensure(
      source.url === 'https://openai.com/gptbot.json' && isQualifiedRangeContent(source, content),
      'Official range fixture must retain reviewed provenance and qualified content',
    );
    const matchingSources = Object.entries(rangeBaselines).filter(([, snapshot]) =>
      snapshot.content.prefixes.some(prefix => {
        const [network, bits] = ipaddr.parseCIDR(prefix);
        const address = ipaddr.parse(rangeIp);
        return address.kind() === network.kind() && address.match(network, bits);
      }),
    );
    same(
      matchingSources.map(([id]) => id),
      [source.id],
      'Official range fixture must match exactly one reviewed source',
    );
    const observedAt = new Date(Date.now() - 10000).toISOString();
    ensure(
      Date.parse(observedAt) > Date.parse(baseline.observedAt),
      'Fixture observation must be newer than its immutable baseline',
    );
    const literal = value => `'${String(value).replaceAll("'", "''")}'`;
    const encoded = value => `${literal(JSON.stringify(value))}::jsonb`;
    await sql(`BEGIN;
      INSERT INTO liekan_crawler_range_snapshot(source_id,version,source_url,parser_version,names,crawler_ids,prefixes,address_families,published_at,observed_at)
        VALUES(${literal(source.id)},${literal(content.version)},${literal(content.sourceUrl)},${literal(content.parserVersion)},
          ${encoded(content.names)},${encoded(content.crawlerIds)},${encoded(content.prefixes)},
          ${encoded([...new Set(content.prefixes.map(prefix => (prefix.includes(':') ? 'ipv6' : 'ipv4')))])},
          ${content.publishedAt ? literal(content.publishedAt) : 'NULL'}::timestamptz,${literal(baseline.observedAt)}::timestamptz)
        ON CONFLICT(source_id,version) DO NOTHING;
      INSERT INTO liekan_crawler_range_observation(source_id,version,observed_at)
        VALUES(${literal(source.id)},${literal(content.version)},${literal(observedAt)}::timestamptz);
      INSERT INTO liekan_crawler_range_source(source_id,current_version,current_observed_at,last_success_at)
        VALUES(${literal(source.id)},${literal(content.version)},${literal(observedAt)}::timestamptz,${literal(observedAt)}::timestamptz)
        ON CONFLICT(source_id) DO UPDATE SET current_version=EXCLUDED.current_version,
          current_observed_at=EXCLUDED.current_observed_at,last_success_at=EXCLUDED.last_success_at;
      COMMIT;`);
    rangeFixture = await rangeFixtureState();
    ensure(
      rangeFixture.version === content.version && rangeFixture.hasObservation,
      'Qualified fixture must have an active version and matching observation',
    );
  });
  await test('server intake and quality policy require complete private authentication', async () => {
    await json('/api/liekan/collect', {
      method: 'POST',
      body: event('/unauthenticated', { timestamp }),
      expected: 401,
      headers: { 'user-agent': browserUa, 'x-real-ip': normalIp },
    });
    await json(qualityPath + '?' + window, { expected: 401 });
    const share = (await json(`/api/share/tq-${runId}`)).body;
    ensure(typeof share.token === 'string', 'Own-site share token was not created');
    await json('/api/liekan/collect', {
      method: 'POST',
      body: event('/shared-denied', { timestamp }),
      expected: 401,
      headers: {
        authorization: `Bearer ${share.token}`,
        'user-agent': browserUa,
        'x-real-ip': normalIp,
      },
    });
    await json(qualityPath + '?' + window, {
      expected: 401,
      headers: { authorization: `Bearer ${share.token}` },
    });
    same(await counts(), expectedCounts(), 'Rejected identities must leave no writes');
  });
  await test('twenty concurrent identical nonces write exactly once', async () => {
    const body = event('/parallel', {
      timestamp,
      name: 'purchase',
      data: { currency: 'USD', revenue: 12.5, marker: 'race' },
    });
    const replies = await Promise.all(Array.from({ length: 20 }, () => collect(body)));
    same(
      await rangeFixtureState(),
      rangeFixture,
      'First intake initialization must preserve qualified content and its newer observation',
    );
    const initializedRange = await sqlJson(
      "SELECT json_build_object('version',baseline_version,'observed',baseline_observed_at IS NOT NULL) FROM liekan_crawler_range_source WHERE source_id='openai-gpt';",
    );
    ensure(
      initializedRange.version === rangeFixture.version && initializedRange.observed,
      'First intake must initialize the reviewed baseline without replacing the fixture',
    );
    ensure(
      replies.every(reply => reply.sessionId === replies[0].sessionId),
      'Duplicate replies must retain the same session',
    );
    fixtures.push({
      path: '/parallel',
      fullPath: '/parallel',
      host: 'quality.example',
      classification: 'browser',
      source: 'browser',
      sessionId: replies[0].sessionId,
      clientEventId: body.payload.eventId,
      pageview: false,
      browser: 'chrome',
      channel: 'direct',
      revenue: 12.5,
      properties: 3,
      reason: 'browser_compatible',
      missingVerdict: false,
    });
    same(
      await counts(),
      expectedCounts(),
      'Concurrent duplicate receipts, events, properties and revenue must be exact',
    );
    await record(event('/parallel', { timestamp, id: body.payload.id }), browserQuality);
  });
  await test('legacy requests without nonce retain both events', async () => {
    const body = event('/legacy-script', { timestamp });
    delete body.payload.eventId;
    await record(body, browserQuality);
    await record(body, browserQuality);
    same(await counts(), expectedCounts(), 'Nonce-free compatibility must preserve both writes');
  });
  await test('changed body conflicts and invalid nonce is rejected', async () => {
    const body = event('/conflict', { timestamp });
    await record(body, browserQuality);
    const before = await counts();
    await collect(
      { ...body, payload: { ...body.payload, url: '/different-content' } },
      { expected: 409 },
    );
    await collect(event('/invalid-nonce', { timestamp, eventId: 'invalid-event-id' }), {
      expected: 400,
    });
    same(await counts(), before, 'Conflicting and malformed IDs must create no analytics rows');
  });
  await test('duplicate receipts acknowledge their original session and visit', async () => {
    const body = event('/retry-identity', { timestamp });
    const first = await record(body, browserQuality);
    const before = await counts();
    const retry = await collect(body, { ip: '192.0.2.18' });
    same(
      [retry.sessionId, retry.visitId],
      [first.sessionId, first.visitId],
      'An exact retry must retain the identity of its stored event',
    );
    same(await counts(), before, 'An exact retry must leave the event and receipt unchanged');
    await sql(
      `UPDATE website SET recorder_enabled=true,replay_config='{"heatmapEnabled":true}'::jsonb WHERE website_id=${websiteSql};`,
    );
    const heatmap = (
      await json('/api/record', {
        method: 'POST',
        body: {
          type: 'heatmap',
          payload: {
            website: websiteId,
            events: [{ type: 'click', url: '/retry-identity', x: 0.5, y: 0.5 }],
          },
        },
        headers: {
          'x-umami-cache': retry.cache,
          'user-agent': browserUa,
          'x-real-ip': '192.0.2.18',
        },
      })
    ).body;
    ensure(heatmap.ok === true, 'A retry acknowledgement must remain usable by the recorder');
    ensure(
      (await sql(`SELECT count(*) FROM heatmap_event h JOIN website_event e ON e.website_id=h.website_id AND e.session_id=h.session_id AND e.visit_id=h.visit_id
      WHERE h.website_id=${websiteSql} AND h.url_path='/retry-identity';`)) === '1',
      'Recorder signals from a duplicate acknowledgement must link to the stored visit',
    );
    await sql(
      `DELETE FROM heatmap_event WHERE website_id=${websiteSql} AND url_path='/retry-identity';`,
    );
  });
  await test('property constraint rolls back and failed nonce can be repaired', async () => {
    const body = event('/property-rollback', {
      timestamp,
      name: 'purchase',
      data: { currency: 'USD', revenue: 1e25, marker: 'overflow' },
    });
    const precision = await sqlJson(
      "SELECT json_build_object('precision',numeric_precision,'scale',numeric_scale) FROM information_schema.columns WHERE table_schema='public' AND table_name='event_data' AND column_name='number_value';",
    );
    same(
      precision,
      { precision: 19, scale: 4 },
      'Overflow fixture must exceed the actual property numeric constraint',
    );
    const before = await counts();
    await collect(body, { expected: 500 });
    same(
      await counts(),
      before,
      'Property failure must roll back receipt, event, quality and data',
    );
    body.payload.data.revenue = 3;
    await record(body, browserQuality);
    same(
      await counts(),
      expectedCounts(),
      'A failed receipt must allow repaired content with the same ID',
    );
  });
  await test('revenue callback failure rolls back prior event and properties', async () => {
    // A revenue row requires event_name. A pageview has no event name, so revenue validation fails after properties are inserted.
    const body = event('/revenue-rollback', {
      timestamp,
      data: { currency: 'USD', revenue: 4.5, marker: 'rollback' },
    });
    const nullable = await sql(
      "SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='revenue' AND column_name='event_name';",
    );
    ensure(
      nullable === 'NO',
      'Revenue fixture must target the existing non-null event name constraint',
    );
    const before = await counts();
    await collect(body, { expected: 500 });
    same(
      await counts(),
      before,
      'Revenue callback failure must roll back receipt, event, properties and revenue',
    );
    body.payload.name = 'purchase';
    await record(body, browserQuality);
  });
  await test('transport bot evidence and fresh official CIDR are recorded', async () => {
    await record(event('/transport-bot', { timestamp }), uaBotQuality, { userAgent: botUa });
    await record(event('/official-range', { timestamp }), rangeQuality, { ip: rangeIp });
    await record(
      event('/automated-purchase', {
        timestamp,
        name: 'purchase',
        data: { currency: 'USD', revenue: 20, marker: 'automated' },
      }),
      uaBotQuality,
      { userAgent: botUa },
    );
  });
  await test('v2 browser automation and public UA masking retain auditable raw events', async () => {
    await record(event('/webdriver', { timestamp, webdriver: true }), {
      classification: 'automated',
      source: 'browser',
      reason: 'browser_webdriver',
    });
    await record(event('/webdriver-false', { timestamp, webdriver: false }), browserQuality);
    await record(
      event('/masked-request-ua', { timestamp, userAgent: browserUa }),
      { classification: 'automated', source: 'legacy_override', reason: 'request_ua_bot' },
      { userAgent: 'python-requests/2.31.0' },
    );
    await record(
      event('/server-transport-ua', { timestamp, userAgent: browserUa }),
      serverQuality,
      { authenticated: true, userAgent: 'python-requests/2.31.0' },
    );
    const before = await counts();
    await collect(event('/invalid-webdriver', { timestamp, webdriver: 'true' }), { expected: 400 });
    same(await counts(), before, 'Invalid automation evidence must not write any analytics rows');
  });
  await test('public overrides remain suspected and Bearer header does not upgrade', async () => {
    await record(
      event('/public-overrides', { timestamp, ip: normalIp, userAgent: browserUa }),
      legacyQuality,
    );
    await record(
      event('/public-bearer-overrides', { timestamp, ip: normalIp, userAgent: browserUa }),
      legacyQuality,
      { authHeader: true },
    );
    await record(
      event('/suspected-purchase', {
        timestamp,
        ip: normalIp,
        userAgent: browserUa,
        name: 'purchase',
        data: { currency: 'USD', revenue: 7, marker: 'suspected' },
      }),
      legacyQuality,
    );
  });
  await test('private server overrides retain authenticated source', async () => {
    await record(
      event('/private-overrides', { timestamp, ip: normalIp, userAgent: browserUa }),
      serverQuality,
      { authenticated: true },
    );
  });
  await test('home paths and normalized Unicode hosts retain exact evidence', async () => {
    await record(event('/home', { timestamp, hostname: 'WWW.Quality.Example:443' }), {
      ...browserQuality,
      hostname: 'quality.example',
    });
    await record(event('/unicode-home', { timestamp, hostname: 'WWW.例子.测试:443' }), {
      ...browserQuality,
      hostname: 'xn--fsqu00a.xn--0zwm56d',
    });
    await record(
      event('/outside-home', {
        timestamp,
        hostname: 'quality.example',
        url: 'https://WWW.Outside.Example/outside-home',
      }),
      { ...browserQuality, hostname: 'outside.example' },
    );
    fixtures[fixtures.length - 1].fullPath = '/outside-home';
  });
  await test('keyword evidence includes browser, suspected and automated intake', async () => {
    await record(
      event('/browser-keyword', {
        timestamp,
        referrer: 'https://www.google.com/search?q=browser-fixture',
      }),
      browserQuality,
    );
    await record(
      event('/suspected-keyword', {
        timestamp,
        ip: normalIp,
        userAgent: browserUa,
        referrer: 'https://www.google.com/search?q=suspected-fixture',
      }),
      legacyQuality,
    );
    await record(
      event('/automated-keyword', {
        timestamp,
        referrer: 'https://www.google.com/search?q=automated-fixture',
      }),
      uaBotQuality,
      { userAgent: botUa },
    );
  });
  await test('historical unclassified event remains unknown and eligible', async () => {
    const sessionId = randomUUID(),
      eventId = randomUUID(),
      visitId = randomUUID();
    await sql(
      `INSERT INTO session(session_id,website_id,browser,country,created_at) VALUES('${sessionId}'::uuid,${websiteSql},'chrome','US',to_timestamp(${timestamp})); INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,url_path,hostname,event_type) VALUES('${eventId}'::uuid,${websiteSql},'${sessionId}'::uuid,'${visitId}'::uuid,to_timestamp(${timestamp}),'/historical','quality.example',1);`,
    );
    fixtures.push({
      path: '/historical',
      fullPath: '/historical',
      host: 'quality.example',
      classification: 'unknown',
      source: null,
      sessionId,
      pageview: true,
      browser: 'chrome',
      channel: 'direct',
      revenue: 0,
      properties: 0,
      missingVerdict: true,
    });
    // Synthetic country fixtures cover both legacy metadata and event geography anchors.
    await sql(`UPDATE session SET country='US' WHERE website_id=${websiteSql};`);
    await sql(
      `UPDATE liekan_event_geography SET country='US',region=NULL,city=NULL,precision='country',reason='synthetic_fixture' WHERE website_id=${websiteSql};`,
    );
    same(
      await counts(),
      expectedCounts(),
      'Raw fixture counts must include history without fabricating a verdict',
    );
  });
  await test('historical host aliases retain Unicode, trailing-dot and IPv6 visits', async () => {
    for (const [suffix, hostname, canonical] of [
      ['unicode', 'WWW.例子.测试:443', 'xn--fsqu00a.xn--0zwm56d'],
      ['mixed-unicode', 'WWW.例子.xn--0zwm56d:443', 'xn--fsqu00a.xn--0zwm56d'],
      ['dot', 'WWW.QUALITY.EXAMPLE.:443', 'quality.example'],
      ['ipv6', '[2001:db8::1]:443', '[2001:db8::1]'],
      ['expanded-ipv6', '[2001:0db8:0:0:0:0:0:1]:443', '[2001:db8::1]'],
    ]) {
      const sessionId = randomUUID(),
        eventId = randomUUID(),
        visitId = randomUUID(),
        path = '/historical-' + suffix;
      await sql(
        `INSERT INTO session(session_id,website_id,browser,country,created_at) VALUES('${sessionId}'::uuid,${websiteSql},'chrome','US',to_timestamp(${timestamp})); INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,url_path,hostname,event_type) VALUES('${eventId}'::uuid,${websiteSql},'${sessionId}'::uuid,'${visitId}'::uuid,to_timestamp(${timestamp}),'${path}','${hostname}',1);`,
      );
      fixtures.push({
        path,
        fullPath: path,
        host: canonical,
        classification: 'unknown',
        source: null,
        sessionId,
        pageview: true,
        browser: 'chrome',
        channel: 'direct',
        revenue: 0,
        properties: 0,
        missingVerdict: true,
      });
    }
    same(await counts(), expectedCounts(), 'Historical aliases must retain missing verdicts');
  });
  await test('recording fixtures link to the actual collected visits', async () => {
    const emptyRecording = gzipSync(Buffer.from('[]')).toString('hex');
    await sql(`INSERT INTO heatmap_event(heatmap_event_id,website_id,session_id,visit_id,url_path,event_type,created_at)
      SELECT gen_random_uuid(),website_id,session_id,visit_id,url_path,1,created_at FROM website_event WHERE website_id=${websiteSql} AND event_type=1;
      INSERT INTO session_replay(replay_id,website_id,session_id,visit_id,chunk_index,events,event_count,started_at,ended_at)
      SELECT gen_random_uuid(),website_id,session_id,visit_id,0,decode('${emptyRecording}','hex'),0,min(created_at),max(created_at) FROM website_event WHERE website_id=${websiteSql} AND event_type=1 GROUP BY website_id,session_id,visit_id;`);
  });
  await test('raw audit agrees with stored classifications and privacy contract', async () => {
    const audit = (await json(qualityPath + '?' + window, { auth: true })).body;
    ensure(
      audit.rows.length === fixtures.length && audit.rows.length > 0,
      'Raw audit must include every fixture event',
    );
    const expectedSummary = Object.fromEntries(
      ['automated', 'browser', 'suspected', 'unknown'].map(classification => [
        classification,
        fixtures.filter(f => f.classification === classification).length,
      ]),
    );
    same(
      Object.fromEntries(
        audit.summary
          .map(row => [row.classification, row.events])
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
      expectedSummary,
      'Audit summary must preserve each evidence class',
    );
    for (const row of audit.rows) {
      const match = fixtures.find(f => f.path === row.path);
      ensure(
        match && row.classification === match.classification && row.source === match.source,
        'Audit row classification and source must match its collected fixture',
      );
      if (match.missingVerdict)
        ensure(
          row.ruleVersion === null && row.rangeStatus === null,
          'Historical evidence must remain visibly missing',
        );
      else {
        ensure(
          row.ruleVersion === 'traffic-quality-v2' && row.reasons.includes(match.reason),
          'Audit must preserve the classification rule and reason',
        );
        if (row.path === '/official-range')
          ensure(
            row.rangeStatus === 'fresh' && /^[a-f0-9]{64}$/.test(row.rangeVersion),
            'Trusted official match must keep fresh versioned range evidence',
          );
      }
      ensure(
        row.included === (match.classification !== 'automated'),
        'Default standard audit inclusion must match policy',
      );
    }
    const columns = await sqlJson(
      "SELECT json_object_agg(table_name,columns ORDER BY table_name) FROM (SELECT table_name,json_agg(column_name ORDER BY column_name) AS columns FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('liekan_event_quality','liekan_collection_receipt') GROUP BY table_name) t;",
    );
    same(
      columns,
      {
        liekan_collection_receipt: [
          'client_event_id',
          'created_at',
          'event_id',
          'payload_hash',
          'website_id',
        ],
        liekan_event_quality: [
          'classification',
          'created_at',
          'event_id',
          'hostname',
          'range_status',
          'range_version',
          'reasons',
          'rule_version',
          'source',
          'website_id',
        ],
      },
      'Quality evidence and receipts must have no raw IP, UA or private payload columns',
    );
    ensure(
      (await sql(
        `SELECT count(*) FROM liekan_collection_receipt WHERE website_id=${websiteSql} AND (payload_hash !~ '^[a-f0-9]{64}$' OR event_id IS NULL);`,
      )) === '0',
      'Receipt bodies must be represented only by linked 256-bit digests',
    );
  });

  async function verifyPresence(expectedViews) {
    await poll('fixture timestamp boundary', async () => Date.now() >= timestamp * 1000, 5000);
    const installation = (await json(`${sitePath}/installation`, { auth: true })).body;
    ensure(
      number(installation.browser?.pageviews) === fixtures.filter(f => f.pageview).length &&
        installation.browser.firstAt &&
        installation.browser.lastAt,
      'Installation must report actual raw pageview receipt after site creation',
    );
    const summary = (
      await json(`/api/liekan/websites/summary?${window}&ids=${websiteId}`, { auth: true })
    ).body;
    ensure(
      Array.isArray(summary) &&
        summary.length === 1 &&
        summary[0].id === websiteId &&
        summary[0].received === true &&
        summary[0].lastAt,
      'Workspace received state must preserve raw collection presence',
    );
    ensure(
      number(summary[0].views) === expectedViews && number(summary[0].pageviews) === expectedViews,
      'Workspace analytics must retain active policy totals',
    );
  }
  async function verifySurfaces(mode, hosts = []) {
    const selected = included(mode, hosts),
      pages = selected.filter(f => f.pageview),
      revenue = selected.filter(f => f.revenue > 0);
    const stats = await json(`${nativePath}/stats?${window}`, { auth: true });
    const recording = await sqlJson(
      `SELECT json_build_object('heatmaps',(SELECT count(*) FROM liekan_effective_heatmap_event WHERE website_id=${websiteSql}),'replays',(SELECT count(*) FROM liekan_effective_session_replay WHERE website_id=${websiteSql}));`,
    );
    ensure(
      recording.heatmaps === pages.length && recording.replays === unique(pages),
      'Recording views must inherit eligible visit inclusion',
    );
    const replayList = (await json(`${nativePath}/replays?${window}&pageSize=100`, { auth: true }))
      .body;
    ensure(
      number(replayList.count) === unique(pages),
      'Unfiltered native replay lists must inherit the shared policy',
    );
    ensure(
      number(stats.body.pageviews) === pages.length &&
        number(stats.body.visitors) === unique(pages),
      'Native pageview and visitor counts must follow the active traffic policy',
    );
    const cached = await json(`${nativePath}/stats?${window}`, { auth: true });
    ensure(
      cached.response.headers.get('x-liekan-cache') === 'hit',
      'Native stats cache must be primed before the next policy mutation',
    );
    for (const type of ['path', 'fullPath']) {
      const rows = (await json(`${nativePath}/metrics?${window}&type=${type}`, { auth: true }))
        .body;
      same(
        metricMap(rows),
        expectedPaths(selected, type === 'fullPath'),
        'Native URL metrics must follow the active traffic policy',
      );
    }
    const browser = (await json(`${nativePath}/metrics?${window}&type=browser`, { auth: true }))
      .body;
    same(
      metricMap(browser),
      Object.fromEntries(
        [...new Set(pages.map(f => f.browser))]
          .sort()
          .map(name => [name, unique(pages.filter(f => f.browser === name))]),
      ),
      'Native browser visitors must filter excluded evidence',
    );
    const country = (await json(`${nativePath}/metrics?${window}&type=country`, { auth: true }))
      .body;
    same(
      metricMap(country),
      { US: unique(pages) },
      'Native country visitors must filter excluded evidence',
    );
    for (const type of ['browser', 'country']) {
      const values = (await json(`${nativePath}/values?${window}&type=${type}`, { auth: true }))
        .body;
      const expected =
        type === 'country'
          ? { US: unique(selected) }
          : Object.fromEntries(
              [...new Set(selected.map(f => f.browser))]
                .sort()
                .map(name => [name, unique(selected.filter(f => f.browser === name))]),
            );
      same(
        Object.fromEntries(
          values.map(row => [row.value, number(row.count)]).sort(([a], [b]) => a.localeCompare(b)),
        ),
        expected,
        'Native filter candidates must count only sessions with eligible events',
      );
    }
    const channels = (await json(`${nativePath}/metrics?${window}&type=channel`, { auth: true }))
      .body;
    same(
      metricMap(channels),
      Object.fromEntries(
        [...new Set(pages.map(f => f.channel))]
          .sort()
          .map(name => [name, unique(pages.filter(f => f.channel === name))]),
      ),
      'Native channel denominators must filter excluded evidence',
    );
    const data = (await json(`${nativePath}/event-data/stats?${window}`, { auth: true })).body;
    ensure(
      number(data.events) === selected.filter(f => f.properties).length &&
        number(data.records) === selected.reduce((n, f) => n + f.properties, 0),
      'Event properties must share the active traffic policy',
    );
    const sales = (await json(`${nativePath}/revenue/stats?${window}&currency=USD`, { auth: true }))
      .body;
    ensure(
      number(sales.count) === revenue.length &&
        number(sales.sum ?? 0) === revenue.reduce((n, f) => n + f.revenue, 0),
      'Revenue count and amount must share the active traffic policy',
    );
    const salesCountries = (
      await json(`${nativePath}/revenue/metrics?${window}&currency=USD&type=country`, {
        auth: true,
      })
    ).body;
    ensure(
      Array.isArray(salesCountries) &&
        salesCountries.length === 1 &&
        number(salesCountries[0].value) === revenue.reduce((n, f) => n + f.revenue, 0),
      'Revenue dimensions must use effective revenue',
    );
    const report = (
      await json(`${sitePath}/report?${window}&resource=human%2Foverview`, { auth: true })
    ).body;
    ensure(
      number(report.cards?.find(card => card.label === '浏览量 PV')?.value) === pages.length,
      'Liekan report cards must share the native policy',
    );
    same(
      Object.fromEntries(
        report.tables.pgBody
          .map(row => [row.path, number(row.pv)])
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
      Object.fromEntries(
        [...new Set(pages.map(f => f.path))]
          .sort()
          .map(path => [path, pages.filter(f => f.path === path).length]),
      ),
      'Liekan page report must preserve effective pageview counts',
    );
    const nativeExport = (await json(`${nativePath}/export?${window}`, { auth: true })).body;
    const exportedPages = csvRows(unzip(nativeExport.zip).get('pages.csv'));
    same(
      metricMap(exportedPages),
      expectedPaths(selected),
      'Native export pages must share the active policy',
    );
    const exportResponse = await http(`${sitePath}/exports`, {
      method: 'POST',
      auth: true,
      body: { startAt, endAt, timezone: 'UTC', format: 'json', sections: ['summary'], filters: {} },
    });
    const frames = (await exportResponse.text())
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    ensure(
      frames.at(-1)?.type === 'complete' && !frames.some(frame => frame.type === 'error'),
      'Liekan export stream must complete',
    );
    const exported = JSON.parse(
      Buffer.concat(
        frames
          .filter(frame => frame.type === 'chunk')
          .map(frame => Buffer.from(frame.data, 'base64')),
      ).toString(),
    );
    ensure(
      number(exported.summary.pageviews) === pages.length &&
        number(exported.summary.visitors) === unique(pages),
      'Liekan summary export must share the native policy',
    );
    const keywords = selected.filter(f => f.keyword),
      expectedKeywords = keywords.map(f => f.keyword).sort();
    const keywordPage = (
      await json(`${sitePath}/page-report?${window}&resource=human%2Fkeywords`, { auth: true })
    ).body;
    ensure(
      number(keywordPage.cards?.find(card => card.key === 'keyword-total')?.value) ===
        unique(keywords),
      'Keyword cursor population must share the active traffic policy',
    );
    same(
      keywordPage.tables.keywordBody.map(row => row.keyword).sort(),
      expectedKeywords,
      'Keyword page must filter automated and suspected entry evidence',
    );
    const keywordExport = await http(`${sitePath}/exports`, {
      method: 'POST',
      auth: true,
      body: {
        kind: 'source-keywords',
        keywordStatusVersion: '2',
        startAt,
        endAt,
        timezone: 'UTC',
        format: 'csv',
      },
    });
    const keywordFrames = (await keywordExport.text())
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    ensure(
      keywordFrames.at(-1)?.type === 'complete' &&
        !keywordFrames.some(frame => frame.type === 'error'),
      'Keyword export cursor must complete',
    );
    const keywordCsv = Buffer.concat(
      keywordFrames
        .filter(frame => frame.type === 'chunk')
        .map(frame => Buffer.from(frame.data, 'base64')),
    ).toString();
    for (const name of ['browser-fixture', 'suspected-fixture', 'automated-fixture'])
      ensure(
        keywordCsv.includes(name) === expectedKeywords.includes(name),
        'Keyword export must share the active cursor policy',
      );
    await verifyPresence(pages.length);
    same(
      await counts(),
      expectedCounts(),
      'Policy reads and exports must preserve original events and evidence',
    );
  }
  async function setPolicy(mode, hosts = []) {
    const before = await sql(
      `SELECT coalesce((SELECT revision FROM liekan_analytics_revision WHERE resource_type='website' AND resource_id=${websiteSql}),0);`,
    );
    const result = (
      await json(qualityPath, {
        method: 'PUT',
        auth: true,
        body: { mode, allowedHostnames: hosts },
      })
    ).body;
    ensure(
      result.mode === mode && result.ruleVersion === 'traffic-quality-v2',
      'Policy response must retain versioned semantics',
    );
    const after = await sql(
      `SELECT revision FROM liekan_analytics_revision WHERE resource_type='website' AND resource_id=${websiteSql};`,
    );
    ensure(
      BigInt(after) > BigInt(before),
      'Policy mutation must advance the durable analytics revision',
    );
    return result;
  }
  await test('standard policy covers native analytics, report and exports', () =>
    verifySurfaces('standard'));
  await test('strict policy invalidates primed cache immediately', async () => {
    await setPolicy('strict');
    await verifySurfaces('strict');
  });
  await test('raw policy includes preserved automated and suspected rows', async () => {
    await setPolicy('raw');
    await verifySurfaces('raw');
  });
  await test('exact normalized allowed hosts filter home and Unicode pages', async () => {
    const policy = await setPolicy('standard', [
      'WWW.QUALITY.EXAMPLE:443',
      'www.例子.测试:443',
      'quality.example',
      '[2001:db8::1]:443',
    ]);
    same(
      policy.allowedHostnames,
      ['[2001:db8::1]', 'quality.example', 'xn--fsqu00a.xn--0zwm56d'],
      'Allowed host settings must normalize case, www, port and Unicode and remove duplicates',
    );
    await verifySurfaces('standard', policy.allowedHostnames);
    const audit = (await json(qualityPath + '?' + window, { auth: true })).body;
    ensure(
      audit.rows.find(row => row.path === '/outside-home')?.included === false &&
        audit.rows.find(row => row.path === '/home')?.included === true &&
        audit.rows.find(row => row.path === '/unicode-home')?.included === true,
      'Allowed host evidence must control inclusion without changing /home paths',
    );
    await json(qualityPath, {
      method: 'PUT',
      auth: true,
      expected: 400,
      body: { mode: 'standard', allowedHostnames: ['quality.example/home'] },
    });
    await json(qualityPath, {
      method: 'PUT',
      auth: true,
      expected: 400,
      body: { mode: 'standard', allowedHostnames: ['*.quality.example'] },
    });
  });
  await test('collection presence remains visible when strict host policy excludes all rows', async () => {
    await setPolicy('strict', ['absent.example']);
    const stats = (await json(`${nativePath}/stats?${window}`, { auth: true })).body;
    ensure(
      number(stats.pageviews) === 0 && number(stats.visitors) === 0,
      'Strict empty host population must invalidate the primed stats cache',
    );
    await verifyPresence(0);
    const analysis = (
      await json(
        `${sitePath}/crawler-analysis?startAt=${startAt}&endAt=${Date.now()}&timezone=UTC`,
        { auth: true },
      )
    ).body;
    const supported = [
      'openai',
      'anthropic',
      'perplexity',
      'bytedance',
      'google',
      'baidu',
      'microsoft',
    ];
    const unsupported = [
      'apple',
      'amazon',
      'mistral',
      'duckduckgo',
      'common-crawl',
      'ai2',
      'sogou',
      '360',
      'yandex',
      'naver',
      'seznam',
      'qwant',
      'mojeek',
      'meta',
      'ahrefs',
      'semrush',
      'majestic',
      'petal',
    ];
    same(
      analysis.platforms.map(row => row.platformId).sort(),
      [...supported, ...unsupported].sort(),
      'Crawler referral rows must retain every independently expected platform exactly once',
    );
    ensure(
      analysis.platforms.every(row =>
        supported.includes(row.platformId)
          ? row.state === 'available' && row.visits === 0
          : row.state === 'unsupported' &&
            row.visits === null &&
            row.conversions === null &&
            row.goalEvents === null &&
            row.landingPages.length === 0,
      ),
      'Mapped crawler referrals must preserve raw connection state with zero eligible visits; unsupported attribution must stay null',
    );
    same(
      await counts(),
      expectedCounts(),
      'Complete analytic exclusion must preserve raw collection evidence',
    );
    await setPolicy('standard', ['quality.example', 'xn--fsqu00a.xn--0zwm56d']);
  });
  await test('repeat migrations preserve checksums and fixture data', async () => {
    const before = await counts();
    await docker(['exec', names.application, 'node', 'scripts/liekan-migrate.mjs']);
    await docker(['exec', names.application, 'node', 'scripts/liekan-migrate.mjs']);
    same(
      await sqlJson(
        'SELECT json_agg(t ORDER BY name) FROM (SELECT name,checksum FROM liekan_migration) t;',
      ),
      migrationBefore,
      'Repeat migrations must preserve all immutable checksums',
    );
    same(await counts(), before, 'Repeat migrations must preserve collected and historical data');
    await verifySurfaces('standard', ['quality.example', 'xn--fsqu00a.xn--0zwm56d']);
  });
  await runTrafficQualityUpgradeChecks({
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
  });
  await test('own-site reset removes receipts and quality with analytics', async () => {
    await http(`${nativePath}/reset`, { method: 'POST', auth: true });
    fixtures.length = 0;
    same(
      await counts(),
      expectedCounts(),
      'Reset must clear events, quality, receipts, properties and revenue',
    );
    const stats = (await json(`${nativePath}/stats?${window}`, { auth: true })).body;
    ensure(
      number(stats.pageviews) === 0 && number(stats.visitors) === 0,
      'Reset must invalidate cached native totals',
    );
    const body = event('/after-reset', {
      timestamp,
      name: 'purchase',
      data: { currency: 'USD', revenue: 2, marker: 'reset' },
    });
    await record(body, browserQuality);
    same(await counts(), expectedCounts(), 'Collection must remain available after reset');
  });
  await test('own-site deletion removes receipts and quality', async () => {
    await http(nativePath, { method: 'DELETE', auth: true });
    fixtures.length = 0;
    same(
      await counts(),
      expectedCounts(),
      'Delete must clear owned analytics, receipts and quality',
    );
    ensure(
      (await sql(
        `SELECT count(*) FROM liekan_collection_policy WHERE website_id=${websiteSql};`,
      )) === '0',
      'Delete must remove the site collection policy',
    );
    await json(qualityPath + '?' + window, { auth: true, expected: 404 });
  });
  console.log(`RESULT traffic-quality: ${cases} cases passed`);
} catch (error) {
  console.error(`FAIL ${stage}: ${error instanceof Error ? error.message : 'Integration failure'}`);
  process.exitCode = 1;
} finally {
  try {
    await cleanup();
    console.log('CLEANUP owned resources removed');
  } catch {
    console.error('FAIL cleanup: owned resources remain');
    process.exitCode = 1;
  }
}
