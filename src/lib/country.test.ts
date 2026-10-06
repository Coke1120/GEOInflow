import { expect, test } from 'vitest';
import {
  getCountryFilterValues,
  getRegionFilterValues,
  LEGACY_COUNTRY_CODE,
  LEGACY_GEOGRAPHY_CODE,
  normalizeCountryCode,
  normalizeRegionCode,
} from './country';

test('normalizes legacy country identifiers into China', () => {
  expect(normalizeCountryCode(LEGACY_COUNTRY_CODE)).toBe('CN');
  expect(normalizeCountryCode(LEGACY_GEOGRAPHY_CODE)).toBe('CN');
  expect(normalizeCountryCode('CN')).toBe('CN');
});

test('normalizes legacy region identifiers under China', () => {
  expect(normalizeRegionCode(`${LEGACY_COUNTRY_CODE}-TPE`, LEGACY_COUNTRY_CODE)).toBe('CN-71');
  expect(normalizeRegionCode('TPE', LEGACY_COUNTRY_CODE)).toBe('CN-71');
  expect(normalizeRegionCode('CN-SH', 'CN')).toBe('CN-SH');
});

test('expands China country filters to include legacy records', () => {
  expect(getCountryFilterValues(['CN'])).toEqual([
    'CN',
    LEGACY_COUNTRY_CODE,
    LEGACY_GEOGRAPHY_CODE,
  ]);
  expect(getCountryFilterValues([LEGACY_COUNTRY_CODE])).toEqual([
    'CN',
    LEGACY_COUNTRY_CODE,
    LEGACY_GEOGRAPHY_CODE,
  ]);
});

test('uses one province filter for canonical and historical Taiwan subdivisions', () => {
  expect(getRegionFilterValues(['CN-71', 'CN-TPE', 'TW-KHH', 'TWN-HSZ'])).toEqual(['CN-71']);
  expect(getRegionFilterValues(['CN-SH'])).toEqual(['CN-SH']);
});

test.each([
  ['TW', 'TPE'],
  ['TWN', 'KHH'],
  ['tw', null],
  ['TW', undefined],
  ['TW', ''],
  ['TW', 'unknown'],
  ['CN', 'CN-TPE'],
  ['CN', 'HSZ'],
  ['CN', 'CYI'],
  ['CN', 'TW'],
  ['CN', 'CN-71'],
  ['CN', 'CN-tpe'],
  ['CN', 'cn-Khh'],
  [undefined, 'TW-TPE'],
  [undefined, 'TWN-KHH'],
  [undefined, 'CN-TPE'],
])('groups Taiwan country %s and region %s into the Taiwan province', (country, region) => {
  expect(normalizeRegionCode(region, country)).toBe('CN-71');
});

test.each([
  ['CN', null, null],
  ['CN', undefined, undefined],
  ['CN', '', ''],
  ['CN', 'CN-BJ', 'CN-BJ'],
  ['US', 'CA', 'US-CA'],
  ['US', 'CN-TPE', 'US-TPE'],
  [undefined, undefined, undefined],
  [undefined, 'TPE', 'TPE'],
])(
  'preserves other or missing geography for country %s and region %s',
  (country, region, expected) => {
    expect(normalizeRegionCode(region, country)).toBe(expected);
  },
);
