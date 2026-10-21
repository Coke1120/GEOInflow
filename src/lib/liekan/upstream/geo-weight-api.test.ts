// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  access: vi.fn(),
  query: vi.fn(),
  aggregate: vi.fn(),
  quality: vi.fn(),
  cache: vi.fn(),
  catalog: undefined as any,
  revision: '1',
  epoch: 1,
  policyRevision: '1',
  feature: true,
}));
vi.mock('@/lib/auth', () => ({ checkAuth: h.auth }));
vi.mock('@/lib/db', () => ({ isRelationalOnly: () => true }));
vi.mock('./ai-access', () => ({ authorizeAiWebsite: h.access }));
vi.mock('./ai-db', () => ({
  aiTransaction: (work: any) => work({ query: h.query, execute: vi.fn() }),
}));
vi.mock('./geo-weight-sql', async importOriginal => ({
  ...(await importOriginal<typeof import('./geo-weight-sql')>()),
  geoWeightAggregate: h.aggregate,
}));
vi.mock('../crawlers/analysis', () => ({ crawlerWindowQuality: h.quality }));
vi.mock('./crawler-registry-context', () => ({
  withPublishedRegistry: (work: any) => work(h.catalog),
}));
vi.mock('./query-cancellation', () => ({
  cancellableEvidence: (_tx: any, _signal: any, work: any) => work(),
}));
vi.mock('./evidence-cache', () => ({ evidenceCache: { read: h.cache } }));
vi.mock('./analytics-budget', () => ({
  analyticsGate: { run: (work: any) => work() },
  AnalyticsUnavailable: class extends Error {
    status = 503;
  },
}));
vi.mock('@/lib/liekan/http', () => ({
  requestApi: async (_request: Request, work: () => any) => {
    try {
      return Response.json(await work());
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: error.status || 500 });
    }
  },
  readBody: (request: Request) => request.json(),
}));
import { GET } from '@/app/api/liekan/websites/[websiteId]/geo-weight/route';
import { POST } from '@/app/api/liekan/websites/[websiteId]/geo-weight/export/route';
import { getBundledPublishedCatalog } from '../crawlers/catalog-seed';
import { readGeoWeight, parseGeoWeightQuery } from './geo-weight';
import { geoWeightCsv } from './geo-weight-export';
import { geoWeightResponseSchema } from '../contracts/geo-weight';
import { LiekanError } from './errors';
import { withQueryCacheHeaders } from './cache-context';
const actor = { id: randomUUID(), role: 'admin' },
  site = randomUUID();
const input = { asOf: '2026-10-19', timezone: 'Asia/Shanghai', view: 'detail' };
const url = `https://liekan.test/api/liekan/websites/${site}/geo-weight`;
const context = { params: Promise.resolve({ websiteId: site }) };
const get = (params: Record<string, string> = input) =>
  GET(new Request(url + '?' + new URLSearchParams(params)), context);
