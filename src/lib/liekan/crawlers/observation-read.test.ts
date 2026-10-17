// @vitest-environment node
import { it, expect } from 'vitest';
import { parseObservationQuery } from './observation-window';
it('B-05 keeps seven local calendar days across daylight-saving transitions', () => {
  const spring = parseObservationQuery(
    { timezone: 'America/New_York' },
    Date.parse('2026-03-10T18:00:00Z'),
  );
  expect(new Date(spring.startAt).toISOString()).toBe('2026-03-03T05:00:00.000Z');
  expect(new Date(spring.endAt).toISOString()).toBe('2026-03-10T04:00:00.000Z');
  expect(spring.endAt - spring.startAt).toBe(167 * 3600000);
  expect(parseObservationQuery({ ...spring }, Date.parse('2026-03-11T01:00:00Z'))).toEqual(spring);
});
it('B-07 refuses expired or future reception windows', () => {
  const now = Date.parse('2026-03-10T18:00:00Z');
  expect(() =>
    parseObservationQuery({ startAt: now - 31 * 86400000, endAt: now - 86400000 }, now),
  ).toThrow();
  expect(() => parseObservationQuery({ startAt: now - 1000, endAt: now + 1 }, now)).toThrow();
});
