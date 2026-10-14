import { expect, test } from 'vitest';
import {
  geographyLabel,
  geographyCoverage,
  geographyEmptyText,
  geographyTable,
  identifyCity,
  mergeGeography,
  regionName,
  cityValueOptions,
  visitorGeographyLabel,
} from './geography';

test.each([
  ['CN', 'CN-SN', "Xi'an", '西安'],
  ['CN', '61', 'Xian', '西安'],
  ['CN', 'CN-SC', 'Chengdu', '成都'],
  ['CN', 'CN-GD', 'Shenzhen', '深圳'],
  ['CN', 'CN-GD', 'Guangzhou', '广州'],
  ['CN', 'CN-GX', 'Nanning', '南宁'],
  ['CN', 'CN-SD', 'Jinan', '济南'],
  ['CN', 'CN-HB', 'Wuhan', '武汉'],
  ['CN', 'CN-AH', 'Bengbu', '蚌埠'],
  ['CN', 'CN-CQ', 'Chongqing', '重庆'],
  ['CN', 'CN-HE', 'Langfang', '廊坊'],
  ['CN', 'CN-GD', 'Dongguan', '东莞'],
  ['CN', 'CN-HA', 'Zhengzhou', '郑州'],
  ['CN', 'CN-HE', 'Baoding', '保定'],
  ['CN', 'CN-HE', 'Shijiazhuang', '石家庄'],
  ['CN', 'CN-HN', 'Changsha', '长沙'],
  ['CN', 'CN-JS', 'Nanjing', '南京'],
  ['CN', 'CN-LN', 'Dalian', '大连'],
  ['TW', null, 'Taipei', '台北'],
])('formats %s/%s/%s as %s', (country, region, city, name) => {
  expect(geographyLabel({ country, region, city })).toBe(name);
});

test('distinguishes missing location from a city without a translation', () => {
  expect(geographyLabel({ country: 'CN', region: 'CN-SD' })).toBe('山东 · 城市未知');
  expect(geographyLabel({ country: 'CN' })).toBe('中国 · 城市未知');
  expect(geographyLabel({})).toBe('地域未知');
  expect(geographyLabel({ country: 'CN', city: 'Unlisted Town' })).toBe('Unlisted Town');
  expect(geographyLabel({ country: 'US', city: 'Chengdu' })).toBe('Chengdu');
  expect(geographyLabel({ city: 'Chengdu' })).toBe('Chengdu');
  expect(identifyCity({ country: 'CN', city: 'Suzhou' }).cityId).toBeNull();
  expect(identifyCity({ country: 'CN', city: "Xi'an" }).region).toBeNull();
});

test('keeps homonyms and observed missing provinces separate', () => {
  expect(geographyLabel({ country: 'CN', region: 'CN-JS', city: 'Suzhou' })).toBe('苏州');
  expect(geographyLabel({ country: 'CN', region: 'CN-AH', city: 'Suzhou' })).toBe('宿州');
  expect(geographyLabel({ country: 'CN', region: 'CN-HE', city: 'Suzhou' })).toBe('Suzhou');
  const a = identifyCity({ country: 'CN', region: 'CN-SN', city: "Xi'an" });
  expect(a.key).toBe(identifyCity({ country: 'CN', region: 'CN-61', city: '西安' }).key);
  expect(a.key).not.toBe(identifyCity({ country: 'CN', city: '西安' }).key);
});

test('keeps explicit apostrophe variants ambiguous until their province is observed', () => {
  for (const city of ["Ji'an", 'Ji’an']) {
    expect(identifyCity({ country: 'CN', city }).cityId).toBeNull();
    expect(geographyLabel({ country: 'CN', city })).toBe(city);
    expect(geographyLabel({ country: 'CN', region: 'CN-JX', city })).toBe('吉安');
    expect(geographyLabel({ country: 'CN', region: 'CN-JL', city })).toBe(city);
  }
});

test('merges canonically equivalent accented aliases without changing source facts', () => {
  const rows = ['Ürümqi', 'Ürümqi'.normalize('NFD'), '乌鲁木齐'].map(city =>
    fact(city, 1, 10, { region: 'CN-XJ' }),
  );
  expect(mergeGeography(rows)).toMatchObject([{ name: '乌鲁木齐', sessions: 3 }]);
});

test('preserves conflicting countries and supplies explicit Hong Kong and Macao context', () => {
  const conflict = { country: 'US', region: 'CN-SD', city: 'Jinan' };
  expect(visitorGeographyLabel(conflict)).toBe('Jinan，CN-SD，美国');
  expect(identifyCity(conflict).key).not.toBe(identifyCity({ ...conflict, region: 'US-SD' }).key);
  expect(geographyLabel({ country: 'CN', region: 'CN-HK', city: 'Hong Kong' })).toBe('香港');
  expect(geographyLabel({ country: 'CN', region: 'CN-MO', city: 'Macau' })).toBe('澳门');
  expect(identifyCity({ country: 'CN', region: 'CN-HK', city: 'Hong Kong' }).country).toBe('CN');
});

