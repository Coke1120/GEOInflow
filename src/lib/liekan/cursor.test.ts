import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './cursor';

describe('opaque log page boundaries', () => {
  it('retains both timestamp and tie-break identity', () => {
    const row = { time: '2026-01-01T01:00:00Z', recordId: 'a'.repeat(64) };
    const [time, id] = decodeCursor(encodeCursor(row));
    expect(time.toISOString()).toBe('2026-01-01T01:00:00.000Z');
    expect(id).toBe(row.recordId);
  });
  it('rejects malformed dates, short identities and arbitrary payloads', () => {
    for (const value of [
      'not-json',
      Buffer.from(JSON.stringify(['bad-date', 'a'.repeat(64)])).toString('base64url'),
      Buffer.from(JSON.stringify(['2026-01-01', 'id'])).toString('base64url'),
    ])
      expect(() => decodeCursor(value)).toThrow();
  });
});
