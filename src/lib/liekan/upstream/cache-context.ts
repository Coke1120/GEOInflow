import { AsyncLocalStorage } from 'node:async_hooks';
import type { CachedResult } from './query-cache';

interface CacheContext {
  bypass?: boolean;
  results: Array<Omit<CachedResult<unknown>, 'value'>>;
}
const contexts = new AsyncLocalStorage<CacheContext>();
export const bypassQueryCache = () => contexts.getStore()?.bypass;
export const cacheHeadersEnabled = () => !!contexts.getStore() && !contexts.getStore()?.bypass;
export function noteCacheResult({ generatedAt, expiresAt, status }: CachedResult<unknown>) {
  contexts.getStore()?.results.push({ generatedAt, expiresAt, status });
}
export const withoutQueryCache = <T>(work: () => Promise<T>) =>
  contexts.run({ bypass: true, results: [] }, work);
export async function withQueryCacheHeaders(work: () => Promise<Response>) {
  const context: CacheContext = { results: [] };
  const start = performance.now();
  const response = await contexts.run(context, work);
  if (response.ok && context.results.length) {
    const { results } = context;
    response.headers.set(
      'X-Liekan-Generated-At',
      String(Math.min(...results.map(r => r.generatedAt))),
    );
    response.headers.set('X-Liekan-Expires-At', String(Math.min(...results.map(r => r.expiresAt))));
    response.headers.set('X-Liekan-Cache', results.every(r => r.status === 'hit') ? 'hit' : 'miss');
    response.headers.set(
      'Server-Timing',
      `analytics;dur=${(performance.now() - start).toFixed(1)},cache;desc="${results.filter(r => r.status === 'hit').length}/${results.length}"`,
    );
    response.headers.set('Cache-Control', 'private, no-store');
  }
  return response;
}
