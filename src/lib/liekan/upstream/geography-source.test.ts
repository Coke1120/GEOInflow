// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ bundle: vi.fn() }));
vi.mock('../geography/bundle', async importOriginal => ({
  ...(await importOriginal<typeof import('../geography/bundle')>()),
  geographyBundle: mocks.bundle,
}));
import { getGeographyEvidence } from '@/lib/detect';
beforeEach(() => {
  vi.stubEnv('GEOLITE_DB_PATH', '');
  vi.stubEnv('LIEKAN_GEO_CHINA_MODE', 'active');
  vi.stubEnv('SKIP_LOCATION_HEADERS', '');
  delete globalThis.maxmind;
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete globalThis.maxmind;
});
function bundle(result: any) {
  return {
    manifest: {
      version: 'synthetic-managed',
      mmdb: { sha256: 'a' },
      ipv4: { sha256: 'b' },
      ipv6: { sha256: 'c' },
      activation: {
        approved: true,
        mmdbSha256: 'a',
        ipv4Sha256: 'b',
        ipv6Sha256: 'c',
        evidenceId: 'synthetic-test-only',
        sampleCount: 300,
        carrierCount: 3,
        accessTypes: ['mobile', 'broadband'],
        ipv4Count: 100,
        ipv6Count: 100,
        provinceCount: 20,
        newCityCount: 60,
        provinceAccuracy: 95,
        cityAccuracy: 90,
        missingReduction: 30,
        baselinePreserved: true,
        trialDays: 7,
        independentlyLabeled: true,
      },
    },
    mmdb: { metadata: { databaseType: 'DBIP-City-Lite', buildEpoch: 1 }, get: () => result },
    readers: [{ search: () => '中国|广东省|广州市|移动|CN' }],
  };
}
test.each([
  [null, 'ingress_header+ip2region'],
  [
    { country: { iso_code: 'CN' }, subdivisions: [{ iso_code: '44' }] },
    'ingress_header+mmdb+ip2region',
  ],
])('identifies every source that contributes to a header-based fill', async (mmdb, source) => {
  mocks.bundle.mockResolvedValue(bundle(mmdb));
  const result = await getGeographyEvidence(
    { ip: '223.5.5.5', source: 'trusted_ingress', trusted: true },
    new Headers({ 'cf-ipcountry': 'CN' }),
    false,
  );
  expect(result.location.city).toBe('广州');
  expect(result.source).toBe(source);
});
test('an independent XDB result records its own source and country basis', async () => {
  mocks.bundle.mockResolvedValue(bundle(null));
  const result = await getGeographyEvidence({
    ip: '223.5.5.5',
    source: 'unverified',
    trusted: false,
  });
  expect(result).toMatchObject({
    source: 'ip2region',
    countryBasis: 'located',
    location: { country: 'CN', city: '广州' },
  });
});
