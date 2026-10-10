import fs from 'node:fs';
import { mkdtemp, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import maxmind from 'maxmind';
import { Parser } from 'tar';

const MAX_BYTES = 256 * 1024 * 1024;
const databaseName = 'GeoLite2-City.mmdb';

function byteLimit() {
  let total = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      total += chunk.length;
      callback(total > MAX_BYTES ? new Error('database-too-large') : null, chunk);
    },
  });
}

async function cityDatabase(file) {
  const reader = await maxmind.open(file);
  if (!/city/i.test(reader.metadata.databaseType)) throw new Error('city-database-required');
  return reader.metadata.databaseType;
}

function sources(env, now) {
  if (env.GEO_DATABASE_URL) return [{ url: env.GEO_DATABASE_URL, provider: 'custom' }];
  if (env.MAXMIND_LICENSE_KEY) {
    if (!env.MAXMIND_ACCOUNT_ID) throw new Error('maxmind-account-id-required');
    return [
      {
        url: 'https://download.maxmind.com/geoip/databases/GeoLite2-City/download?suffix=tar.gz',
        provider: 'MaxMind',
        headers: {
          Authorization: `Basic ${Buffer.from(`${env.MAXMIND_ACCOUNT_ID}:${env.MAXMIND_LICENSE_KEY}`).toString('base64')}`,
        },
      },
    ];
  }
  // A new monthly release may appear after the first deployment of that month.
  return [0, 1].map(offset => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const month = date.toISOString().slice(0, 7);
    return {
      url: `https://download.db-ip.com/free/dbip-city-lite-${month}.mmdb.gz`,
      provider: 'DB-IP Lite',
    };
  });
}

async function secureDownload(source, fetchDatabase, timeoutMs) {
  let url = new URL(source.url);
  const headers = new Headers(source.headers);
  const signal = AbortSignal.timeout(timeoutMs);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    if (url.protocol !== 'https:') throw new Error('https-required');
    const requestHeaders = Object.fromEntries(headers);
    const response = await fetchDatabase(url.toString(), {
      headers: Object.keys(requestHeaders).length ? requestHeaders : undefined,
      redirect: 'manual',
      signal,
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    await response.body?.cancel();
    const location = response.headers.get('location');
    if (!location) throw new Error('redirect-location-required');
    const next = new URL(location, url);
    if (next.origin !== url.origin) headers.delete('Authorization');
    url = next;
  }
  throw new Error('too-many-redirects');
}

async function extractDatabase(download, candidate) {
  const header = Buffer.alloc(512);
  const handle = await fs.promises.open(download, 'r');
  try {
    await handle.read(header);
  } finally {
    await handle.close();
  }
  if (header[0] !== 0x1f || header[1] !== 0x8b) {
    await rename(download, candidate);
    return;
  }
  const expanded = `${download}.expanded`;
  await pipeline(
    fs.createReadStream(download),
    createGunzip(),
    byteLimit(),
    fs.createWriteStream(expanded),
  );
  const expandedHeader = Buffer.alloc(512);
  const expandedHandle = await fs.promises.open(expanded, 'r');
  try {
    await expandedHandle.read(expandedHeader);
  } finally {
    await expandedHandle.close();
  }
  if (expandedHeader.toString('ascii', 257, 262) !== 'ustar') {
    await rename(expanded, candidate);
    return;
  }
  // Stream only a single regular MMDB entry to our own fixed path. Archive paths
  // never become filesystem destinations, including absolute paths and symlinks.
  const writes = [];
  let matches = 0;
  const archive = new Parser({
    onReadEntry(entry) {
      if (entry.type === 'File' && entry.path.endsWith('.mmdb')) {
        matches += 1;
        if (matches === 1) {
          const write = pipeline(entry, byteLimit(), fs.createWriteStream(candidate));
          write.catch(() => {});
          writes.push(write);
          return;
        }
      }
      entry.resume();
    },
  });
  try {
    await pipeline(fs.createReadStream(expanded), archive);
  } finally {
    await Promise.all(writes);
  }
  if (matches !== 1) throw new Error('one-city-database-required');
}

export async function prepareGeoDatabase({
  env = process.env,
  directory = path.resolve('geo'),
  now = new Date(),
  fetchDatabase = fetch,
  timeoutMs = 900000,
  log = console,
} = {}) {
  await mkdir(directory, { recursive: true });
  if ((env.SKIP_BUILD_GEO && env.SKIP_BUILD_GEO !== '0') || (env.VERCEL && !env.BUILD_GEO)) {
    log.info('Skipping geography setup. Missing location data remains unavailable.');
    return { state: 'skipped' };
  }
  const destination = path.join(directory, databaseName);
  try {
    const databaseType = await cityDatabase(destination);
    log.info(`Using existing city database (${databaseType}).`);
    return { state: 'ready', source: 'existing', databaseType };
  } catch {
    // Invalid or missing files are replaced only after a full download validates.
  }
  let temporary;
  try {
    const candidates = sources(env, now);
    temporary = await mkdtemp(path.join(directory, '.download-'));
    const download = path.join(temporary, 'download');
    const candidate = path.join(temporary, databaseName);
    for (let index = 0; index < candidates.length; index += 1) {
      const source = candidates[index];
      const response = await secureDownload(source, fetchDatabase, timeoutMs);
      if (response.status === 404 && index + 1 < candidates.length) {
        await response.body?.cancel();
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`download-http-${response.status}`);
      }
      if (!response.body || Number(response.headers.get('content-length')) > MAX_BYTES) {
        await response.body?.cancel();
        throw new Error('invalid-download-size');
      }
      log.info(`Preparing city geography database from ${source.provider}.`);
      await pipeline(Readable.fromWeb(response.body), byteLimit(), fs.createWriteStream(download));
      await extractDatabase(download, candidate);
      const databaseType = await cityDatabase(candidate);
      await rename(candidate, destination);
      log.info(`City geography ready (${databaseType}).`);
      return { state: 'ready', source: source.provider, databaseType };
    }
    throw new Error('database-unavailable');
  } catch (error) {
    // External URLs and exception messages may contain credentials. Keep output
    // stable and never include them or any visitor addresses.
    if (error.message === 'maxmind-account-id-required')
      log.warn(
        'MAXMIND_ACCOUNT_ID is required with MAXMIND_LICENSE_KEY. Keep both in private local configuration.',
      );
    else
      log.warn(
        'City geography unavailable. Check network access and retry, or provide an authorized city MMDB in geo/. Running applications preserve collection; location fields remain missing.',
      );
    return { state: 'unavailable' };
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}
