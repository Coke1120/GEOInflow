import { expect, test } from 'vitest';
import regions from '../../../../public/iso-3166-2.json';
import { countryName, regionName } from './geography';

test('labels Taiwan records as China and the Taiwan province', () => {
  expect(countryName('TW')).toBe('中国');
  expect(countryName('TWN')).toBe('中国');
  expect(regionName('CN-71')).toBe('台湾');
  expect(regionName('CN-TPE')).toBe('台湾');
  expect(regionName('TW-KHH')).toBe('台湾');
  expect(regions['CN-71']).toBe('Taiwan');
  expect(countryName('JP')).toBe('日本');
  expect(regionName('CN-31')).toBe('上海');
});
