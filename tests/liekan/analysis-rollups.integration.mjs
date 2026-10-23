#!/usr/bin/env node
// This harness owns only its randomly named, labelled PostgreSQL container.
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args[0] === '--') args.shift();
const benchmark = args.includes('--benchmark');
const captureBenchmark = args.includes('--capture-benchmark');
if (benchmark && captureBenchmark) throw new Error('Select one benchmark mode');
let rows = 1000000,
  candidateImage = process.env.LIEKAN_TRAFFIC_IMAGE;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--benchmark' || args[index] === '--capture-benchmark') continue;
  if (args[index] === '--candidate-image' && args[index + 1]) {
    candidateImage = args[++index];
    continue;
  }
  if (args[index] === '--rows' && args[index + 1]) {
    rows = Number(args[++index]);
    continue;
  }
  throw new Error(
    'Usage: node tests/liekan/analysis-rollups.integration.mjs [--benchmark|--capture-benchmark --rows 10000|1000000|10000000] [--candidate-image image]',
  );
}
if (
  (!benchmark && !captureBenchmark && args.includes('--rows')) ||
  ![10000, 1000000, 10000000].includes(rows)
)
  throw new Error('Benchmark rows must be 10000 (smoke), 1000000, or 10000000');
if (
  captureBenchmark &&
  (!candidateImage || !/^[a-zA-Z0-9][a-zA-Z0-9_./:@-]+$/.test(candidateImage))
)
  throw new Error(
    'Capture benchmark requires --candidate-image with the built production candidate',
  );
const root = fileURLToPath(new URL('../../', import.meta.url));
const runId = randomUUID();
const name = `liekan-analysis-rollups-${runId}`;
const label = 'io.liekan.analysis-rollups-test';
const workerName = `${name}-worker`;
const password = randomBytes(32).toString('hex');
const image = process.env.LIEKAN_ANALYSIS_ROLLUPS_PG_IMAGE || 'postgres:15-alpine';
if (!['postgres:15-alpine', 'postgres:16-alpine'].includes(image))
  throw new Error('Only PostgreSQL15/16 acceptance images are allowed');
const env = {
  ...process.env,
  DATABASE_URL: `postgresql://analysis_test:${password}@127.0.0.1:15462/liekan_analysis_rollups_test?schema=analysis_${runId.replaceAll('-', '')}`,
  LIEKAN_ANALYSIS_ROLLUPS_TEST: '1',
  APP_SECRET: randomBytes(32).toString('hex'),
  CLICKHOUSE_URL: '',
  DATABASE_REPLICA_URL: '',
  REDIS_URL: '',
  LIEKAN_ANALYTICS_REDIS_URL: '',
};
const folder = `${root}/.local/analysis-rollups/${runId}`;
env.LIEKAN_ANALYSIS_ROLLUPS_OUTPUT = folder;
if (captureBenchmark) {
  env.LIEKAN_ANALYSIS_ROLLUPS_CONTAINER = name;
  env.LIEKAN_ANALYSIS_ROLLUPS_OWNER = runId;
  env.LIEKAN_ANALYSIS_ROLLUPS_WORKER = workerName;
  env.LIEKAN_ANALYSIS_ROLLUPS_WORKER_ENV = `${folder}/worker.env`;
}
if (benchmark || captureBenchmark) {
  if (benchmark) env.LIEKAN_ANALYSIS_ROLLUPS_BENCHMARK = '1';
  if (captureBenchmark) env.LIEKAN_ANALYSIS_CAPTURE_BENCHMARK = '1';
  env.LIEKAN_ANALYSIS_ROLLUPS_BENCHMARK_ROWS = String(rows);
}
let created = false;
let interrupted = false,
  active;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    interrupted = true;
    if (active) stopProcess(active, 'SIGTERM');
  });
