import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, stat, access, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

async function installation(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'liekan-install-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'scripts'));
  await mkdir(path.join(root, 'bin'));
  await copyFile('scripts/liekan-deploy.sh', path.join(root, 'scripts/liekan-deploy.sh'));
  await writeFile(
    path.join(root, 'bin/docker'),
    [
      '#!/bin/sh',
      'printf \'%s\\n\' "$*" >> "$DEPLOY_TEST_CALLS"',
      'case "$*" in',
      '  \'volume ls --format {{.Name}}\') if [ "${DEPLOY_TEST_VOLUME_EXISTS:-1}" = 0 ]; then printf \'%s\\n\' "${DEPLOY_TEST_VOLUME_NAME:-${COMPOSE_PROJECT_NAME:-liekan}_liekan-data}"; fi ;;',
      '  *\'build app\') if [ "${DEPLOY_TEST_KILL_DEPLOY:-0}" = 1 ]; then kill -KILL "$PPID"; fi; if [ "${DEPLOY_TEST_BLOCK_BUILD:-0}" = 1 ]; then touch "$DEPLOY_TEST_CALLS.building"; sleep 2; fi; exit "${DEPLOY_TEST_BUILD_STATUS:-0}" ;;',
      'esac',
      'exit 0',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  const calls = path.join(root, 'calls');
  const invoke = (method, args) =>
    method('sh', [path.join(root, 'scripts/liekan-deploy.sh'), ...(args || [])], {
      cwd: os.tmpdir(),
      encoding: 'utf8',
      env: {
        ...process.env,
        COMPOSE_PROJECT_NAME: 'liekan',
        PATH: `${root}/bin:${process.env.PATH}`,
        DEPLOY_TEST_CALLS: calls,
        ...options,
      },
    });
  return { root, calls, run: args => invoke(spawnSync, args), start: () => invoke(spawn) };
}

test('one command creates private random configuration and waits for service health', async t => {
  const { root, calls, run } = await installation(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const config = await readFile(path.join(root, '.env'), 'utf8');
  for (const key of ['POSTGRES_PASSWORD', 'APP_SECRET', 'TWO_FACTOR_ENCRYPTION_KEY']) {
    const secret = config.match(new RegExp(`^${key}=([a-f0-9]{64})$`, 'm'))?.[1];
    assert.ok(secret, `${key} should be a random 32-byte secret`);
    assert.ok(!(result.stdout + result.stderr).includes(secret));
  }
  assert.equal((await stat(path.join(root, '.env'))).mode & 0o777, 0o600);
  assert.match(await readFile(calls, 'utf8'), /up -d --no-build --wait --wait-timeout 300/);
});

test('rerunning preserves existing configuration and credentials byte for byte', async t => {
  const { root, run } = await installation(t);
  assert.equal(run().status, 0);
  const original = await readFile(path.join(root, '.env'));
  assert.equal(run().status, 0);
  assert.deepEqual(await readFile(path.join(root, '.env')), original);
});

test('an existing database without its configuration is refused before a build', async t => {
  const { root, calls, run } = await installation(t, { DEPLOY_TEST_VOLUME_EXISTS: '0' });
  assert.equal(run().status, 1);
  await assert.rejects(access(path.join(root, '.env')));
  assert.doesNotMatch(await readFile(calls, 'utf8'), /build app/);
});

test('build failure stops before starting services and preserves the generated configuration', async t => {
  const { root, calls, run } = await installation(t, { DEPLOY_TEST_BUILD_STATUS: '1' });
  assert.equal(run().status, 1);
  await access(path.join(root, '.env'));
  assert.doesNotMatch(await readFile(calls, 'utf8'), /up -d/);
});

test('custom Compose project names also preserve the original database configuration', async t => {
  const { root, run } = await installation(t, {
    DEPLOY_TEST_VOLUME_EXISTS: '0',
    COMPOSE_PROJECT_NAME: 'production',
  });
  assert.equal(run().status, 1);
  await assert.rejects(access(path.join(root, '.env')));
});

test('help has no configuration or Docker side effects', async t => {
  const { root, calls, run } = await installation(t);
  assert.equal(run(['--help']).status, 0);
  await assert.rejects(access(calls));
  await assert.rejects(access(path.join(root, '.env')));
});

test('lost configuration also protects project names previously supplied by .env', async t => {
  const { root, calls, run } = await installation(t, {
    DEPLOY_TEST_VOLUME_EXISTS: '0',
    DEPLOY_TEST_VOLUME_NAME: 'production_liekan-data',
    COMPOSE_PROJECT_NAME: '',
  });
  assert.equal(run().status, 1);
  await assert.rejects(access(path.join(root, '.env')));
  assert.doesNotMatch(await readFile(calls, 'utf8'), /build app/);
});

test('an interrupted deployment releases its lock for a retry and keeps its configuration', async t => {
  const options = { DEPLOY_TEST_KILL_DEPLOY: '1' };
  const { root, run } = await installation(t, options);
  assert.equal(run().signal, 'SIGKILL');
  const original = await readFile(path.join(root, '.env'));
  options.DEPLOY_TEST_KILL_DEPLOY = '0';
  assert.equal(run().status, 0);
  assert.deepEqual(await readFile(path.join(root, '.env')), original);
});

test('a live deployment keeps exclusive ownership of its lock', async t => {
  const { root, calls, run, start } = await installation(t, { DEPLOY_TEST_BLOCK_BUILD: '1' });
  const first = start();
  const completed = new Promise(resolve => first.on('exit', resolve));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await access(`${calls}.building`);
      break;
    } catch {
      await delay(20);
    }
  }
  await access(`${calls}.building`);
  const original = await readFile(path.join(root, '.env'));
  assert.equal(run().status, 1);
  assert.equal(await completed, 0);
  assert.deepEqual(await readFile(path.join(root, '.env')), original);
  assert.equal((await readFile(calls, 'utf8')).match(/build app/g)?.length, 1);
});
