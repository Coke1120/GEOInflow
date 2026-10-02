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
  expect(normalizeRegionCode(`${LEGACY_COUNTRY_CODE}-TPE`, LEGACY_COUNTRY_CODE)).toBe('CN-TPE');
  expect(normalizeRegionCode('TPE', LEGACY_COUNTRY_CODE)).toBe('CN-TPE');
  expect(normalizeRegionCode('CN-SH', 'CN')).toBe('CN-SH');
});

test('expands China country filters to include legacy records', () => {
  expect(getCountryFilterValues(['CN'])).toEqual(['CN', LEGACY_COUNTRY_CODE]);
  expect(getCountryFilterValues([LEGACY_COUNTRY_CODE])).toEqual(['CN', LEGACY_COUNTRY_CODE]);
});

test('expands China region filters to include legacy region records', () => {
  expect(getRegionFilterValues(['CN-TPE'])).toEqual(['CN-TPE', `${LEGACY_COUNTRY_CODE}-TPE`]);
  expect(getRegionFilterValues([`${LEGACY_COUNTRY_CODE}-TPE`])).toEqual([
    'CN-TPE',
    `${LEGACY_COUNTRY_CODE}-TPE`,
  ]);
});
