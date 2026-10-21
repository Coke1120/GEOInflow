#!/usr/bin/env node
// This harness owns only its randomly named, labelled PostgreSQL container.
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const runId = randomUUID();
const name = `liekan-history-repair-${runId}`;
const label = 'io.liekan.history-repair-test';
const password = randomBytes(32).toString('hex');
const benchmark = process.argv.includes('--benchmark');
const env = {
  ...process.env,
  DATABASE_URL: `postgresql://history_test:${password}@127.0.0.1:15460/liekan_history_repair_test?schema=history_${runId.replaceAll('-', '')}`,
  LIEKAN_HISTORY_REPAIR_TEST: '1',
  ...(benchmark ? { LIEKAN_HISTORY_REPAIR_BENCHMARK: '1' } : {}),
  APP_SECRET: randomBytes(32).toString('hex'),
  CLICKHOUSE_URL: '',
};
const folder = `${root}/.local/history-repair/${runId}`;
env.LIEKAN_HISTORY_REPAIR_OUTPUT = folder;
let created = false;
let interrupted = false,
  active;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    interrupted = true;
    active?.kill('SIGTERM');
  });
async function run(binary, args, options = {}) {
  if (interrupted && !options.cleanup) throw new Error('History repair acceptance interrupted');
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
        await writeFile(`${folder}/failure.log`, Buffer.concat([...chunks, ...errors]), {
          mode: 0o600,
        });
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
    server.listen(15460, '127.0.0.1', resolve);
  });
  await new Promise(resolve => server.close(resolve));
}
try {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await available();
  await writeFile(
    `${folder}/database.env`,
    `POSTGRES_USER=history_test\nPOSTGRES_PASSWORD=${password}\nPOSTGRES_DB=liekan_history_repair_test\n`,
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
    '127.0.0.1:15460:5432',
    'postgres:15-alpine',
  ]);
  created = true;
  for (let attempt = 0; ; attempt++) {
    const ready = await run(
      'docker',
      ['exec', name, 'pg_isready', '-U', 'history_test', '-d', 'liekan_history_repair_test'],
      { optional: true },
    );
    if (ready.code === 0) break;
    if (attempt >= 30) throw new Error('Isolated PostgreSQL readiness timed out');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  console.log('Isolated history repair PostgreSQL ready');
  await writeFile(
    `${folder}/runtime.env`,
    `DATABASE_URL=${env.DATABASE_URL}\nLIEKAN_HISTORY_REPAIR_TEST=1\nAPP_SECRET=${env.APP_SECRET}\nCLICKHOUSE_URL=\n`,
    { mode: 0o600 },
  );
  console.log(`Protected environment: ${folder}/runtime.env`);
  await run('pnpm', ['exec', 'prisma', 'migrate', 'deploy']);
  await run('node', ['scripts/liekan-migrate.mjs']);
  await run('node', ['scripts/liekan-migrate.mjs']);
  await run('node', ['scripts/liekan-queue-bootstrap.mjs']);
  const files = benchmark
    ? ['src/lib/liekan/upstream/history-repair.benchmark.test.ts']
    : [
        'src/lib/liekan/history-repair/model.test.ts',
        'src/lib/liekan/upstream/history-repair.integration.test.ts',
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
    { timeout: benchmark ? 2400000 : 1200000 },
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
    `History repair PostgreSQL: ${report.numPassedTests} passed, ${report.numFailedTests} failed, ${report.numPendingTests} skipped`,
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
