import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  geographyBundle,
  openGeographyBundle,
  enrichChina,
  activationAllowed,
} from '../../src/lib/liekan/geography/bundle';
const root = await mkdtemp(path.join(tmpdir(), 'liekan-geography-bundle-test-'));
const sources = [
  path.resolve('geo/GeoLite2-City.mmdb'),
  process.env.LIEKAN_GEO_TEST_IPV4_PATH,
  process.env.LIEKAN_GEO_TEST_IPV6_PATH,
];
if (sources.some(file => !file))
  throw new Error(
    'Provide authorized read-only XDB capability fixtures through LIEKAN_GEO_TEST_IPV4_PATH and LIEKAN_GEO_TEST_IPV6_PATH',
  );
const names = ['city.mmdb', 'ipv4.xdb', 'ipv6.xdb'];
const now = Date.now;
const expiresAt = now() + 86400000;
const check = (ok: boolean, label: string) => {
  if (!ok) throw new Error(label);
  console.log(`PASS ${label}`);
};
try {
  const version = 'fixture-v1';
  await mkdir(path.join(root, version));
  const records = await Promise.all(
    sources.map(async (source, i) => {
      await copyFile(source, path.join(root, version, names[i]));
      return {
        file: names[i],
        sha256: createHash('sha256')
          .update(await readFile(source))
          .digest('hex'),
        provider: i ? 'ip2region' : 'DB-IP Lite',
        source: 'public-research-fixture',
        license: 'temporary-read-only-capability-test',
        authorized: true,
        expiresAt: new Date(expiresAt).toISOString(),
        buildTime: null,
        downloadedAt: new Date().toISOString(),
      };
    }),
  );
  const manifest = {
    format: 1,
    version,
    publishedAt: new Date().toISOString(),
    mmdb: records[0],
    ipv4: records[1],
    ipv6: records[2],
  };
  const before = process.memoryUsage().arrayBuffers;
  const opened = await openGeographyBundle(root, manifest);
  check(opened.readers.length === 2, 'real official dual-stack XDB files validate together');
  check(
    !activationAllowed(opened.manifest),
    'capability fixtures never authorize production activation',
  );
  const value = await enrichChina({ country: 'CN' }, '2400:3200::1', opened);
  check(
    value.location.city === undefined && value.shadow?.precision === 'city',
    'real IPv6 query produces shadow geography while retaining baseline',
  );
  const elapsed = [];
  for (let i = 0; i < 10000; i++) {
    const begin = performance.now();
    await enrichChina({ country: 'CN' }, i % 2 ? '223.5.5.5' : '2400:3200::1', opened);
    elapsed.push(performance.now() - begin);
  }
  elapsed.sort((a, b) => a - b);
  const p95 = elapsed[9500],
    resident = (process.memoryUsage().arrayBuffers - before) / 1024 / 1024;
  check(
    p95 <= 5 && resident <= 80,
    `warm two-address capability benchmark: P95 ${p95.toFixed(3)} ms, incremental buffers ${resident.toFixed(1)} MiB`,
  );
  await writeFile(path.join(root, 'current.json'), JSON.stringify(manifest));
  process.env.LIEKAN_GEO_DIRECTORY = root;
  const first = await geographyBundle();
  let clock = now() + 31000;
  Date.now = () => clock;
  await writeFile(
    path.join(root, 'current.json'),
    JSON.stringify({
      ...manifest,
      version: 'fixture-bad',
      ipv6: { ...records[2], sha256: '0'.repeat(64) },
    }),
  );
  check(
    (await geographyBundle())?.manifest.version === first?.manifest.version,
    'invalid replacement retains the permitted complete previous generation',
  );
  clock += 31000;
  check(
    (await Promise.all(Array.from({ length: 20 }, () => geographyBundle()))).every(
      b => b?.manifest.version === version,
    ),
    'concurrent refresh readers observe one complete generation',
  );
  clock = expiresAt + 1;
  check(
    (await geographyBundle()) === null,
    'expired data authorization disables the previous generation',
  );
} finally {
  Date.now = now;
  delete process.env.LIEKAN_GEO_DIRECTORY;
  await rm(root, { recursive: true, force: true });
}
