#!/usr/bin/env node
// This harness owns only its randomly named, labelled PostgreSQL container.
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const runId = randomUUID();
const name = `liekan-crawler-evidence-${runId}`;
const label = 'io.liekan.crawler-evidence-test';
const password = randomBytes(32).toString('hex');
const env = {
  ...process.env,
  DATABASE_URL: `postgresql://crawler_test:${password}@127.0.0.1:15440/liekan_crawler_acceptance`,
  LIEKAN_CRAWLER_TEST: '1',
  APP_SECRET: randomBytes(32).toString('hex'),
  CLICKHOUSE_URL: '',
};
const folder = `${root}/.local/traffic-evidence/${runId}`;
let created = false;
let interrupted = false,
  active;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    interrupted = true;
    active?.kill('SIGTERM');
  });
async function run(binary, args, options = {}) {
  if (interrupted && !options.cleanup) throw new Error('Crawler evidence acceptance interrupted');
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: root,
      env: options.env || env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    active = child;
    const chunks = [];
    let size = 0;
    let forced;
    const stop = () => {
      child.kill('SIGTERM');
      forced = setTimeout(() => child.kill('SIGKILL'), 5000);
    };
    const timer = setTimeout(stop, options.timeout || 180000);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size < 16 * 1024 * 1024) chunks.push(chunk);
      else child.kill('SIGTERM');
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
        await writeFile(`${folder}/failure.log`, Buffer.concat(errors), { mode: 0o600 });
        reject(new Error(`${binary} exited ${code}; protected diagnostics: ${folder}/failure.log`));
      } else resolve({ code, output });
    });
    child.stdin.end(options.input);
  });
}
async function available() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(15440, '127.0.0.1', resolve);
  });
  await new Promise(resolve => server.close(resolve));
}
try {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await available();
  await writeFile(
    `${folder}/database.env`,
    `POSTGRES_USER=crawler_test\nPOSTGRES_PASSWORD=${password}\nPOSTGRES_DB=liekan_crawler_acceptance\n`,
    { mode: 0o600 },
  );
  await run('docker', [
    'run',
    '--detach',
    '--name',
    name,
    '--label',
    `${label}=${runId}`,
    '--env-file',
    `${folder}/database.env`,
    '--publish',
    '127.0.0.1:15440:5432',
    'postgres:15-alpine',
  ]);
  created = true;
  for (let attempt = 0; ; attempt++) {
    const ready = await run(
      'docker',
      ['exec', name, 'pg_isready', '-U', 'crawler_test', '-d', 'liekan_crawler_acceptance'],
      { optional: true },
    );
    if (ready.code === 0) break;
    if (attempt >= 30) throw new Error('Isolated PostgreSQL readiness timed out');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  console.log('Isolated crawler PostgreSQL ready');
  const runtime = {
    docker: JSON.parse(
      (await run('docker', ['info', '--format', '{"cpus":{{.NCPU}},"memory":{{.MemTotal}}}']))
        .output,
    ),
    container: JSON.parse(
      (
        await run('docker', [
          'inspect',
          name,
          '--format',
          '{"nanoCpus":{{.HostConfig.NanoCpus}},"memory":{{.HostConfig.Memory}}}',
        ])
      ).output,
    ),
    postgres: (
      await run('docker', [
        'exec',
        name,
        'psql',
        '-U',
        'crawler_test',
        '-d',
        'liekan_crawler_acceptance',
        '-Atc',
        'SELECT version()',
      ])
    ).output.trim(),
  };
  env.LIEKAN_BENCHMARK_RUNTIME = JSON.stringify(runtime);
  await writeFile(`${folder}/runtime.json`, JSON.stringify(runtime, null, 2), { mode: 0o600 });
  await run('pnpm', ['exec', 'prisma', 'migrate', 'deploy']);
  await run('node', ['scripts/liekan-migrate.mjs']);
  await run('node', ['scripts/liekan-migrate.mjs']);
  const files = [
    'src/lib/liekan/crawlers/analysis.integration.test.ts',
    'src/lib/liekan/rules/population.integration.test.ts',
    'src/lib/liekan/crawlers/evidence.integration.test.ts',
    'src/lib/liekan/upstream/crawler-referrals.integration.test.ts',
  ];
  if (process.env.LIEKAN_EVIDENCE_BENCHMARK === '1') {
    files.push('src/lib/liekan/crawlers/evidence-benchmark.integration.test.ts');
    env.LIEKAN_BENCHMARK_OUTPUT = `${folder}/benchmark.json`;
  }
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
    { timeout: 1200000 },
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
    `Crawler evidence PostgreSQL: ${report.numPassedTests} passed, ${report.numFailedTests} failed, ${report.numPendingTests} skipped`,
  );
  console.log(`Evidence: ${folder}/vitest.json`);
} finally {
  // Re-read ownership before removing a resource, including an interrupted creation.
  const owned = await run(
    'docker',
    ['inspect', '--format', `{{ index .Config.Labels "${label}" }}`, name],
    { optional: true, cleanup: true },
  );
  if (owned.code === 0 && owned.output.trim() === runId)
    await run('docker', ['rm', '--force', '--volumes', name], { cleanup: true });
  else if (created) throw new Error('Isolated container ownership changed; cleanup stopped');
}
