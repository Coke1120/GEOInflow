import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rewriteWebsiteHandle } from '@/lib/liekan/website-handle-proxy';

const queryMock = vi.hoisted(() => vi.fn());
vi.mock('pg', () => ({
  Pool: class {
    query = queryMock;
  },
}));

const uuid = '67a8e084-de35-5f1c-a2b0-8f2732f830bf';

function request(path: string) {
  return new NextRequest(`http://localhost:3000${path}`);
}

describe('website handle rewrite', () => {
  beforeEach(() => {
    queryMock.mockReset();
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/umami?schema=public';
  });

  it('rewrites a numeric website handle to the owner UUID and preserves the query', async () => {
    queryMock.mockResolvedValue({ rows: [{ website_id: uuid }] });
    const response = await rewriteWebsiteHandle(request('/api/websites/301/metrics?startAt=1&endAt=2'));
    expect(response?.headers.get('x-middleware-rewrite')).toBe(
      `http://localhost:3000/api/websites/${uuid}/metrics?startAt=1&endAt=2`,
    );
    expect(queryMock).toHaveBeenCalledWith(expect.any(String), [301]);
  });

  it('rewrites realtime and compat paths carrying numeric handles', async () => {
    queryMock.mockResolvedValue({ rows: [{ website_id: uuid }] });
    const realtime = await rewriteWebsiteHandle(request('/api/realtime/302'));
    expect(realtime?.headers.get('x-middleware-rewrite')).toBe(
      `http://localhost:3000/api/realtime/${uuid}`,
    );
    const compat = await rewriteWebsiteHandle(request('/compat/api/websites/303/reports'));
    expect(compat?.headers.get('x-middleware-rewrite')).toBe(
      `http://localhost:3000/compat/api/websites/${uuid}/reports`,
    );
  });

  it('leaves UUID paths, unknown handles and malformed segments untouched', async () => {
    for (const path of [
      `/api/websites/${uuid}/metrics`,
      '/api/websites/404x/metrics',
      '/api/websites/1234567890/metrics',
      '/api/liekan/websites/404/report',
      '/api/send',
      '/websites/301/geo',
    ]) {
      const response = await rewriteWebsiteHandle(request(path));
      expect(response, path).toBeUndefined();
    }
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('passes through when the site number is not found', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const response = await rewriteWebsiteHandle(request('/api/websites/999999999/metrics'));
    expect(response).toBeUndefined();
  });

  it('caches a resolved handle until the TTL expires', async () => {
    // Cache state persists across tests in this module, so assert on call deltas
    // against a handle only this test uses.
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      queryMock.mockResolvedValue({ rows: [{ website_id: uuid }] });
      const before = queryMock.mock.calls.length;
      await rewriteWebsiteHandle(request('/api/websites/601/metrics'));
      await rewriteWebsiteHandle(request('/api/websites/601/metrics'));
      expect(queryMock).toHaveBeenCalledTimes(before + 1);

      vi.setSystemTime(60_001);
      await rewriteWebsiteHandle(request('/api/websites/601/metrics'));
      expect(queryMock).toHaveBeenCalledTimes(before + 2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('evicts the oldest cache entries when the cache exceeds its limit', async () => {
    queryMock.mockResolvedValue({ rows: [{ website_id: uuid }] });
    const before = queryMock.mock.calls.length;
    // 1201 fresh inserts through the 1000-entry capped cache guarantee that the
    // first handle was evicted, regardless of cache state left by other tests.
    await rewriteWebsiteHandle(request('/api/websites/602/metrics'));
    for (let handle = 100000; handle <= 101200; handle += 1) {
      await rewriteWebsiteHandle(request(`/api/websites/${handle}/metrics`));
    }

    await rewriteWebsiteHandle(request('/api/websites/602/metrics'));
    expect(queryMock).toHaveBeenCalledTimes(before + 1203);
  });

  it('passes through without querying when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;
    const response = await rewriteWebsiteHandle(request('/api/websites/603/metrics'));
    expect(response).toBeUndefined();
    expect(queryMock).not.toHaveBeenCalled();
  });
});
