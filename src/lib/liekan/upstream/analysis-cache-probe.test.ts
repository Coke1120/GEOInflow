// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { QueryCache } from './query-cache';
import { probeCacheOnly, noteCacheResult, withQueryCacheHeaders } from './cache-context';
it('returns a native cache hit without recomputing and keeps its original expiry', async () => {
  const now = Date.now(),
    cache = new QueryCache();
  cache.putLocal(
    'fixture',
    { value: { visitors: 7 }, generatedAt: now - 100, expiresAt: now + 10000, status: 'hit' },
    [],
  );
  const load = vi.fn();
  const response = await withQueryCacheHeaders(async () => {
    const value = await probeCacheOnly(async () => {
      const result = await cache.read('fixture', 30000, [], load);
      noteCacheResult(result);
      return result.value;
    });
    return Response.json(value);
  });
  expect(await response.json()).toEqual({ visitors: 7 });
  expect(response.headers.get('X-Liekan-Expires-At')).toBe(String(now + 10000));
  expect(load).not.toHaveBeenCalled();
});
it('drops partial probe freshness on a miss and never starts the query producer', async () => {
  const cache = new QueryCache(),
    load = vi.fn();
  const response = await withQueryCacheHeaders(async () => {
    expect(await probeCacheOnly(() => cache.read('missing', 30000, [], load))).toBeUndefined();
    return Response.json({ queued: true }, { status: 202 });
  });
  expect(load).not.toHaveBeenCalled();
  expect(response.headers.has('X-Liekan-Expires-At')).toBe(false);
});
