// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  authenticate: vi.fn(),
  authorize: vi.fn(),
  request: vi.fn(),
  read: vi.fn(),
  peek: vi.fn(),
  fast: vi.fn(),
  dispatch: vi.fn(),
  queue: vi.fn(),
  refreshJob: vi.fn(),
}));
vi.mock('./crawler-maintenance', () => ({ authenticateCrawlerMaintenance: m.authenticate }));
vi.mock('./server', () => ({ authorize: m.authorize }));
vi.mock('../log-ingestion/queue', () => ({ getQueue: m.queue }));
vi.mock('./analysis-queries', () => ({
  dispatchAnalysisQuery: m.dispatch,
  requestAnalysisQuery: m.request,
  readAnalysisQuery: m.read,
}));
vi.mock('./dashboard-snapshots', () => ({
  requestDashboardSnapshot: m.request,
  dashboardRefreshJobId: m.refreshJob,
}));
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
  expect(m.dispatch).toHaveBeenCalledWith(id, undefined);
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
it.each([1000, 3000])(
  'keeps HTTP retry guidance aligned with the job interval %s',
  async retryAfterMs => {
    m.request.mockResolvedValue({
      ready: false,
      analysisJob: { id, websiteId: site, status: 'queued', retryAfterMs },
    });
    const response = await asyncAnalysisResponse(request(), site, 'feature:page-report');
    expect(response.headers.get('Retry-After')).toBe(String(retryAfterMs / 1000));
  },
);
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
  expect(m.dispatch).not.toHaveBeenCalled();
});
it('hands off a committed warm refresh while returning the published HTTP DTO', async () => {
  const value = { meta: { canManage: false }, pageviews: 7 };
  const published = {
    ready: true,
    value,
    generatedAt: 1,
    expiresAt: 2,
    dataThrough: 1,
    snapshotState: 'updating',
  };
  m.request.mockResolvedValue(published);
  m.refreshJob.mockReturnValue(id);
  const response = await asyncAnalysisResponse(request(), site, 'feature:page-report');
  expect(response.status).toBe(200);
  expect(m.refreshJob).toHaveBeenCalledWith(published);
  expect(m.dispatch).toHaveBeenCalledWith(id, undefined);
  expect(await response.json()).toEqual(value);
  expect(JSON.stringify([...response.headers])).not.toContain(id);
});
it('keeps a warm published response available when early handoff fails', async () => {
  m.request.mockResolvedValue({
    ready: true,
    value: { pageviews: 7 },
    generatedAt: 1,
    expiresAt: 2,
  });
  m.refreshJob.mockReturnValue(id);
  m.queue.mockRejectedValue(new Error('synthetic warm queue unavailable'));
  const response = await asyncAnalysisResponse(request(), site, 'feature:page-report');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ pageviews: 7 });
  expect(m.queue).toHaveBeenCalledOnce();
});
it('rejects a warm read before requesting or handing off work when website authority fails', async () => {
  m.authorize.mockRejectedValue(new Error('website access revoked'));
  await expect(asyncAnalysisResponse(request(), site, 'feature:page-report')).rejects.toThrow(
    'website access revoked',
  );
  expect(m.request).not.toHaveBeenCalled();
  expect(m.dispatch).not.toHaveBeenCalled();
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

it('retains the durable handle when immediate queue handoff is unavailable', async () => {
  m.queue.mockRejectedValue(new Error('synthetic queue unavailable'));
  const response = await asyncAnalysisResponse(request(), site, 'feature:page-report');
  expect(response.status).toBe(202);
  expect((await response.json()).analysisJob.id).toBe(id);
});

it.each([false, true])(
  'returns committed data when queue setup stalls and coalesces warm=%s handoffs',
  async warm => {
    vi.useFakeTimers();
    if (warm) {
      m.request.mockResolvedValue({
        ready: true,
        value: { pageviews: 7 },
        generatedAt: 1,
        expiresAt: 2,
      });
      m.refreshJob.mockReturnValue(id);
    }
    let release: (value?: any) => void;
    m.queue.mockImplementation(
      () =>
        new Promise(resolve => {
          release = resolve;
        }),
    );
    try {
      const first = asyncAnalysisResponse(request(), site, 'feature:page-report');
      await vi.advanceTimersByTimeAsync(151);
      expect((await first).status).toBe(warm ? 200 : 202);
      const second = asyncAnalysisResponse(request(), site, 'feature:page-report');
      await vi.advanceTimersByTimeAsync(151);
      expect((await second).status).toBe(warm ? 200 : 202);
      expect(m.queue).toHaveBeenCalledTimes(1);
    } finally {
      release?.();
      await vi.advanceTimersByTimeAsync(0);
      vi.useRealTimers();
    }
  },
);