test('keeps same-spelling options explicit and accepts traditional city aliases', () => {
  const options = cityValueOptions([
    { value: 'Suzhou', country: 'CN', region: 'CN-JS', count: 3 },
    { value: 'Suzhou', country: 'CN', region: 'CN-AH', count: 1 },
  ]);
  expect(options).toEqual([{ value: 'Suzhou', count: 4, label: '苏州 / 宿州' }]);
  expect(cityValueOptions([{ value: 'Jinan', count: 2 }], false)[0].label).toBe('Jinan');
  expect(geographyLabel({ country: 'CN', region: 'CN-JS', city: 'Taizhou' })).toBe('泰州');
  expect(geographyLabel({ country: 'CN', region: 'CN-ZJ', city: 'Taizhou' })).toBe('台州');
  expect(identifyCity({ country: 'CN', city: 'Taizhou' }).cityId).toBeNull();
  const rows = ['Taipei', '臺北市', '台北'].map(city =>
    fact(city, 1, 10, { country: 'TW', region: null }),
  );
  expect(mergeGeography(rows)).toMatchObject([{ name: '台北', sessions: 3 }]);
});

const fact = (city: string | null, sessions: number, duration: number | null, extra = {}) => ({
  country: 'CN',
  region: 'CN-SN',
  city,
  sessions,
  duration,
  pv: sessions * 2,
  bounces: 1,
  conversions: 1,
  ...extra,
});
test('merges aliases with valid sample weighting and preserves counts', () => {
  const rows = [fact("Xi'an", 2, 10), fact('Xian', 3, 20), fact('西安', 1, null), fact(null, 4, 0)];
  const original = JSON.stringify(rows);
  const result = mergeGeography(rows);
  expect(result).toHaveLength(2);
  expect(result[0]).toMatchObject({
    name: '西安',
    sessions: 6,
    pv: 12,
    duration: 16,
    durationSamples: 5,
    bounces: 3,
    conversions: 3,
  });
  expect(result.reduce((sum, row) => sum + row.sessions, 0)).toBe(10);
  expect(JSON.stringify(rows)).toBe(original);
  const table = geographyTable(rows, 10, true);
  expect(table[0]).toMatchObject({ city: '西安', share: 60, bounceRate: 50, conversionRate: 50 });
  expect(table).toHaveLength(1);
  expect(geographyCoverage(rows, 10)).toMatchObject({
    totalVisits: 10,
    cityKnownVisits: 6,
    cityUnknownVisits: 4,
    cityCoverage: 60,
  });
});

test('searches all explicit aliases after merging and sorts full results deterministically', () => {
  const rows = [fact('西安', 1, 10), fact('Chengdu', 2, 20, { region: 'CN-SC' })];
  expect(geographyTable(rows, 3, false, { search: 'Xian' })).toEqual([
    {
      city: '西安',
      sessions: 1,
      share: 33.33,
      duration: 10,
      bounceRate: 100,
      conversionRate: null,
    },
  ]);
  expect(
    geographyTable(rows, 3, false, { geoSort: 'duration', direction: 'asc' }).map(row => row.city),
  ).toEqual(['西安', '成都']);
  expect(regionName('CN-SD')).toBe('山东');
  expect(regionName('CN-SN')).toBe('陕西');
  expect(regionName('CN-SX')).toBe('山西');
});

test('hides missing cities before ranking and keeps original non-catalogue names', () => {
  const rows = [
    fact(null, 1000, null),
    fact(' ', 500, null),
    ...Array.from({ length: 15 }, (_, i) => fact(`Town ${i}`, 20 - i, 10)),
  ];
  const table = geographyTable(rows, 1695, false);
  expect(table).toHaveLength(15);
  expect(table.slice(0, 12).map(r => r.city)).toEqual(
    Array.from({ length: 12 }, (_, i) => `Town ${i}`),
  );
  expect(table[0].share).toBe(1.18);
  expect(geographyTable(rows, 1695, false, { search: 'Town 14' })).toHaveLength(1);
});

test('coverage distinguishes no traffic, unidentified traffic and search misses', () => {
  expect(geographyCoverage([], 0)).toMatchObject({ cityCoverage: null, cityDisplayState: 'empty' });
  const missing = geographyCoverage(
    [fact(null, 7, null), fact(null, 3, null, { region: null })],
    10,
  );
  expect(missing).toMatchObject({
    cityCoverage: 0,
    chinaProvinceKnownVisits: 7,
    chinaProvinceCoverage: 70,
  });
  expect(geographyEmptyText(missing, '上海')).toBe('已收到访问数据，城市信息尚未识别');
  expect(geographyEmptyText(geographyCoverage([fact('Town', 1, null)], 1), '上海')).toBe(
    '没有匹配的城市',
  );
  expect(geographyEmptyText()).toBe('城市覆盖情况暂不可用');
});

test('provider missing-city tokens and unrecognized mainland provinces stay unknown', () => {
  const rows = [
    fact('unknown', 3, null, { region: 'CN-XX' }),
    fact('0', 2, null),
    fact('Unknown Town', 5, null),
  ];
  expect(geographyTable(rows, 10, false).map(r => r.city)).toEqual(['Unknown Town']);
  expect(geographyCoverage(rows, 10)).toMatchObject({
    cityKnownVisits: 5,
    cityUnknownVisits: 5,
    chinaProvinceKnownVisits: 7,
    chinaProvinceUnknownVisits: 3,
  });
});
