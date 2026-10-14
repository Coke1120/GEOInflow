// @vitest-environment node
import { it, expect } from 'vitest';
import { diagnosticCoverage } from './diagnostics';
const minute = 60000,
  now = Date.UTC(2026, 9, 14, 12, 0, 30);
it('distinguishes missing, expired and partial diagnostics from complete zero windows', () => {
  expect(diagnosticCoverage(now - minute, now, null, now).coverage).toBe('missing');
  expect(diagnosticCoverage(now - 10 * minute, now - 5 * minute, now - minute, now).coverage).toBe(
    'missing',
  );
  expect(
    diagnosticCoverage(now - 40 * 86400000, now - 35 * 86400000, now - 50 * 86400000, now).coverage,
  ).toBe('missing');
  expect(diagnosticCoverage(now - 40 * 86400000, now, now - 50 * 86400000, now).coverage).toBe(
    'partial',
  );
  expect(diagnosticCoverage(now - 5 * minute, now, now - minute, now).coverage).toBe('partial');
  expect(
    diagnosticCoverage(
      now - minute,
      Math.floor(now / minute) * minute + minute,
      now - 5 * minute,
      now,
    ).coverage,
  ).toBe('complete');
  expect(diagnosticCoverage(now + minute, now + 2 * minute, now - minute, now).coverage).toBe(
    'missing',
  );
});
