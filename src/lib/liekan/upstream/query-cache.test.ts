import { describe, expect, it, vi } from 'vitest';
import { analyticsCacheKey, QueryCache } from './query-cache';
import { Decimal } from '@prisma/client/runtime/client';

describe('derived statistics cache', () => {
  it('round-trips exact PostgreSQL numeric aggregates and arbitrary object fields', async () => {
    const cache = new QueryCache();
    const load = vi.fn(async () => ({
      count: new Decimal('9007199254740993'),
      payload: [3, 'literal'],
      value: { kind: 3, value: 'literal' },
    }));
    const first = await cache.read('numeric', 30000, [], load);
    const hit = await cache.read('numeric', 30000, [], load);
    expect(Decimal.isDecimal(hit.value.count)).toBe(true);
    expect(hit.value.count.toString()).toBe('9007199254740993');
    expect(hit.value.payload).toEqual([3, 'literal']);
    expect(hit.value.value).toEqual(first.value.value);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('coalesces concurrent work and isolates mutable results and bigint/date values', async () => {
    const cache = new QueryCache();
    const load = vi.fn(async () => ({ rows: [{ count: 2n, at: new Date(1234) }] }));
    const results = await Promise.all(
      Array.from({ length: 10 }, () => cache.read('a', 30000, ['site'], load)),
    );
    expect(load).toHaveBeenCalledTimes(1);
    results[0].value.rows[0].count = 999n;
    expect(results[1].value.rows[0].count).toBe(2n);
    expect((await cache.read('a', 30000, ['site'], load)).value.rows[0]).toEqual({
      count: 2n,
      at: new Date(1234),
    });
  });
  it('expires from the start of computation and enforces count/byte limits', async () => {
    let now = 0;
    const cache = new QueryCache(2, 100, () => now);
    const load = vi.fn(async () => 'small');
    await cache.read('a', 30, [], load);
    await cache.read('b', 30, [], load);
    await cache.read('c', 30, [], load);
    await cache.read('a', 30, [], load);
    expect(load).toHaveBeenCalledTimes(4);
    now = 31;
    await cache.read('a', 30, [], load);
    expect(load).toHaveBeenCalledTimes(5);
    const large = vi.fn(async () => 'x'.repeat(200));
    await cache.read('large', 30, [], large);
    await cache.read('large', 30, [], large);
    expect(large).toHaveBeenCalledTimes(2);
  });
  it('does not retain failed work or let an invalidated flight replace a newer result', async () => {
    const cache = new QueryCache();
    await expect(
      cache.read('failed', 1000, [], async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');
    expect((await cache.read('failed', 1000, [], async () => 1)).value).toBe(1);
    let finish!: (value: number) => void;
    const old = cache.read(
      'a',
      1000,
      ['site-a'],
      () =>
        new Promise<number>(resolve => {
          finish = resolve;
        }),
    );
    await Promise.resolve();
    cache.invalidate('site-a');
    await cache.read('a', 1000, ['site-a'], async () => 2);
    finish(1);
    await old;
    expect((await cache.read('a', 1000, ['site-a'], async () => 3)).value).toBe(2);
  });
  it('normalizes filter order without merging different ranges, websites or schemas', () => {
    expect(analyticsCacheKey('report', { a: 1, b: 2 })).toBe(
      analyticsCacheKey('report', { b: 2, a: 1 }),
    );
    expect(analyticsCacheKey('report', ['site-a', 1])).not.toBe(
      analyticsCacheKey('report', ['site-b', 1]),
    );
    expect(analyticsCacheKey('report', ['site-a', 1])).not.toBe(
      analyticsCacheKey('report', ['site-a', 2]),
    );
    expect(analyticsCacheKey('report', ['site-a', 1])).not.toBe(
      analyticsCacheKey('report-v2', ['site-a', 1]),
    );
  });
  it('manual refresh supersedes a background flight and coalesces overlapping refresh requests', async () => {
    const cache = new QueryCache();
    let finish!: (value: number) => void;
    const old = cache.read(
      'a',
      1000,
      ['site'],
      () =>
        new Promise<number>(resolve => {
          finish = resolve;
        }),
    );
    await Promise.resolve();
    const load = vi.fn(async () => 2);
    const refreshed = await Promise.all(
      Array.from({ length: 10 }, () => cache.read('a', 1000, ['site'], load, true)),
    );
    expect(load).toHaveBeenCalledTimes(1);
    expect(refreshed.every(r => r.value === 2)).toBe(true);
    finish(1);
    await old;
    expect((await cache.read('a', 1000, ['site'], async () => 3)).value).toBe(2);
  });
});
