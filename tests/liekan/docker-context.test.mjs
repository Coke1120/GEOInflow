import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

test('Docker context excludes private local files and retains distributable source and licenses', async t => {
  const root = await mkdtemp(join(tmpdir(), 'liekan-docker-context-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = join(root, 'context');
  const exported = join(root, 'export');
  const privateFiles = [
    '.env',
    '.env.local',
    '.zcode/session.md',
    '.claude/settings.json',
    '.agents/skills/local.md',
    '.vscode/settings.json',
    'CLAUDE.md',
    '.pnpm-store/config.json',
    'nested/.env',
    'nested/.env.production',
    'nested/.local/config.json',
    'nested/.zcode/session.md',
    'scripts/private.env.local',
    'scripts/production.dev.yml',
    'nested/pm2.yml',
    'nested/request.log',
    'outputs/backups/data.dump',
    'nested/node_modules/package.json',
  ];
  const publicFiles = [
    'src/application.ts',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'env.example',
    'scripts/liekan-deploy.sh',
    'scripts/liekan-demo-data/official.ndjson.gz',
  ];
  await mkdir(context);
  await writeFile(join(context, '.dockerignore'), await readFile('.dockerignore'));
  await writeFile(join(context, 'Dockerfile.review'), 'FROM scratch\nCOPY . /\n');
  for (const file of [...privateFiles, ...publicFiles]) {
    await mkdir(dirname(join(context, file)), { recursive: true });
    await writeFile(join(context, file), 'synthetic Docker context fixture\n');
  }
  const result = spawnSync(
    'docker',
    [
      'buildx',
      'build',
      '--network=none',
      '--progress=quiet',
      '-f',
      join(context, 'Dockerfile.review'),
      '--output',
      `type=local,dest=${exported}`,
      context,
    ],
    { encoding: 'utf8', timeout: 60_000 },
  );
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  for (const file of privateFiles) {
    await assert.rejects(access(join(exported, file)), { code: 'ENOENT' }, file);
  }
  for (const file of publicFiles) await access(join(exported, file));
});
