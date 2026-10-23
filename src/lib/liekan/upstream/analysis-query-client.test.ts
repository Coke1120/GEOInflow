import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  analysisAsyncPath,
  analysisPendingStore,
  followAnalysisJob,
  waitForAnalysisAdmission,
} from './analysis-query-client';
const id = '11111111-1111-4111-8111-111111111111',
  site = '22222222-2222-4222-8222-222222222222';
const job = {
  id,
  websiteId: site,
  status: 'queued',
  queuedAt: '2026-01-01',
  startedAt: null,
  completedAt: null,
  generatedAt: null,
  expiresAt: null,
  errorCode: null,
  retryAfterMs: 3000,
  resultUrl: `/liekan/websites/${site}/analytics-jobs/${id}/result`,
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it('polls status at a bounded interval and fetches the final data once', async () => {
  const fetchJob = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ analysisJob: { ...job, status: 'running' } }))
    .mockResolvedValueOnce(Response.json({ analysisJob: { ...job, status: 'ready' } }))
    .mockResolvedValueOnce(Response.json({ pageviews: 12 }));
  const pending = followAnalysisJob({ analysisJob: job }, { fetchJob });
  expect(JSON.parse(analysisPendingStore.snapshot())).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(2999);
  expect(fetchJob).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(fetchJob).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(3000);
  expect((await pending).data).toEqual({ pageviews: 12 });
  expect(fetchJob.mock.calls.at(-1)[0]).toBe(job.resultUrl);
  expect(analysisPendingStore.snapshot()).toBe('[]');
});
it('pauses hidden tabs and aborts the consumer without deleting server work', async () => {
  vi.mocked(vi.spyOn(document, 'visibilityState', 'get')).mockReturnValue('hidden');
  const controller = new AbortController(),
    fetchJob = vi.fn();
  const pending = followAnalysisJob({ analysisJob: job }, { fetchJob, signal: controller.signal });
  const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(12000);
  expect(fetchJob).not.toHaveBeenCalled();
  controller.abort();
  await assertion;
  expect(analysisPendingStore.snapshot()).toBe('[]');
});
it('refuses external task result URLs and never treats failure as a result', async () => {
  const fetchJob = vi.fn();
  const pending = followAnalysisJob(
    { analysisJob: { ...job, resultUrl: 'https://evil.invalid/steal' } },
    { fetchJob },
  );
  const assertion = expect(pending).rejects.toThrow('Invalid analytics task path');
  await vi.advanceTimersByTimeAsync(3000);
  await assertion;
  expect(fetchJob).not.toHaveBeenCalled();
});
it('opts in only compatible aggregate routes', () => {
  expect(
    analysisAsyncPath(`/liekan/websites/${site}/page-report`, { resource: 'ai/overview' }),
  ).toBe(true);
  for (const resource of ['logs', 'human/keywords'])
    expect(analysisAsyncPath(`/liekan/websites/${site}/page-report`, { resource })).toBe(false);
  expect(analysisAsyncPath(`/websites/${site}/metrics`, { browser1: 'eq.Chrome' })).toBe(false);
  expect(analysisAsyncPath(`/websites/${site}/sessions`)).toBe(false);
});

it('retains link and pixel aggregates on their original protocol', () => {
  for (const eventType of [3, 4, '3', '4'])
    expect(analysisAsyncPath('/websites/site/stats', { eventType })).toBe(false);
});

it('waits for durable jobs from the previous page to free a quota slot and remains abortable', async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ error: { code: 'analysis-concurrency-limited' } }, { status: 429 }),
    )
    .mockResolvedValueOnce(Response.json({ pageviews: 7 }));
  const waiting = waitForAnalysisAdmission(site, send);
  expect(JSON.parse(analysisPendingStore.snapshot())[0]).toMatchObject({
    websiteId: site,
    paused: false,
  });
  await vi.advanceTimersByTimeAsync(3000);
  expect(send).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(3000);
  expect(await (await waiting).json()).toEqual({ pageviews: 7 });
  expect(analysisPendingStore.snapshot()).toBe('[]');
  const controller = new AbortController();
  const aborted = waitForAnalysisAdmission(site, send, controller.signal);
  const assertion = expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await assertion;
  expect(analysisPendingStore.snapshot()).toBe('[]');
});
