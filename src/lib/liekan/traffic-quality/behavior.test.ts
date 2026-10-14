import { describe, it, expect } from 'vitest';
import { assessBrowserBehavior } from './behavior';
const sequence = (n: number, gap: number, path: string | null = '/same') =>
  Array.from({ length: n }, (_, i) => ({ observedAt: 100000 + i * gap, path }));
describe('browser behavior observation', () => {
  it('requires enough observation span and independent signals', () => {
    expect(assessBrowserBehavior(sequence(1, 0)).state).toBe('insufficient');
    expect(assessBrowserBehavior(sequence(29, 3000)).reasons).toEqual([]);
    expect(assessBrowserBehavior(sequence(30, 2100)).state).toBe('review');
    expect(assessBrowserBehavior(sequence(30, 2100)).reasons).toEqual([
      'regular-timing',
      'repeated-path',
    ]);
  });
  it('does not turn short stays or one rapid burst into a verdict', () => {
    expect(assessBrowserBehavior(sequence(120, 0)).state).toBe('insufficient');
    expect(assessBrowserBehavior(sequence(30, 1000)).reasons).toEqual([]);
  });
  it('checks sustained frequency in a half-open minute', () => {
    expect(assessBrowserBehavior(sequence(120, 1000)).features.peakMinute).toBe(60);
    expect(assessBrowserBehavior(sequence(120, 1000)).reasons).toContain('sustained-frequency');
    expect(assessBrowserBehavior(sequence(119, 1000)).reasons).not.toContain('sustained-frequency');
  });
  it('calculates a robust timing feature and preserves unsorted input', () => {
    const input = sequence(40, 2000).reverse();
    const original = JSON.stringify(input);
    expect(assessBrowserBehavior(input).features.relativeMad).toBe(0);
    expect(JSON.stringify(input)).toBe(original);
  });
  it('does not infer regularity from variable intervals', () => {
    const input = sequence(40, 2000).map((e, i) => ({
      ...e,
      observedAt: e.observedAt + (i % 2) * 700,
    }));
    expect(assessBrowserBehavior(input).reasons).not.toContain('regular-timing');
  });
  it('keeps clipped, invalid and oversized windows unknown', () => {
    expect(assessBrowserBehavior(sequence(120, 1000), false)).toMatchObject({
      state: 'insufficient',
      reasons: [],
    });
    expect(
      assessBrowserBehavior([...sequence(40, 2000), { observedAt: NaN, path: '/same' }]).state,
    ).toBe('insufficient');
    expect(assessBrowserBehavior(sequence(120, 3000)).reasons).toEqual([]);
  });
  it('does not treat missing paths as repeated path evidence', () => {
    expect(assessBrowserBehavior(sequence(40, 2000, null)).reasons).toEqual(['regular-timing']);
  });
});