function stopProcess(child, signal) {
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
async function run(binary, args, options = {}) {
  if (interrupted && !options.cleanup) throw new Error('Analysis rollups acceptance interrupted');
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: root,
      env: options.env || env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    active = child;
    const chunks = [];
    let size = 0;
    let forced;
    const stop = () => {
      stopProcess(child, 'SIGTERM');
      forced = setTimeout(() => stopProcess(child, 'SIGKILL'), 5000);
    };
    const timer = setTimeout(stop, options.timeout || 180000);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size < 16 * 1024 * 1024) chunks.push(chunk);
      else stopProcess(child, 'SIGTERM');
    });
    // Commands can include credentials in diagnostics; retain them only in the protected run folder.
    const errors = [];
    child.stderr.on('data', chunk => {
      if (errors.length < 10000) errors.push(chunk);
    });
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error(`${binary} could not start`));
    });
    child.on('close', async code => {
      clearTimeout(timer);
      clearTimeout(forced);
      if (active === child) active = null;
      const output = Buffer.concat(chunks).toString();
      if (code !== 0 && !options.optional) {
        await writeFile(`${folder}/failure.log`, Buffer.concat([...chunks, ...errors]), {
          mode: 0o600,
        });
        reject(new Error(`${binary} exited ${code}; protected diagnostics: ${folder}/failure.log`));
      } else
        resolve({
          code,
          output:
            binary === 'docker' && args[0] === 'logs'
              ? Buffer.concat([...chunks, ...errors]).toString()
              : output,
        });
    });
    child.stdin.end(options.input);
  });
}
async function available() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(15462, '127.0.0.1', resolve);
  });
  await new Promise(resolve => server.close(resolve));
}
try {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await available();
  if (captureBenchmark) {
    await run('node', ['--test', 'tests/liekan/analysis-capture-statistics.test.mjs']);
    const inspected = await run('docker', [
      'image',
      'inspect',
      '--format',
      '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}}',
      candidateImage,
    ]);
    const [id, revision] = inspected.output.trim().split(/\s+/);
    if (!/^sha256:[a-f0-9]{64}$/.test(id) || !/^[a-f0-9]{40}$/.test(revision))
      throw new Error('Capture candidate requires pinned image ID and revision metadata');
    env.LIEKAN_ANALYSIS_ROLLUPS_CANDIDATE_ID = id;
    await writeFile(
      `${folder}/candidate.json`,
      JSON.stringify(
        {
          image: candidateImage,
          id,
          revision,
          entrypoint: 'node dist/liekan-analytics-worker.mjs',
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    const internal = new URL(env.DATABASE_URL);
    internal.port = '5432';
    await writeFile(
      `${folder}/worker.env`,
      `DATABASE_URL=${internal.toString()}\nAPP_SECRET=${env.APP_SECRET}\nDATABASE_REPLICA_URL=\nCLICKHOUSE_URL=\nREDIS_URL=\nLIEKAN_ANALYTICS_REDIS_URL=\n`,
      { mode: 0o600 },
    );
  }
  await writeFile(
    `${folder}/database.env`,
    `POSTGRES_USER=analysis_test\nPOSTGRES_PASSWORD=${password}\nPOSTGRES_DB=liekan_analysis_rollups_test\n`,
    { mode: 0o600 },
  );
  await run('docker', [
    'run',
    '--detach',
    '--name',
    name,
    '--label',
    `${label}=${runId}`,
    '--shm-size',
    '256m',
    '--env-file',
    `${folder}/database.env`,
    '--publish',
    '127.0.0.1:15462:5432',
    image,
  ]);
  created = true;
  for (let attempt = 0; ; attempt++) {
    const ready = await run(
      'docker',
      ['exec', name, 'pg_isready', '-U', 'analysis_test', '-d', 'liekan_analysis_rollups_test'],
      { optional: true },
    );
    if (ready.code === 0) break;
    if (attempt >= 30) throw new Error('Isolated PostgreSQL readiness timed out');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  console.log('Isolated analysis rollups PostgreSQL ready');
  await writeFile(
    `${folder}/runtime.env`,
    `DATABASE_URL=${env.DATABASE_URL}\nLIEKAN_ANALYSIS_ROLLUPS_TEST=1\nAPP_SECRET=${env.APP_SECRET}\nCLICKHOUSE_URL=\n`,
    { mode: 0o600 },
  );
  console.log(`Protected environment: ${folder}/runtime.env`);
  await run('pnpm', ['exec', 'prisma', 'migrate', 'deploy']);
  await run('node', ['scripts/liekan-migrate.mjs']);
  await run('node', ['scripts/liekan-migrate.mjs']);
  await run('node', ['scripts/liekan-queue-bootstrap.mjs']);
  if (captureBenchmark) {
    const started = Date.now();
    await run('docker', [
      'run',
      '--detach',
      '--name',
      workerName,
      '--cpus=1',
      '--memory=512m',
      '--label',
      `${label}=${runId}`,
      '--network',
      `container:${name}`,
      '--env-file',
      `${folder}/worker.env`,
      '--entrypoint',
      'node',
      env.LIEKAN_ANALYSIS_ROLLUPS_CANDIDATE_ID,
      'dist/liekan-analytics-worker.mjs',
    ]);
    const budgetInspection = await run('docker', [
      'inspect',
      '--format',
      '{{json .HostConfig}}',
      workerName,
    ]);
    const workerBudget = JSON.parse(budgetInspection.output);
    await writeFile(
      `${folder}/worker-preflight-budget.json`,
      JSON.stringify(
        {
          NanoCpus: workerBudget.NanoCpus,
          Memory: workerBudget.Memory,
          NetworkMode: workerBudget.NetworkMode,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    if (workerBudget.NanoCpus !== 1000000000 || workerBudget.Memory !== 536870912)
      throw new Error('Capture worker production resource limits are missing');
    for (let attempt = 0; ; attempt++) {
      const heartbeat = await run(
        'docker',
        ['exec', workerName, 'cat', '/tmp/liekan-analytics-worker-heartbeat'],
        { optional: true },
      );
      if (heartbeat.code === 0 && Number(heartbeat.output.trim()) >= started) break;
      const running = await run(
        'docker',
        ['inspect', '--format', '{{.State.Running}}', workerName],
        { optional: true },
      );
      if (running.output.trim() !== 'true' || attempt >= 60) {
        const logs = await run('docker', ['logs', workerName], { optional: true });
        await writeFile(`${folder}/worker-preflight.log`, logs.output, { mode: 0o600 });
        throw new Error('Owned production worker preflight failed before capture measurements');
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    await run('docker', ['stop', '--time', '15', workerName], { timeout: 30000 });
    const state = await run('docker', ['inspect', '--format', '{{json .State}}', workerName]);
    await writeFile(`${folder}/worker-preflight.json`, state.output, { mode: 0o600 });
    const final = JSON.parse(state.output);
    if (final.Running || final.ExitCode !== 0)
      throw new Error('Owned production worker preflight did not stop gracefully');
    const ownership = await run('docker', [
      'inspect',
      '--format',
      `{{ index .Config.Labels "${label}" }}`,
      workerName,
    ]);
    if (ownership.output.trim() !== runId)
      throw new Error('Capture worker ownership changed before preflight cleanup');
    await run('docker', ['rm', '--volumes', workerName]);
  }
  const files = captureBenchmark
    ? ['src/lib/liekan/upstream/analysis-capture.benchmark.test.ts']
    : benchmark
      ? ['src/lib/liekan/upstream/analysis-rollups.benchmark.test.ts']
      : [
          'src/lib/liekan/upstream/analysis-ingestion.integration.test.ts',
          'src/lib/liekan/upstream/analysis-revenue.integration.test.ts',
          'src/lib/liekan/upstream/analysis-rollups.integration.test.ts',
          'src/lib/liekan/upstream/analysis-queries.integration.test.ts',
        ];
  await run(
    'pnpm',
    [
      'exec',
      'vitest',
      'run',
      ...files,
      '--maxWorkers=1',
      '--reporter=json',
      `--outputFile=${folder}/vitest.json`,
    ],
    { timeout: benchmark || captureBenchmark ? 7200000 : 1200000 },
  );
  const report = JSON.parse(await readFile(`${folder}/vitest.json`, 'utf8'));
  if (
    !report.success ||
    report.numPassedTests < 1 ||
    report.testResults.some(
      suite => !suite.assertionResults?.some(test => test.status === 'passed'),
    )
  )
    throw new Error('A required PostgreSQL suite failed or did not execute');
  console.log(
    `Analysis rollups PostgreSQL: ${report.numPassedTests} passed, ${report.numFailedTests} failed, ${report.numPendingTests} skipped`,
  );
  console.log(`Evidence: ${folder}/vitest.json`);
  if (captureBenchmark) console.log(`Capture evidence: ${folder}/capture-benchmark.json`);
  if (benchmark) {
    const measurements = JSON.parse(await readFile(`${folder}/benchmark.json`, 'utf8'));
    console.log(
      `Scale benchmark: ${measurements.population.totalRows} raw rows across10sites; ${measurements.population.selectedSiteRows} selected-site rows; ${measurements.samplesPerPath} logical-cold samples per path`,
    );
    console.log(
      `Measured read p95(ms): raw=${measurements.reads.raw.p95Ms}, covered=${measurements.reads.covered.p95Ms}; build(ms)=${measurements.build.elapsedMs}`,
    );
    console.log(`Benchmark evidence: ${folder}/benchmark.json`);
  }
} finally {
  // Re-read ownership before removing a resource, including an interrupted creation.
  if (captureBenchmark) {
    const ownedWorker = await run(
      'docker',
      ['inspect', '--format', `{{ index .Config.Labels "${label}" }}`, workerName],
      { optional: true, cleanup: true },
    );
    if (ownedWorker.code === 0) {
      if (ownedWorker.output.trim() !== runId)
        throw new Error('Capture worker ownership changed; cleanup stopped');
      await run('docker', ['rm', '--force', '--volumes', workerName], { cleanup: true });
    }
  }
  const owned = await run(
    'docker',
    ['inspect', '--format', `{{ index .Config.Labels "${label}" }}`, name],
    { optional: true, cleanup: true },
  );
  if (owned.code === 0 && owned.output.trim() === runId)
    await run('docker', ['rm', '--force', '--volumes', name], { cleanup: true });
  else if (created) throw new Error('Isolated container ownership changed; cleanup stopped');
}
