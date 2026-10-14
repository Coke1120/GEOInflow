import { describe, expect, it } from 'vitest';
import { featureDateRange } from '../contracts/analysis';
import { readFeatureDateRange } from './date-range';

describe('URL date range recovery', () => {
  it.each(['range:bad:bad', 'range:900:100', 'range:1e99:2e99', 'unknown'])(
    'recovers invalid dates %s with a visible default state',
    value => {
      const { dateRange, invalidDate } = readFeatureDateRange(value, '', 0, 'UTC');
      expect(invalidDate).toBe(true);
      expect(Number.isFinite(+dateRange.startDate)).toBe(true);
      expect(+dateRange.endDate).toBeGreaterThanOrEqual(+dateRange.startDate);
    },
  );
  it('preserves valid custom timestamps and ignores preset offsets for that range', () => {
    const { dateRange, invalidDate } = readFeatureDateRange('range:123:987:day', '', -1, 'UTC');
    expect(invalidDate).toBe(false);
    expect(+dateRange.startDate).toBe(123);
    expect(+dateRange.endDate).toBe(987);
  });
  it('recovers an unknown unit or non-finite offset before formatting', () => {
    expect(readFeatureDateRange('30day', 'unknown', -1, 'UTC').invalidDate).toBe(true);
    expect(readFeatureDateRange('30day', '', NaN, 'UTC').invalidDate).toBe(true);
  });
});

it('keeps the natural week Monday to Sunday in both display languages', () => {
  const readAt = Date.parse('2026-10-14T12:00:00Z');
  const chinese = readFeatureDateRange('0week', '', 0, 'UTC', 'zh-CN', readAt);
  const english = readFeatureDateRange('0week', '', 0, 'UTC', 'en-US', readAt);
  expect(english.dateRange).toEqual(chinese.dateRange);
  expect(new Date(featureDateRange(english.dateRange, 'UTC').startAt).toISOString()).toBe(
    '2026-10-12T00:00:00.000Z',
  );
  expect(new Date(featureDateRange(english.dateRange, 'UTC').endAt).toISOString()).toBe(
    '2026-10-18T23:59:59.999Z',
  );
});
