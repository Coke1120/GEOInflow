import 'dotenv/config';
import { Client } from 'pg';
import { randomUUID, randomBytes } from 'node:crypto';
import { build } from 'esbuild';
import { execFileSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';
const address = new URL(process.env.DATABASE_URL);
if (address.hostname !== '127.0.0.1' || address.port !== '15435' || address.pathname !== '/liekan')
  throw new Error('Integration tests require the isolated local Liekan database host');
const name = `liekan_log_test_${randomUUID().replaceAll('-', '')}`;
const admin = new Client({ connectionString: address.toString() });
await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(address);
  url.pathname = `/${name}`;
  url.search = '';
  const environment = {
    ...process.env,
    DATABASE_URL: url.toString(),
    DIRECT_DATABASE_URL: url.toString(),
    APP_SECRET: randomBytes(32).toString('hex'),
    LIEKAN_LOG_CREDENTIALS_KEY: randomBytes(32).toString('base64'),
    LIEKAN_PUBLIC_URL: 'https://logs.example',
    CLOUDFLARE_OAUTH_CLIENT_ID: 'integration-client',
    CLOUDFLARE_OAUTH_CLIENT_SECRET: 'integration-client-secret',
  };
  const run = (file, args) =>
    execFileSync(file, args, { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  run(resolve('node_modules/.bin/prisma'), ['migrate', 'deploy']);
  run(process.execPath, ['scripts/liekan-migrate.mjs']);
  run(process.execPath, ['scripts/liekan-queue-bootstrap.mjs']);
  // A second run must be idempotent and preserve immutable registry checksums.
  run(process.execPath, ['scripts/liekan-migrate.mjs']);
  run(process.execPath, ['scripts/liekan-queue-bootstrap.mjs']);
  await build({
    entryPoints: [
      process.argv.includes('--load')
        ? 'tests/liekan/log-load.ts'
        : 'tests/liekan/log-integration.ts',
    ],
    outfile: 'dist/liekan-log-integration.mjs',
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    packages: 'external',
    banner: {
      js: "import { createRequire } from 'node:module'; const require=createRequire(import.meta.url);",
    },
    plugins: [
      {
        name: 'prisma-runtime',
        setup(builder) {
          builder.onResolve({ filter: /^@\/generated\/prisma\/client$/ }, () => ({
            path: '../generated/prisma/client.js',
            external: true,
          }));
        },
      },
    ],
  });
  const test = spawn(process.execPath, ['dist/liekan-log-integration.mjs'], {
    env: environment,
    stdio: 'inherit',
  });
  const code = await new Promise((done, reject) => {
    test.on('error', reject);
    test.on('exit', done);
  });
  if (code !== 0) throw new Error('Integration fixture failed');
} catch (error) {
  console.error('Isolated log integration verification failed.');
  if (error.stderr) console.error(String(error.stderr).replaceAll(address.password, '[redacted]'));
  process.exitCode = 1;
} finally {
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
}
