import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { create as createTar } from 'tar';
import { prepareGeoDatabase } from '../../scripts/liekan-geo.mjs';

const fixture = await readFile(new URL('./fixtures/GeoIP2-City-Test.mmdb', import.meta.url));
const quiet = { info() {}, warn() {} };
const now = new Date('2026-01-01T00:00:00Z');
async function directory(t) {
  const value = await mkdtemp(path.join(os.tmpdir(), 'liekan-geo-test-'));
  t.after(() => rm(value, { recursive: true, force: true }));
  return value;
}

test('the build command fails on an unavailable default database so retries cannot cache a missing file', async t => {
  const root = await directory(t);
  const script = new URL('../../scripts/build-geo.js', import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `globalThis.fetch = async () => new Response('unavailable', {status:503}); await import(${JSON.stringify(script)});`,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        SKIP_BUILD_GEO: '',
        VERCEL: '',
        GEO_DATABASE_URL: '',
        MAXMIND_LICENSE_KEY: '',
      },
    },
  );
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /City geography unavailable/);
  assert.deepEqual(await readdir(path.join(root, 'geo')), []);
});

test('fresh installation downloads an account-free city MMDB and validates it', async t => {
  const dest = await directory(t);
  const result = await prepareGeoDatabase({
    directory: dest,
    env: {},
    now,
    log: quiet,
    fetchDatabase: async (url, options) => {
      assert.equal(url, 'https://download.db-ip.com/free/dbip-city-lite-2026-01.mmdb.gz');
      assert.equal(options.redirect, 'manual');
      assert.equal(options.headers, undefined);
      return new Response(gzipSync(fixture));
    },
  });
  assert.equal(result.state, 'ready');
  assert.equal(result.source, 'DB-IP Lite');
  assert.deepEqual(await readFile(path.join(dest, 'GeoLite2-City.mmdb')), fixture);
  assert.deepEqual(await readdir(dest), ['GeoLite2-City.mmdb']);
});

test('a valid existing database is preserved without a network request', async t => {
  const dest = await directory(t);
  await writeFile(path.join(dest, 'GeoLite2-City.mmdb'), fixture);
  const result = await prepareGeoDatabase({
    directory: dest,
    env: {},
    log: quiet,
    fetchDatabase: () => assert.fail('existing database should avoid network access'),
  });
  assert.equal(result.source, 'existing');
  assert.deepEqual(await readFile(path.join(dest, 'GeoLite2-City.mmdb')), fixture);
});

test('monthly release delay retries only a 404 with the previous month, including January', async t => {
  const urls = [];
  const result = await prepareGeoDatabase({
    directory: await directory(t),
    env: {},
    now,
    log: quiet,
    fetchDatabase: async url => {
      urls.push(url);
      return urls.length === 1
        ? new Response('', { status: 404 })
        : new Response(gzipSync(fixture));
    },
  });
  assert.equal(result.state, 'ready');
  assert.match(urls[1], /2025-12\.mmdb\.gz$/);
});

test('MaxMind account authentication uses the official endpoint and extracts tar.gz', async t => {
  const dest = await directory(t);
  const chunks = [];
  for await (const chunk of createTar({ gzip: true, cwd: path.resolve('tests/liekan/fixtures') }, [
    'GeoIP2-City-Test.mmdb',
  ]))
    chunks.push(chunk);
  const result = await prepareGeoDatabase({
    directory: dest,
    env: { MAXMIND_ACCOUNT_ID: 'test-account', MAXMIND_LICENSE_KEY: 'test-only-license' },
    log: quiet,
    fetchDatabase: async (url, options) => {
      assert.equal(
        url,
        'https://download.maxmind.com/geoip/databases/GeoLite2-City/download?suffix=tar.gz',
      );
      assert.equal(
        new Headers(options.headers).get('authorization'),
        `Basic ${Buffer.from('test-account:test-only-license').toString('base64')}`,
      );
      return new Response(Buffer.concat(chunks));
    },
  });
  assert.equal(result.state, 'ready');
  assert.deepEqual(await readFile(path.join(dest, 'GeoLite2-City.mmdb')), fixture);
});

