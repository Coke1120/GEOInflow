import { describe, expect, it } from 'vitest';
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
