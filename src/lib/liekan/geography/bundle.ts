import { processSingleton } from '../upstream/process-singleton';
import * as xdbRuntime from 'ip2region.js';
import { readFile, stat } from 'node:fs/promises';
import { openSync, closeSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import maxmind from 'maxmind';
import { IPv4, IPv6, newWithBuffer, loadContent } from 'ip2region.js';
import { z } from 'zod';
import { parseXdbRegion, consistentFill, geographyPrecision } from './evidence';

const dataFile = z.object({
  file: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  provider: z.string(),
  source: z.string(),
  license: z.string(),
  authorized: z.literal(true),
  expiresAt: z.iso.datetime().nullable(),
  buildTime: z.string().nullable(),
  downloadedAt: z.iso.datetime(),
});
export const bundleManifestSchema = z.object({
  format: z.literal(1),
  managed: z.boolean().optional(),
  version: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/),
  publishedAt: z.iso.datetime(),
  mmdb: dataFile,
  ipv4: dataFile.optional(),
  ipv6: dataFile.optional(),
  activation: z
    .object({
      approved: z.boolean(),
      mmdbSha256: z.string(),
      ipv4Sha256: z.string(),
      ipv6Sha256: z.string(),
      evidenceId: z.string().nullable(),
      sampleCount: z.number().int(),
      carrierCount: z.number().int(),
      accessTypes: z.array(z.enum(['mobile', 'broadband'])),
      ipv4Count: z.number().int(),
      ipv6Count: z.number().int(),
      provinceCount: z.number().int(),
      newCityCount: z.number().int(),
      provinceAccuracy: z.number(),
      cityAccuracy: z.number(),
      missingReduction: z.number(),
      baselinePreserved: z.boolean(),
      trialDays: z.number().int(),
      independentlyLabeled: z.boolean(),
    })
    .optional(),
});
export type BundleManifest = z.infer<typeof bundleManifestSchema>;
export function activationAllowed(m: BundleManifest) {
  const a = m.activation;
  return !!(
    a?.approved &&
    a.evidenceId &&
    a.mmdbSha256 === m.mmdb?.sha256 &&
    a.ipv4Sha256 === m.ipv4?.sha256 &&
    a.ipv6Sha256 === m.ipv6?.sha256 &&
    a.independentlyLabeled &&
    a.baselinePreserved &&
    a.sampleCount >= 300 &&
    a.carrierCount >= 3 &&
    a.accessTypes.includes('mobile') &&
    a.accessTypes.includes('broadband') &&
    a.ipv4Count >= 100 &&
    a.ipv6Count >= 100 &&
    a.provinceCount >= 20 &&
    a.newCityCount >= 60 &&
    a.provinceAccuracy >= 95 &&
    a.cityAccuracy >= 90 &&
    a.missingReduction >= 30 &&
    a.trialDays >= 7 &&
    m.ipv4 &&
    m.ipv6
  );
}
export function permittedFile(file: z.infer<typeof dataFile>, now = Date.now()) {
  return file.authorized && (!file.expiresAt || +new Date(file.expiresAt) > now);
}
export async function openGeographyBundle(root: string, raw: unknown) {
  const manifest = bundleManifestSchema.parse(raw);
  if (!!manifest.ipv4 !== !!manifest.ipv6) throw new Error('dual-stack-pair-required');
  const dir = path.join(root, manifest.version);
  const files = [manifest.mmdb, manifest.ipv4, manifest.ipv6].filter(Boolean);
  for (const file of files) {
    if (!permittedFile(file)) throw new Error('data-authorization-expired');
    const location = path.join(dir, file.file),
      size = (await stat(location)).size;
    if (size < 256 || size > 256 * 1024 * 1024) throw new Error('invalid-size');
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(location)) digest.update(chunk);
    if (digest.digest('hex') !== file.sha256) throw new Error('checksum-mismatch');
  }
  const mmdb = await maxmind.open(path.join(dir, manifest.mmdb.file));
  if (!/city/i.test(mmdb.metadata.databaseType)) throw new Error('city-mmdb-required');
  const readers = manifest.ipv4
    ? [manifest.ipv4, manifest.ipv6].map((file, i) => {
        const location = path.join(dir, file.file);
        const fd = openSync(location, 'r');
        let bytes: Buffer;
        try {
          (xdbRuntime as typeof xdbRuntime & { verify(fd: number): void }).verify(fd);
          bytes = loadContent(fd);
        } finally {
          closeSync(fd);
        }
        // The v3 XDB header encodes IP version at offset 16. v2 is IPv4 only.
        if (bytes.readUInt16LE(0) === 3 && bytes.readUInt16LE(16) !== (i ? 6 : 4))
          throw new Error('xdb-family-mismatch');
        if (i && bytes.readUInt16LE(0) !== 3) throw new Error('ipv6-xdb-required');
        return newWithBuffer(i ? IPv6 : IPv4, bytes);
      })
    : [];
  for (const ip of ['223.5.5.5', '2400:3200::1']) {
    mmdb.get(ip);
    if (readers.length && !parseXdbRegion(await readers[ip.includes(':') ? 1 : 0].search(ip)))
      throw new Error('xdb-sample-invalid');
  }
  return {
    manifest,
    mmdb: process.env.GEOLITE_DB_PATH ? null : mmdb,
    databaseType: mmdb.metadata.databaseType,
    readers,
  };
}
export type GeographyBundle = Awaited<ReturnType<typeof openGeographyBundle>>;
const bundleState = processSingleton<{
  current: GeographyBundle | null;
  loading?: Promise<GeographyBundle | null>;
  checkedAt: number;
}>('liekan-geography-bundle-1', () => ({ current: null, checkedAt: 0 }));
export async function geographyBundle(): Promise<GeographyBundle | null> {
  const root = process.env.LIEKAN_GEO_DIRECTORY;
  if (!root) return null;
  if (bundleState.loading) return bundleState.loading;
  if (Date.now() - bundleState.checkedAt < 30000) return validCurrent();
  bundleState.loading = (async () => {
    bundleState.checkedAt = Date.now();
    try {
      const raw = JSON.parse(await readFile(path.join(root, 'current.json'), 'utf8'));
      if (raw.version !== bundleState.current?.manifest.version)
        bundleState.current = await openGeographyBundle(root, raw);
    } catch {
      /* Keep a permitted last-good generation; no address or external URL is logged. */
    }
    return validCurrent();
  })().finally(() => {
    bundleState.loading = undefined;
  });
  return bundleState.loading;
}
function validCurrent() {
  return bundleState.current &&
    [
      bundleState.current.manifest.mmdb,
      bundleState.current.manifest.ipv4,
      bundleState.current.manifest.ipv6,
    ]
      .filter(Boolean)
      .every(f => permittedFile(f))
    ? bundleState.current
    : null;
}
export async function enrichChina(
  base: import('../contracts/geography').Geography | null,
  ip: string,
  bundle: GeographyBundle | null,
) {
  if (
    !bundle?.readers.length ||
    (base?.country && base.country !== 'CN') ||
    (base?.region && base?.city)
  )
    return { location: base || {}, reason: 'baseline_preserved', shadow: null, source: 'mmdb' };
  let candidate;
  try {
    candidate = parseXdbRegion(await bundle.readers[ip.includes(':') ? 1 : 0].search(ip));
  } catch {
    candidate = null;
  }
  const filled = consistentFill(base, candidate);
  const active =
    activationAllowed(bundle.manifest) &&
    !process.env.GEOLITE_DB_PATH &&
    process.env.LIEKAN_GEO_CHINA_MODE === 'active';
  return {
    location: active ? filled.location : base || {},
    reason: active ? filled.reason : 'shadow_only',
    shadow: {
      precision: geographyPrecision(filled.location),
      reason: filled.reason,
      cityId: identifyCitySafe(filled.location),
    },
    source: active && filled.reason === 'compatible_fill' ? 'mmdb+ip2region' : 'mmdb',
  };
}
import { identifyCity } from '../contracts/geography';
function identifyCitySafe(value: import('../contracts/geography').Geography) {
  return identifyCity(value).cityId == null ? null : String(identifyCity(value).cityId);
}
export function geographyRuntimeStatus() {
  const bundle = validCurrent();
  const managed = bundle && !process.env.GEOLITE_DB_PATH;
  const fallback = globalThis.maxmind?.metadata;
  const type = managed ? bundle.databaseType : fallback?.databaseType;
  const provider = /dbip|db-ip/i.test(type || '')
    ? 'DB-IP Lite'
    : /geolite|geoip/i.test(type || '')
      ? 'MaxMind'
      : type
        ? 'authorized-custom'
        : null;
  return {
    version: managed ? bundle.manifest.version : fallback ? `${type}:${fallback.buildEpoch}` : null,
    providers: [...(provider ? [provider] : []), ...(bundle?.readers.length ? ['ip2region'] : [])],
    chinaMode:
      bundle &&
      activationAllowed(bundle.manifest) &&
      !process.env.GEOLITE_DB_PATH &&
      process.env.LIEKAN_GEO_CHINA_MODE === 'active'
        ? 'active'
        : 'shadow',
    dataAvailable: !!type,
  };
}
