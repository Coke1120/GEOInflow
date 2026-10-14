import { mkdir, readFile, copyFile, writeFile, rename, rm, stat, readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import maxmind from 'maxmind';
import { prepareGeoDatabase } from '../../../../scripts/liekan-geo.mjs';
import { openGeographyBundle, bundleManifestSchema, type BundleManifest } from './bundle';

// One existing worker writes managed generations; all readers keep a fixed snapshot per lookup.
export async function maintainGeography(now = new Date()) {
  const root = process.env.LIEKAN_GEO_DIRECTORY;
  if (!root || process.env.LIEKAN_GEO_UPDATER !== '1') return;
  await mkdir(root, { recursive: true });
  const lock = path.join(root, '.update-lock');
  try {
    await mkdir(lock);
  } catch {
    return;
  }
  let directory: string | undefined;
  try {
    await writeFile(
      path.join(lock, 'owner.json'),
      JSON.stringify({ pid: process.pid, startedAt: now.toISOString() }),
      { mode: 0o600 },
    );
    try {
      const checked = +(await readFile(path.join(root, '.last-check'), 'utf8'));
      if (+now - checked < 86400000) return;
    } catch {
      /* No earlier attempt. */
    }
    await writeFile(path.join(root, '.last-check'), String(+now));
    let old: BundleManifest | undefined;
    try {
      old = bundleManifestSchema.parse(
        JSON.parse(await readFile(path.join(root, 'current.json'), 'utf8')),
      );
    } catch {
      /* First generation. */
    }
    if (old && +now - +new Date(old.publishedAt) < 86400000) return;
    const version = `geo-${+now}-${randomUUID().slice(0, 8)}`;
    directory = path.join(root, version);
    await mkdir(directory);
    const prepared = await prepareGeoDatabase({ directory, now, timeoutMs: 90000 });
    if (prepared.state !== 'ready') throw new Error('mmdb-unavailable');
    const mmdb = path.join(directory, 'GeoLite2-City.mmdb');
    const reader = await maxmind.open(mmdb);
    const record = async (
      file: string,
      provider: string,
      license: string,
      source: string,
      expiresAt: string | null,
      buildTime: string | null,
    ) => ({
      file,
      provider,
      license,
      source,
      authorized: true as const,
      expiresAt,
      buildTime,
      sha256: createHash('sha256')
        .update(await readFile(path.join(directory, file)))
        .digest('hex'),
      downloadedAt: now.toISOString(),
    });
    const custom = prepared.source === 'custom';
    // Custom automatic sources require a private, explicit authorization manifest.
    let authorization: any;
    if (custom) {
      if (!process.env.LIEKAN_GEO_SOURCE_MANIFEST) throw new Error('source-authorization-required');
      authorization = JSON.parse(await readFile(process.env.LIEKAN_GEO_SOURCE_MANIFEST, 'utf8'));
      if (
        authorization.authorized !== true ||
        !authorization.license ||
        !authorization.expiresAt ||
        +new Date(authorization.expiresAt) <= +now
      )
        throw new Error('source-authorization-invalid');
    }
    const manifest: BundleManifest = {
      format: 1,
      managed: true,
      version,
      publishedAt: now.toISOString(),
      mmdb: await record(
        'GeoLite2-City.mmdb',
        prepared.source,
        custom
          ? authorization.license
          : prepared.source === 'MaxMind'
            ? 'GeoLite2 EULA'
            : 'CC BY 4.0',
        custom
          ? 'authorized-custom-source'
          : prepared.source === 'MaxMind'
            ? 'https://www.maxmind.com/'
            : 'https://db-ip.com/db/lite.php',
        custom
          ? authorization.expiresAt
          : prepared.source === 'MaxMind'
            ? new Date(+now + 30 * 86400000).toISOString()
            : null,
        new Date(reader.metadata.buildEpoch).toISOString(),
      ),
    };
    // XDB files are supplied with their own data permission. Code licensing never grants data rights.
    if (process.env.LIEKAN_GEO_XDB_MANIFEST) {
      const supplied = JSON.parse(await readFile(process.env.LIEKAN_GEO_XDB_MANIFEST, 'utf8'));
      for (const family of ['ipv4', 'ipv6'] as const) {
        const file = family + '.xdb',
          input = supplied[family];
        if (
          !input ||
          input.authorized !== true ||
          !input.path ||
          !input.sha256 ||
          !input.license ||
          !input.source ||
          !input.expiresAt ||
          +new Date(input.expiresAt) <= +now
        )
          throw new Error('xdb-authorization-required');
        if ((await stat(input.path)).size > 64 * 1024 * 1024) throw new Error('xdb-too-large');
        await copyFile(input.path, path.join(directory, file));
        manifest[family] = await record(
          file,
          'ip2region',
          input.license,
          input.source,
          input.expiresAt,
          input.buildTime || null,
        );
        if (manifest[family].sha256 !== input.sha256) throw new Error('xdb-checksum-mismatch');
      }
      manifest.activation = supplied.activation;
    } else if (
      old?.ipv4 &&
      old.ipv6 &&
      [old.ipv4, old.ipv6].every(file => !file.expiresAt || +new Date(file.expiresAt) > +now)
    ) {
      // Preserve only still-authorized paired data across a MMDB refresh.
      for (const family of ['ipv4', 'ipv6'] as const) {
        if (old[family].expiresAt && +new Date(old[family].expiresAt) <= +now)
          throw new Error('xdb-authorization-expired');
        await copyFile(
          path.join(root, old.version, old[family].file),
          path.join(directory, old[family].file),
        );
        manifest[family] = old[family];
      }
      // A new MMDB version requires renewed activation validation.
    }
    await openGeographyBundle(root, manifest);
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
    const pointer = path.join(root, `.pointer-${randomUUID()}`);
    await writeFile(pointer, JSON.stringify(manifest));
    await rename(pointer, path.join(root, 'current.json'));
    directory = undefined;
    const owned = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^geo-\d+-[a-f0-9]{8}$/.test(entry.name)) continue;
      try {
        const m = JSON.parse(await readFile(path.join(root, entry.name, 'manifest.json'), 'utf8'));
        if (m.managed === true && m.version === entry.name) owned.push(entry.name);
      } catch {
        /* Ignore unrelated or incomplete directories. */
      }
    }
    for (const obsolete of owned.sort().reverse().slice(3))
      await rm(path.join(root, obsolete), { recursive: true, force: true });
  } catch {
    console.warn('Managed geography update unavailable; permitted previous data retained.');
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}
