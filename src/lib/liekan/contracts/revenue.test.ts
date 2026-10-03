import { describe, expect, it } from 'vitest';
import { formatRevenueAmount, formatRevenueAverage, sumRevenueAmounts } from './revenue';

describe('exact revenue display', () => {
  it.each([
    ['99999999999999.99', '¥99,999,999,999,999.99'],
    ['9007199254740993.01', '¥9,007,199,254,740,993.01'],
    ['0.01', '¥0.01'],
    ['1.005', '¥1.01'],
    ['-99999999999999.99', '-¥99,999,999,999,999.99'],
    ['-1.005', '-¥1.01'],
    [0, '¥0.00'],
    [null, '—'],
    [undefined, '—'],
    [NaN, '—'],
    ['invalid', '—'],
  ])('formats %s without an intermediate floating point conversion', (value, expected) => {
    expect(formatRevenueAmount(value, 'CNY')).toBe(expected);
  });
  it('sums decimal API text exactly for periods and cumulative tooltip amounts', () => {
    expect(sumRevenueAmounts(['99999999999999.98', '0.01'])).toBe('99999999999999.99');
    expect(sumRevenueAmounts(['99999999999999.99', '0.01'])).toBe('100000000000000.00');
    expect(sumRevenueAmounts(['0.1', '0.2', '-0.05', null])).toBe('0.25');
    expect(sumRevenueAmounts(['1e21', '1e-4'])).toBe('1000000000000000000000.0001');
    expect(sumRevenueAmounts([])).toBe('0');
  });
  it('rounds the exact average at the currency display precision', () => {
    expect(formatRevenueAverage('99999999999999.99', 2, 'CNY')).toBe('¥50,000,000,000,000.00');
    expect(formatRevenueAverage('0.01', 2, 'USD')).toBe('US$0.01');
    expect(formatRevenueAverage('-0.01', 2, 'USD')).toBe('-US$0.01');
    expect(formatRevenueAverage('1.009999', 2, 'USD')).toBe('US$0.50');
    expect(formatRevenueAverage('12.5', 1, 'JPY')).toBe('JP¥13');
    expect(formatRevenueAverage('100', 0, 'CNY')).toBe('—');
    expect(formatRevenueAverage(null, 2, 'CNY')).toBe('—');
  });
});
