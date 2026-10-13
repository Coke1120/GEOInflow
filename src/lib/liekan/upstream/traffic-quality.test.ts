// @vitest-environment node
import { beforeEach, it, expect, vi } from 'vitest';
vi.mock('./server', () => ({
  LiekanError: class extends Error {
    constructor(
      message: string,
      public status = 400,
    ) {
      super(message);
    }
  },
  transaction: vi.fn(),
  lockWritableWebsite: vi.fn(),
}));
vi.mock('./analytics-revision', () => ({ bumpAnalyticsRevision: vi.fn() }));
vi.mock('./query-cache', () => ({ invalidateWebsiteAnalytics: vi.fn() }));
import {
  normalizeTrafficPolicy,
  parseQualityRange,
  trafficQualityAudit,
  previewTrafficPolicy,
} from './traffic-quality';
beforeEach(() => {
  vi.stubEnv('CLICKHOUSE_URL', '');
});
it('normalizes hostnames consistently for preview and save', () => {
  expect(
    normalizeTrafficPolicy({
      mode: 'standard',
      allowedHostnames: ['WWW.Example.COM:443', 'example.com'],
      expectedRevision: '3',
    }),
  ).toEqual({ mode: 'standard', allowedHostnames: ['example.com'], expectedRevision: '3' });
  expect(() =>
    normalizeTrafficPolicy({ mode: 'standard', allowedHostnames: ['*.example.com'] }),
  ).toThrow();
  expect(() =>
    normalizeTrafficPolicy({ mode: 'raw', allowedHostnames: [], extra: true }),
  ).toThrow();
});
it('bounds audit reads and validates timezones and cursors', () => {
  expect(
    parseQualityRange(
      new URLSearchParams({ startAt: '0', endAt: '1000', timezone: 'Asia/Shanghai' }),
    ),
  ).toMatchObject({ startAt: 0, endAt: 1000, page: 1 });
  for (const params of [
    { startAt: '1001', endAt: '1000' },
    { endAt: 'NaN' },
    { startAt: '0', endAt: String(367 * 86400000) },
    { timezone: 'not-a-timezone' },
    { page: '10001' },
    { source: 'spoofed' },
  ])
    expect(() => parseQualityRange(new URLSearchParams(params))).toThrow();
});
it('reports unsupported ClickHouse capabilities without querying PostgreSQL analytics', async () => {
  vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.fixture');
  expect(await trafficQualityAudit('fixture', new URLSearchParams())).toMatchObject({
    available: false,
  });
  await expect(previewTrafficPolicy('fixture', {}, { userId: 'fixture' })).rejects.toMatchObject({
    status: 501,
  });
});
