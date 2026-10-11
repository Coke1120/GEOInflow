// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('collects the API regression suite in its Node runtime', () => {
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve('@playwright/test/package.json')), 'cli.js');
  const result = spawnSync(
    process.execPath,
    [cli, 'test', '-c', 'playwright.api.config.ts', '--list', '--reporter=line'],
    {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      encoding: 'utf8',
      timeout: 20000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
  expect(result.stdout).toMatch(/Total: [1-9]\d* tests in [1-9]\d* files/);
  expect(result.stdout).toContain('identifies source keywords through real collection');
}, 25000);
