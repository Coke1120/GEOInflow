import { expect, it } from 'vitest';
import { pairedCacheUrls } from '../../../../scripts/liekan-cache-pair';

const query = '/api/websites/example/retention?startAt=1000&endAt=2000&timezone=Asia%2FShanghai&country=CN';
const old = `http://old.invalid${query}`, current = `http://current.invalid${query}`;

it('keeps old and current requests equal while allocating a fresh bound for every pair', () => {
  const bounds = new Set<number>();
  for (let sequence = 0; sequence < 64; sequence++) {
    for (let index = 0; index < 200; index++) {
      const pair = pairedCacheUrls(old, current, sequence, index);
      const left = new URL(pair.oldUrl), right = new URL(pair.currentUrl);
      expect(left.pathname + left.search).toBe(right.pathname + right.search);
      expect(left.origin).toBe('http://old.invalid');
      expect(right.origin).toBe('http://current.invalid');
      expect(left.searchParams.get('startAt')).toBe('1000');
      expect(left.searchParams.get('timezone')).toBe('Asia/Shanghai');
      expect(left.searchParams.get('country')).toBe('CN');
      expect(left.searchParams.getAll('endAt')).toEqual([String(pair.endAt)]);
      expect(pair.endAt).toBeGreaterThan(2000 + 600000);
      expect(pair.endAt).toBeLessThan(2000 + 800000);
      expect(bounds.has(pair.endAt)).toBe(false);
      bounds.add(pair.endAt);
    }
  }
  expect(new URL(old).searchParams.get('endAt')).toBe('2000');
});

it.each([
  [-1, 0], [64, 0], [0.5, 0], [NaN, 0], [0, -1], [0, 200], [0, 0.5], [0, NaN],
])('rejects an invalid sequence/index %s/%s', (sequence, index) => {
  expect(() => pairedCacheUrls(old, current, sequence, index)).toThrow();
});

it.each([
  current.replace('endAt=2000', 'endAt=2001'),
  current.replace('country=CN', 'country=US'),
  current.replace('Asia%2FShanghai', 'UTC'),
  current.replace('/retention?', '/events?'),
])('rejects mismatched conditions %s', right => {
  expect(() => pairedCacheUrls(old, right, 0, 0)).toThrow();
});

it.each(['', 'NaN', '0', '-1', '9007199254740991'])(
  'rejects invalid or overflowing end bound %s', value => {
    const left = new URL(old), right = new URL(current);
    left.searchParams.set('endAt', value);
    right.searchParams.set('endAt', value);
    expect(() => pairedCacheUrls(left.href, right.href, 0, 0)).toThrow();
  },
);

it('rejects a missing end bound', () => {
  const left = new URL(old), right = new URL(current);
  left.searchParams.delete('endAt');
  right.searchParams.delete('endAt');
  expect(() => pairedCacheUrls(left.href, right.href, 0, 0)).toThrow();
});
