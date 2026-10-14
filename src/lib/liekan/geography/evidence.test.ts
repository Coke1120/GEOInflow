// @vitest-environment node
import { expect, test } from 'vitest';
import { consistentFill, geographyPrecision, parseXdbRegion, providerText } from './evidence';
import { activationAllowed, bundleManifestSchema, enrichChina } from './bundle';

test('explicit mainland provider adaptation preserves ambiguous and unknown real names', () => {
  expect(parseXdbRegion('中国|广东省|广州市|移动|CN')).toEqual({
    country: 'CN',
    region: 'CN-44',
    city: '广州',
  });
  expect(parseXdbRegion('中国|内蒙古自治区|呼和浩特市|电信|CN')).toMatchObject({
    region: 'CN-15',
    city: '呼和浩特',
  });
  expect(parseXdbRegion('中国|广东省|未收录镇|移动|CN').city).toBe('未收录镇');
  expect(parseXdbRegion('中国|0|0|0|CN')).toEqual({ country: 'CN', region: null, city: null });
  expect(parseXdbRegion('美国|California|Mountain View|Google|US')).toBeNull();
  expect(parseXdbRegion('中国|未知省份|北京|0|CN')).toBeNull();
  expect(providerText('unknown')).toBeNull();
  expect(providerText('223.5.5.5')).toBeNull();
  expect(providerText('2400:3200::1')).toBeNull();
  expect(providerText('Mozilla/5.0')).toBeNull();
});
test('fills only context-compatible gaps and retains complete tuples', () => {
  const candidate = { country: 'CN', region: 'CN-44', city: '广州' };
  expect(consistentFill({ country: 'CN' }, candidate).location).toEqual(candidate);
  expect(consistentFill({ country: 'CN', region: 'CN-SD' }, candidate).reason).toBe(
    'province_conflict',
  );
  expect(consistentFill({ country: 'US' }, candidate).reason).toBe('country_conflict');
  expect(consistentFill({ country: 'CN', city: 'Suzhou' }, candidate).reason).toBe(
    'city_context_conflict',
  );
  expect(consistentFill({ country: 'CN', city: '广州' }, candidate).location).toEqual(candidate);
});
test('shadow lookup is default and cannot activate from a mode variable alone', async () => {
  const fake: any = {
    manifest: {},
    readers: [
      { search: () => '中国|广东省|广州市|移动|CN' },
      { search: () => '中国|广东省|广州市|移动|CN' },
    ],
  };
  const result = await enrichChina({ country: 'CN' }, '223.5.5.5', fake);
  expect(result.location).toEqual({ country: 'CN' });
  expect(result.shadow).toMatchObject({ precision: 'city', reason: 'compatible_fill' });
  expect(activationAllowed(fake.manifest)).toBe(false);
  expect(
    (await enrichChina({ country: 'CN', region: 'CN-37', city: 'Jinan' }, '223.5.5.5', fake))
      .location.city,
  ).toBe('Jinan');
});
test('manifest rejects unapproved data and path traversal', () => {
  expect(bundleManifestSchema.safeParse({ format: 1, version: '../outside' }).success).toBe(false);
});

test('display and evidence agree on city missing markers and permit shadow lookup', async () => {
  const city = providerText('城市未知');
  expect(city).toBeNull();
  const base = { country: 'CN', region: 'CN-44', city };
  expect(geographyPrecision(base)).toBe('province');
  const fake: any = {
    manifest: {},
    readers: [{ search: () => '中国|广东省|广州市|移动|CN' }],
  };
  expect((await enrichChina(base, '223.5.5.5', fake)).shadow?.precision).toBe('city');
});

test.each(['香港', '澳门', '台北', '广州市', '未收录镇'])(
  'missing province cannot establish a mainland city (%s)',
  city => {
    expect(parseXdbRegion(`中国|0|${city}|0|CN`)).toEqual({
      country: 'CN',
      region: null,
      city: null,
    });
  },
);