test('direct MMDB URLs with query strings install under the expected filename', async t => {
  const dest = await directory(t);
  const result = await prepareGeoDatabase({
    directory: dest,
    env: { GEO_DATABASE_URL: 'https://example.test/city.mmdb?version=2' },
    log: quiet,
    fetchDatabase: async () => new Response(fixture),
  });
  assert.equal(result.state, 'ready');
  assert.deepEqual(await readFile(path.join(dest, 'GeoLite2-City.mmdb')), fixture);
});

for (const failure of ['http', 'html', 'truncated', 'network', 'oversize']) {
  test(`${failure} download leaves the original file intact and removes temporary files`, async t => {
    const dest = await directory(t);
    const original = Buffer.from('unusable existing file');
    await writeFile(path.join(dest, 'GeoLite2-City.mmdb'), original);
    let calls = 0;
    const messages = [];
    const result = await prepareGeoDatabase({
      directory: dest,
      env: {},
      log: { info: quiet.info, warn: value => messages.push(value) },
      fetchDatabase: async () => {
        calls += 1;
        if (failure === 'network') throw new Error('private URL and credential must remain hidden');
        if (failure === 'http') return new Response('unauthorized', { status: 401 });
        if (failure === 'truncated') return new Response(gzipSync(fixture).subarray(0, 10));
        if (failure === 'oversize')
          return new Response('', { headers: { 'content-length': String(512 * 1024 * 1024) } });
        return new Response('<html>access denied</html>');
      },
    });
    assert.equal(result.state, 'unavailable');
    assert.equal(calls, 1);
    assert.deepEqual(await readFile(path.join(dest, 'GeoLite2-City.mmdb')), original);
    assert.deepEqual(await readdir(dest), ['GeoLite2-City.mmdb']);
    assert.match(messages[0], /location fields remain missing/);
    assert.doesNotMatch(messages.join(''), /private URL|credential must/);
  });
}

test('explicit skip still creates geo for the Docker COPY step', async t => {
  const dest = path.join(await directory(t), 'geo');
  const result = await prepareGeoDatabase({
    directory: dest,
    env: { SKIP_BUILD_GEO: '1' },
    log: quiet,
  });
  assert.equal(result.state, 'skipped');
  assert.deepEqual(await readdir(dest), []);
});

test('HTTPS redirects install the file and clear credentials before contacting another origin', async t => {
  const requests = [];
  const result = await prepareGeoDatabase({
    directory: await directory(t),
    log: quiet,
    env: { MAXMIND_ACCOUNT_ID: 'test-account', MAXMIND_LICENSE_KEY: 'test-only-license' },
    fetchDatabase: async (url, options) => {
      requests.push({ url, authorization: new Headers(options.headers).get('authorization') });
      return requests.length === 1
        ? new Response(null, {
            status: 302,
            headers: { location: 'https://database-cdn.test/city.mmdb' },
          })
        : new Response(fixture);
    },
  });
  assert.equal(result.state, 'ready');
  assert.equal(requests.length, 2);
  assert.ok(requests[0].authorization);
  assert.equal(requests[1].authorization, null);
});

test('HTTPS to HTTP redirects are rejected before contacting the plaintext origin', async t => {
  let forwarded;
  const target = createServer((request, response) => {
    forwarded = request.headers.authorization;
    response.end(fixture);
  });
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => target.close(resolve)));
  const redirect = createServer((request, response) => {
    assert.ok(request.headers.authorization);
    response.writeHead(302, { Location: `http://127.0.0.1:${target.address().port}/city.mmdb` });
    response.end();
  });
  await new Promise(resolve => redirect.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => redirect.close(resolve)));
  const result = await prepareGeoDatabase({
    directory: await directory(t),
    log: quiet,
    env: { MAXMIND_ACCOUNT_ID: 'test-account', MAXMIND_LICENSE_KEY: 'test-only-license' },
    fetchDatabase: async (_url, options) => {
      const response = await fetch(`http://127.0.0.1:${redirect.address().port}/redirect`, options);
      return new Response(response.body, { status: response.status, headers: response.headers });
    },
  });
  assert.equal(result.state, 'unavailable');
  assert.equal(forwarded, undefined);
});
