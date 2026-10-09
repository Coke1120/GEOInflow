import { describe, expect, it } from 'vitest';
import { crawlerRange } from './analysis';
const now = Date.UTC(2026, 9, 9),
  day = 86400000;
describe('crawler query bounds', () => {
  it('defaults to the last seven days and preserves the requested timezone', () => {
    expect(crawlerRange(new URLSearchParams('timezone=Asia%2FShanghai'), now)).toEqual({
      startAt: now - 7 * day,
      endAt: now,
      timezone: 'Asia/Shanghai',
    });
  });
  it.each([
    { startAt: now - 90 * day - 1, endAt: now },
    { startAt: now, endAt: now + 1 },
    { startAt: now, endAt: now },
    { startAt: -1, endAt: now },
    { startAt: 1.2, endAt: now },
    { startAt: NaN, endAt: now },
  ])('rejects an invalid range %j', params => {
    expect(() =>
      crawlerRange(
        new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])),
        now,
      ),
    ).toThrow();
  });
  it('rejects invalid timezones before querying', () => {
    expect(() => crawlerRange(new URLSearchParams('timezone=invalid'), now)).toThrow();
  });
});
