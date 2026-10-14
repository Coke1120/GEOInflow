// @vitest-environment node
import { expect, test, vi } from 'vitest';
const { locate } = vi.hoisted(() => ({ locate: vi.fn() }));
vi.mock('@/lib/detect', () => ({ getGeographyEvidence: locate }));
import { parseLogInputWithGeography, normalizeAutomaticWithGeography } from './log-geography';
import { parseLogInput } from '../ingest';
import { normalizeAutomatic } from '../log-ingestion/protocol';
const input = {
  format: 'json',
  records: [
    {
      ip: '223.5.5.5',
      time: '2026-10-14T00:00:00Z',
      path: '/hello',
      status: 200,
      method: 'GET',
      userAgent: 'Mozilla/5.0',
    },
  ],
};
const evidence = {
  location: { country: 'CN', region: 'CN-44', city: '广州' },
  source: 'mmdb',
  trust: 'authenticated_server',
  ipFamily: 'ipv4',
  precision: 'city',
  reason: 'city_present',
  ruleVersion: 'v1',
  dataVersion: 'd1',
  cityId: '123',
  accuracyRadius: null,
  countryBasis: 'located',
  processedAt: '2026-10-14T00:00:01Z',
  shadow: null,
};
test('enrichment preserves manual digest and identity without returning raw IP', async () => {
  locate.mockResolvedValue(evidence);
  const baseline = parseLogInput(input, 'example.com', 'fixture-secret');
  const enriched = await parseLogInputWithGeography(input, 'example.com', 'fixture-secret');
  expect(enriched.digest).toBe(baseline.digest);
  expect(enriched.records[0].id).toBe(baseline.records[0].id);
  expect(enriched.records[0].location).toContain('广州');
  expect(JSON.stringify(enriched)).not.toContain('223.5.5.5');
  expect(enriched.records[0].geography.location).toEqual(evidence.location);
});
test('changing the database never changes automatic event identity or digest', async () => {
  const events = [
    {
      generation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      offset: 1,
      line: '223.5.5.5 - - [14/Oct/2026:08:00:00 +0800] "GET /hello HTTP/1.1" 200 20 "-" "Mozilla/5.0"',
    },
  ];
  const args = [
    'server',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    events,
    'example.com',
    'fixture-secret',
  ] as const;
  const original = normalizeAutomatic(...args);
  locate.mockResolvedValue(evidence);
  const first = await normalizeAutomaticWithGeography(...args);
  locate.mockResolvedValue({
    ...evidence,
    dataVersion: 'd2',
    location: { country: 'CN', region: 'CN-11', city: '北京' },
  });
  const next = await normalizeAutomaticWithGeography(...args);
  expect(first.records[0].eventDigest).toBe(original.records[0].eventDigest);
  expect(next.records[0].id).toBe(original.records[0].id);
  expect(first.records[0].location).not.toBe(next.records[0].location);
  expect(JSON.stringify(next)).not.toContain('223.5.5.5');
});
