// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  authenticate: vi.fn(),
  authorize: vi.fn(),
  request: vi.fn(),
  read: vi.fn(),
  peek: vi.fn(),
  fast: vi.fn(),
}));
vi.mock('./crawler-maintenance', () => ({ authenticateCrawlerMaintenance: m.authenticate }));
vi.mock('./server', () => ({ authorize: m.authorize }));
vi.mock('./analysis-queries', () => ({
  requestAnalysisQuery: m.request,
  readAnalysisQuery: m.read,
}));
vi.mock('./dashboard-snapshots', () => ({ requestDashboardSnapshot: m.request }));
vi.mock('./page-report', () => ({ peekPageReport: m.peek }));
vi.mock('./analysis-fast-read', () => ({ tryFastAnalysis: m.fast }));
import {
  asyncAnalysisResponse,
  analysisJobResponse,
  analysisAsyncRequested,
} from './analysis-query-api';
const site = '11111111-1111-4111-8111-111111111111',
  id = '22222222-2222-4222-8222-222222222222';
const request = () =>
  new Request(
    `https://analytics.test/api/liekan/websites/${site}/page-report?resource=ai/overview&startAt=0&endAt=1`,
    { headers: { Prefer: 'respond-async', Cookie: 'liekan.locale=en-US' } },
  );
beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  m.authenticate.mockResolvedValue({ id: 'actor' });
  m.authorize.mockResolvedValue({ website: { id: site }, canManage: false });
  m.request.mockResolvedValue({
    ready: false,
    analysisJob: { id, websiteId: site, status: 'queued' },
  });
});
it('returns immediate 202 only after full private authentication and current site authorization', async () => {
  const response = await asyncAnalysisResponse(request(), '103', 'feature:page-report');
  expect(response.status).toBe(202);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(response.headers.has('X-Liekan-Expires-At')).toBe(false);
  expect(m.request).toHaveBeenCalledWith(
    site,
    { id: 'actor' },
    'feature:page-report',
    expect.anything(),
    'en-US',
  );
  m.authenticate.mockRejectedValue(new Error('complete session required'));
  await expect(asyncAnalysisResponse(request(), '103', 'feature:page-report')).rejects.toThrow(
    'complete session required',
  );
  expect(m.request).toHaveBeenCalledTimes(1);
});
it('returns a published snapshot without running foreground aggregation', async () => {
  m.request.mockResolvedValue({
    ready: true,
    value: { meta: { canManage: false } },
    generatedAt: 1,
    expiresAt: 2,
    dataThrough: 1,
    snapshotState: 'ready',
  });
  const response = await asyncAnalysisResponse(request(), site, 'feature:page-report');
  expect(response.status).toBe(200);
  expect((await response.json()).meta.canManage).toBe(false);
  expect(response.headers.get('X-Liekan-Snapshot-State')).toBe('ready');
  expect(m.peek).not.toHaveBeenCalled();
  expect(m.fast).not.toHaveBeenCalled();
});
it('keeps a ready status separate from fetching the result and rejects malformed job IDs', async () => {
  m.read.mockResolvedValue({ ready: false, analysisJob: { id, status: 'ready' } });
  expect((await analysisJobResponse(request(), site, id)).status).toBe(200);
  await expect(analysisJobResponse(request(), site, 'not-a-uuid')).rejects.toMatchObject({
    status: 400,
  });
  expect(m.read).toHaveBeenCalledTimes(1);
});
it('preserves link and pixel synchronous routing', () => {
  for (const eventType of [3, 4])
    expect(
      analysisAsyncRequested(
        new Request(`https://analytics.test/api/websites/${site}/stats?eventType=${eventType}`, {
          headers: { Prefer: 'respond-async' },
        }),
      ),
    ).toBe(false);
});
it('preserves ClickHouse synchronous routing', () => {
  expect(analysisAsyncRequested(request())).toBe(true);
  vi.stubEnv('CLICKHOUSE_URL', 'https://clickhouse.example');
  expect(analysisAsyncRequested(request())).toBe(false);
});

it('falls back to the original handler when conditions are outside the registered task schema', () => {
  const req = (path: string) =>
    new Request(`https://analytics.test/api/websites/${site}/${path}`, {
      headers: { Prefer: 'respond-async' },
    });
  expect(
    analysisAsyncRequested(
      req('performance/stats?startAt=0&endAt=2000&metric=lcp'),
      'native:performance/stats',
    ),
  ).toBe(false);
  expect(analysisAsyncRequested(req('stats?startAt=0&endAt=2000'), 'native:stats')).toBe(true);
  expect(
    analysisAsyncRequested(
      req('analytics?startAt=0&endAt=2000&kind=sessions'),
      'feature:analytics',
    ),
  ).toBe(false);
});

it('registers cold work without executing the covered foreground reader', async () => {
  const response = await asyncAnalysisResponse(request(), site, 'feature:page-report');
  expect(response.status).toBe(202);
  expect(m.request).toHaveBeenCalledTimes(1);
  expect(m.fast).not.toHaveBeenCalled();
});
