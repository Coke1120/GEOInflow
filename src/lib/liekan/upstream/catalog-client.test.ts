import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/api-url', () => ({ getApiUrl: (path: string) => `/api${path}` }));
const version = '96074773-f17b-46e9-9af5-b09bca5e4281';
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());
it('shares one version across native and product requests during a page read', async () => {
  const fetcher = vi.fn(async () => Response.json({ version }));
  vi.stubGlobal('fetch', fetcher);
  const { clientCatalogVersion } = await import('./catalog-client');
  const result = await Promise.all([
    clientCatalogVersion('page:1', {
      authorization: 'Bearer fixture',
      'Content-Type': 'application/json',
    }),
    clientCatalogVersion('page:1', { authorization: 'Bearer fixture', accept: 'application/json' }),
  ]);
  expect(result).toEqual([version, version]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await clientCatalogVersion('page:2', { authorization: 'Bearer fixture' });
  await clientCatalogVersion('page:2', { authorization: 'Bearer different' });
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('clears failed negotiations and preserves unsupported native analytics', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ error: 'revoked' }, { status: 403 }))
    .mockResolvedValueOnce(Response.json({ version: null }));
  vi.stubGlobal('fetch', fetcher);
  const { clientCatalogVersion } = await import('./catalog-client');
  await expect(clientCatalogVersion('page', {})).rejects.toThrow();
  await expect(clientCatalogVersion('page', {})).resolves.toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