const post = (body: unknown, headers = {}) =>
  POST(
    new Request(url + '/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    context,
  );
beforeEach(() => {
  vi.clearAllMocks();
  h.revision = '1';
  h.epoch = 1;
  h.policyRevision = '1';
  h.feature = true;
  h.catalog = getBundledPublishedCatalog();
  h.auth.mockResolvedValue({ authType: 'session', user: actor });
  h.access.mockResolvedValue({ domain: 'www.example.com', role: 'admin', canUse: true });
  h.query.mockImplementation(async (sql: string) => {
    if (sql.includes('ai_crawler_enabled')) return [{ ai_crawler_enabled: h.feature }];
    if (sql.includes('data_revision'))
      return [{ epoch: h.epoch, data_revision: h.revision, policy_revision: h.policyRevision }];
    if (sql.includes('max(recorded_at)')) return [{ latest: null, count: 0 }];
    if (sql.includes('AS valid')) return [{ valid: false }];
    return [];
  });
  h.quality.mockResolvedValue({
    state: 'unknown',
    classificationVersion: 'class-1',
    sourceVersion: 'manual',
  });
  h.aggregate.mockImplementation(async (_tx, _site, _host, _tz, windows) =>
    windows.map(w => ({
      asOf: w.asOf,
      stats: {
        requests: 1,
        accepted: 1,
        firstEvidenceDay: '2026-08-01',
        classificationVersions: ['class-1'],
        sources: ['manual'],
      },
      factors: [{ purpose: 'search', paths: 1, units: 1, days: 1, operators: 0 }],
    })),
  );
  h.cache.mockImplementation((_key, _tags, compute, signal) => compute(signal));
});
describe('private GEO request and snapshot boundaries', () => {
  it('rejects a result when the final authorization read exhausts the shared deadline', async () => {
    let now = Date.now();
    const started = now;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const query = h.query.getMockImplementation();
    try {
      h.cache.mockImplementation(async (_key, _tags, compute, signal) => {
        const result = await compute(signal);
        now = started + 59999;
        h.query.mockImplementation(async (...args) => {
          now += 5000;
          return query(...args);
        });
        return result;
      });
      expect((await get()).status).toBe(503);
    } finally {
      clock.mockRestore();
    }
  });
  it('shares the export deadline with the final session check', async () => {
    let now = Date.now();
    const started = now;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const result = await readGeoWeight(actor, site, input);
      h.auth
        .mockResolvedValueOnce({ authType: 'session', user: actor })
        .mockImplementation(async () => {
          now = started + 60001;
          return { authType: 'session', user: actor };
        });
      expect(
        (
          await post({
            asOf: input.asOf,
            timezone: input.timezone,
            locale: 'en-US',
            catalogVersion: result.readCatalogVersion,
            snapshot: result.snapshot,
          })
        ).status,
      ).toBe(503);
    } finally {
      clock.mockRestore();
    }
  });
  it.each([false, true])(
    'rechecks a revoked session before export or conflict data (conflict=%s)',
    async conflict => {
      const result = await readGeoWeight(actor, site, input);
      h.auth.mockResolvedValueOnce({ authType: 'session', user: actor }).mockResolvedValue(null);
      const response = await post({
        asOf: input.asOf,
        timezone: input.timezone,
        locale: 'en-US',
        catalogVersion: result.readCatalogVersion,
        snapshot: conflict ? '0'.repeat(64) : result.snapshot,
      });
      expect(response.status).toBe(401);
      expect(h.auth).toHaveBeenCalledTimes(2);
      expect(await response.json()).not.toHaveProperty('updated');
    },
  );
  it('supplies the freshness headers required by the shared manual-reading client', async () => {
    const response = await withQueryCacheHeaders(async () =>
      Response.json(await readGeoWeight(actor, site, input)),
    );
    const generated = Number(response.headers.get('X-Liekan-Generated-At'));
    const expires = Number(response.headers.get('X-Liekan-Expires-At'));
    expect(generated).toBeGreaterThan(0);
    expect(expires - generated).toBe(5000);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it.each(['partial', 'api-key', 'share', undefined])(
    'rejects %s identities before aggregation',
    async authType => {
      h.auth.mockResolvedValue({ authType, user: actor });
      expect((await get()).status).toBe(401);
      expect(h.aggregate).not.toHaveBeenCalled();
    },
  );
  it('rejects share context, disabled features and unauthorized websites', async () => {
    h.auth.mockResolvedValueOnce({ authType: 'session', user: actor, shareToken: {} });
    expect((await get()).status).toBe(401);
    h.feature = false;
    expect((await get()).status).toBe(403);
    h.feature = true;
    h.access.mockRejectedValue(new LiekanError('Forbidden', 403));
    expect((await get()).status).toBe(403);
    expect(h.aggregate).not.toHaveBeenCalled();
  });
  it('validates dates, timezone and rejects unsupported filters', async () => {
    for (const fields of [
      { asOf: '2026-02-30' },
      { asOf: '2099-01-01' },
      { timezone: 'bad' },
      { purpose: 'search' },
    ])
      expect((await get({ ...input, ...fields })).status).toBe(400);
    expect(() =>
      parseGeoWeightQuery({ ...input, asOf: '2026-10-20' }, Date.parse('2026-10-20T09:00:00Z')),
    ).toThrow();
  });
  it('returns all detail points in one aggregate, schema-valid states and a deterministic snapshot', async () => {
    const a = await readGeoWeight(actor, site, input),
      b = await readGeoWeight(actor, site, input);
    expect(a.snapshot).toBe(b.snapshot);
    expect(a.observations).toHaveLength(5);
    expect(h.aggregate.mock.calls[0][4]).toHaveLength(6);
    expect(geoWeightResponseSchema.safeParse(a).success).toBe(true);
    expect(a.current.state).toBe('reference');
    expect(a.comparison.delta).toBeNull();
    await readGeoWeight(actor, site, { ...input, view: 'summary' });
    expect(h.aggregate.mock.lastCall[4]).toHaveLength(1);
  });
  it('checks permission after a cache hit and rejects reset or policy changes during computation', async () => {
    const cached = await readGeoWeight(actor, site, input);
    h.cache.mockImplementation(async () => {
      h.access.mockRejectedValue(new LiekanError('revoked', 403));
      return cached;
    });
    expect((await get()).status).toBe(403);
    h.access.mockResolvedValue({ domain: 'www.example.com', role: 'admin', canUse: true });
    h.cache.mockImplementation(async () => {
      h.epoch = 2;
      return cached;
    });
    expect((await get()).status).toBe(409);
    h.epoch = 1;
    h.cache.mockImplementation(async () => {
      h.policyRevision = '2';
      return cached;
    });
    expect((await get()).status).toBe(409);
  });
  it('keeps historical snapshots exportable when ingestion revisions advance outside their window', async () => {
    const before = await readGeoWeight(actor, site, input);
    h.revision = '2';
    const after = await readGeoWeight(actor, site, input, { fresh: true });
    expect(after.dataRevision).toBe('2');
    expect(after.snapshot).toBe(before.snapshot);
    const response = await post({
      asOf: input.asOf,
      timezone: input.timezone,
      locale: 'en-US',
      catalogVersion: before.readCatalogVersion,
      snapshot: before.snapshot,
    });
    expect(response.status).toBe(200);
    h.cache.mockImplementation(async () => {
      h.revision = '3';
      return after;
    });
    expect((await get()).status).toBe(200);
  });
  it('rejects export when the selected window evidence actually changes', async () => {
    const before = await readGeoWeight(actor, site, input);
    h.aggregate.mockResolvedValue([]);
    expect(
      (
        await post({
          asOf: input.asOf,
          timezone: input.timezone,
          locale: 'en-US',
          catalogVersion: before.readCatalogVersion,
          snapshot: before.snapshot,
        })
      ).status,
    ).toBe(409);
  });
  it('exports the displayed snapshot in the submitted locale and returns updated data on mismatch', async () => {
    const result = await readGeoWeight(actor, site, input);
    const body = {
      asOf: input.asOf,
      timezone: input.timezone,
      locale: 'en-US',
      catalogVersion: result.readCatalogVersion,
      snapshot: result.snapshot,
    };
    let response = await post(body);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).toContain('GEO weight calculation evidence');
    response = await post({ ...body, snapshot: '0'.repeat(64) });
    expect(response.status).toBe(409);
    expect((await response.json()).updated.current).toEqual(result.current);
    expect((await post(body, { 'X-Liekan-Catalog-Version': randomUUID() })).status).toBe(409);
  });
  it('rejects cross-origin exports and an expired session after recomputation', async () => {
    const result = await readGeoWeight(actor, site, input);
    const body = {
      asOf: input.asOf,
      timezone: input.timezone,
      locale: 'zh-CN',
      catalogVersion: result.readCatalogVersion,
      snapshot: result.snapshot,
    };
    expect((await post(body, { Origin: 'https://other.test' })).status).toBe(403);
    h.auth.mockResolvedValueOnce({ authType: 'session', user: actor }).mockResolvedValueOnce(null);
    expect((await post(body)).status).toBe(401);
  });
  it('cancels aborted reads and protects CSV metadata against row injection', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      readGeoWeight(actor, site, input, { fresh: true, signal: controller.signal }),
    ).rejects.toMatchObject({ status: 499 });
    const result = await readGeoWeight(actor, site, input);
    result.hostname = '=HYPERLINK("https://example.org")\r\n@evil';
    const csv = geoWeightCsv(result, 'en-US');
    expect(csv.startsWith('\ufeff')).toBe(true);
    expect(csv).not.toContain('\r\n@evil');
    expect(csv).not.toMatch(/ip_masked|user_agent/);
  });
});
