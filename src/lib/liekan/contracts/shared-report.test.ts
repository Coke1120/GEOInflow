import { expect, it } from 'vitest';
import { sharedDateRange } from './shared-report';

it('uses complete local calendar days so different share viewers request the same reporting window', () => {
  const first = sharedDateRange(30, Date.parse('2026-10-05T00:00:01Z'));
  expect(first).toEqual(sharedDateRange(30, Date.parse('2026-10-05T12:45:00Z')));
  expect(first.startAt).toBe(Date.parse('2026-09-05T16:00:00Z'));
  expect(first.endAt).toBe(Date.parse('2026-10-05T15:59:59.999Z'));
  expect(first.timezone).toBe('Asia/Shanghai');
});
it('keeps the 24h rolling window at hourly chart resolution and aligns it to a minute', () => {
  const range = sharedDateRange(1, Date.parse('2026-10-05T12:45:59Z'));
  expect(range.endAt).toBe(Date.parse('2026-10-05T12:45:00Z'));
  expect(range.endAt - range.startAt).toBe(86400000);
  expect(range.unit).toBe('hour');
});
