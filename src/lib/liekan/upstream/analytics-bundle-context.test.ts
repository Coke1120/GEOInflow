import { expect, it, vi } from 'vitest';

it('preserves the request, authorization and primary snapshot across independently loaded server bundles', async () => {
  const api = await import('./cache-context');
  const apiSnapshot = await import('./query-snapshot');
  const apiMetadata = await import('./analytics-deadline');
  vi.resetModules();
  const ssr = await import('./cache-context');
  const ssrSnapshot = await import('./query-snapshot');
  const ssrMetadata = await import('./analytics-deadline');
  const readVersion = vi.fn(async () => ({}));
  const authorize = vi.fn(async work => work());
  api.installVersionReader(readVersion);
  api.installAuthorizationRunner(authorize);
  const response = await api.withQueryCacheHeaders(async () => {
    api.bindCacheRequest(new Request('http://localhost/api/example'), { user: { id: 'viewer' } });
    expect(ssr.currentCacheContext()).toBe(api.currentCacheContext());
    expect(ssr.currentCacheContext().actor).toBe('viewer');
    await ssr.prepareAnalyticsVersions(['website:example']);
    expect(readVersion).toHaveBeenCalledOnce();
    await ssr.runCacheAuthorization(async () => true);
    expect(authorize).toHaveBeenCalledOnce();
    const transaction = { $queryRawUnsafe: vi.fn(), $executeRawUnsafe: vi.fn() };
    await ssrSnapshot.withinQuerySnapshot(transaction, async () => {
      expect(apiSnapshot.getQuerySnapshot()).toBe(transaction);
    });
    await apiMetadata.withinPrimaryMetadata(transaction, async () => {
      expect(ssrMetadata.primaryMetadataClient()).toBe(transaction);
    });
    return Response.json({});
  });
  expect(response.status).toBe(200);
  expect(api.currentCacheContext()).toBeUndefined();
});

it('uses one computation gate and recognizes typed cache errors from another server bundle', async () => {
  const api = await import('./cache-context');
  const apiBudget = await import('./analytics-budget');
  const apiErrors = await import('./errors');
  vi.resetModules();
  const ssrBudget = await import('./analytics-budget');
  expect(ssrBudget.analyticsGate).toBe(apiBudget.analyticsGate);
  const unavailable = new ssrBudget.AnalyticsUnavailable('retry', 3, 503);
  expect(unavailable).toBeInstanceOf(apiBudget.AnalyticsUnavailable);
  expect(unavailable).toBeInstanceOf(apiErrors.LiekanError);
  const retry = await api.withQueryCacheHeaders(async () => {
    throw unavailable;
  });
  expect(retry.status).toBe(503);
  expect(retry.headers.get('Retry-After')).toBe('3');
  let attempts = 0;
  const restarted = await api.withQueryCacheHeaders(async () => {
    if (++attempts === 1) throw new ssrBudget.AnalyticsRestart();
    return Response.json({});
  });
  expect(restarted.status).toBe(200);
  expect(attempts).toBe(2);
});
