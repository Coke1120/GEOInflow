import { expect, it } from 'vitest';
import { coverageRecovery } from './coverage-recovery';
const quality = {
  state: 'complete',
  basis: 'event_time',
  classificationVersion: 'a',
  sourceVersion: 's',
  timezone: 'UTC',
} as const;
it('resolves after two consecutive complete daily coverage comparisons', () => {
  const first = coverageRecovery({ good: 0, dayEnd: 0, quality }, quality, 86400000);
  expect(first).toMatchObject({ good: 1, resolved: false });
  expect(coverageRecovery(first, quality, 2 * 86400000)).toMatchObject({ good: 2, resolved: true });
});
it('does not bridge a missing day, unknown comparison or a changed source', () => {
  expect(coverageRecovery({ good: 1, dayEnd: 0, quality }, quality, 2 * 86400000).good).toBe(1);
  const unknown = coverageRecovery(
    { good: 1, dayEnd: 0, quality },
    { ...quality, state: 'unknown' },
    86400000,
  );
  expect(unknown.good).toBe(0);
  expect(
    coverageRecovery(
      { good: 1, dayEnd: 0, quality },
      { ...quality, sourceVersion: 'other' },
      86400000,
    ).good,
  ).toBe(1);
});
