// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { analysisSafeNumber, hourFloor, hourCeil } from './analysis-rollups-model';
describe('exact analysis numeric and bucket boundaries', () => {
  it('refuses precision loss at the JSON number boundary', () => {
    expect(analysisSafeNumber('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => analysisSafeNumber('9007199254740992')).toThrow('analysis-count-overflow');
    expect(() => analysisSafeNumber(-1)).toThrow('analysis-count-overflow');
  });
  it('keeps UTC hours independent of a caller local timezone', () => {
    expect(hourFloor('2026-01-01T23:59:59+08:00').toISOString()).toBe('2026-01-01T15:00:00.000Z');
    expect(hourCeil('2026-01-01T23:59:59+08:00').toISOString()).toBe('2026-01-01T16:00:00.000Z');
  });
});
