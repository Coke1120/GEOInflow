import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const { open, warn } = vi.hoisted(() => ({ open: vi.fn(), warn: vi.fn() }));
vi.mock('maxmind', () => ({ default: { open } }));
vi.mock('is-localhost-ip', () => ({ default: async () => false }));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-10T00:00:00Z'));
  delete globalThis.maxmind;
  delete process.env.SKIP_LOCATION_HEADERS;
  open.mockReset();
  warn.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(warn);
});
afterEach(() => {
  delete globalThis.maxmind;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('missing city database preserves collection metadata with missing geography', async () => {
  open.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
  const { getClientInfo } = await import('@/lib/detect');
  const result = await getClientInfo(new Request('https://example.test/api/send'), {
    ip: '192.0.2.1',
    userAgent: 'Mozilla/5.0',
    device: 'desktop',
  });
  expect(result).toMatchObject({
    device: 'desktop',
    country: undefined,
    region: undefined,
    city: undefined,
  });
  expect(open).toHaveBeenCalledTimes(1);
});

test('concurrent lookups share one open attempt and retry after the database becomes available', async () => {
  open.mockRejectedValue(new Error('invalid MMDB'));
  const { getLocation } = await import('@/lib/detect');
  const locate = () => getLocation('192.0.2.1', new Headers(), true);
  expect(await Promise.all(Array.from({ length: 20 }, locate))).toEqual(Array(20).fill(null));
  expect(open).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(await locate()).toBeNull();
  expect(open).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + 60_001);
  open.mockResolvedValue({
    get: () => ({
      country: { iso_code: 'CN' },
      subdivisions: [{ iso_code: '11' }],
      city: { names: { en: 'Beijing' } },
    }),
  });
  expect(await locate()).toEqual({ country: 'CN', region: 'CN-11', city: 'Beijing' });
  expect(open).toHaveBeenCalledTimes(2);
});

test('provider geography headers continue to work when the local database is unavailable', async () => {
  const { getLocation } = await import('@/lib/detect');
  expect(
    await getLocation(
      '192.0.2.1',
      new Headers({ 'cf-ipcountry': 'CN', 'cf-region-code': '11', 'cf-ipcity': 'Beijing' }),
      false,
    ),
  ).toEqual({ country: 'CN', region: 'CN-11', city: 'Beijing' });
  expect(open).not.toHaveBeenCalled();
});

test('fills partial provider geography only from a consistent local city result', async () => {
  open.mockResolvedValue({
    get: () => ({
      country: { iso_code: 'CN' },
      subdivisions: [{ iso_code: '37' }],
      city: { names: { en: 'Jinan' } },
    }),
  });
  const { getLocation } = await import('@/lib/detect');
  expect(
    await getLocation(
      '192.0.2.1',
      new Headers({ 'cf-ipcountry': 'CN', 'cf-region-code': 'SD' }),
      false,
    ),
  ).toEqual({ country: 'CN', region: 'CN-SD', city: 'Jinan' });
});

test.each([
  ['CN', '61', 'Jinan'],
  ['US', '37', 'Jinan'],
])(
  'keeps partial headers when the database returns conflicting country or province',
  async (country, region, city) => {
    open.mockResolvedValue({
      get: () => ({
        country: { iso_code: country },
        subdivisions: [{ iso_code: region }],
        city: { names: { en: city } },
      }),
    });
    const { getLocation } = await import('@/lib/detect');
    expect(
      await getLocation(
        '192.0.2.1',
        new Headers({ 'cf-ipcountry': 'CN', 'cf-region-code': 'SD' }),
        false,
      ),
    ).toEqual({ country: 'CN', region: 'CN-SD', city: null });
  },
);

test('retains a country-only header when the city database is unavailable', async () => {
  open.mockRejectedValue(new Error('missing'));
  const { getLocation } = await import('@/lib/detect');
  expect(await getLocation('192.0.2.1', new Headers({ 'cf-ipcountry': 'CN' }), false)).toEqual({
    country: 'CN',
    region: null,
    city: null,
  });
});

test('fills a country-only header without changing the supplied country or raw city language', async () => {
  open.mockResolvedValue({
    get: () => ({
      country: { iso_code: 'CN' },
      subdivisions: [{ iso_code: '37' }],
      city: { names: { en: 'Jinan', 'zh-CN': '济南' } },
    }),
  });
  const { getLocation } = await import('@/lib/detect');
  expect(await getLocation('192.0.2.1', new Headers({ 'cf-ipcountry': 'CN' }), false)).toEqual({
    country: 'CN',
    region: 'CN-37',
    city: 'Jinan',
  });
});

test('a damaged lookup tree also preserves collection and enters the bounded retry interval', async () => {
  open.mockResolvedValue({
    get: () => {
      throw new Error('corrupt search tree');
    },
  });
  const { getClientInfo } = await import('@/lib/detect');
  const collect = () =>
    getClientInfo(new Request('https://example.test/api/send'), {
      ip: '2001:db8::1',
      device: 'desktop',
    });
  expect(await collect()).toMatchObject({ device: 'desktop', country: undefined });
  expect(await collect()).toMatchObject({ device: 'desktop', country: undefined });
  expect(open).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledTimes(1);
});

test.each(['country', 'region', 'city'])(
  'invalid %s field types preserve collection',
  async field => {
    open.mockResolvedValue({
      get: () => ({
        country: { iso_code: field === 'country' ? 123 : 'CN' },
        subdivisions: [{ iso_code: field === 'region' ? 123 : '11' }],
        city: { names: { en: field === 'city' ? 123 : 'Beijing' } },
      }),
    });
    const { getClientInfo } = await import('@/lib/detect');
    const collect = () =>
      getClientInfo(new Request('https://example.test/api/send'), {
        ip: '192.0.2.1',
        device: 'desktop',
      });
    expect(await collect()).toMatchObject({
      device: 'desktop',
      country: undefined,
      region: undefined,
      city: undefined,
    });
    await collect();
    expect(open).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  },
);
