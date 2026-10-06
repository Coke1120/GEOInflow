import { beforeEach, describe, expect, test, vi } from 'vitest';
import { rewriteHandlePathname } from '@/lib/liekan/website-handle-proxy';
import { matchDispatchRoute } from './dispatch';

const queryMock = vi.hoisted(() => vi.fn());
vi.mock('pg', () => ({
  Pool: class {
    query = queryMock;
  },
}));

describe('MCP dispatch table', () => {
  beforeEach(() => {
    queryMock.mockReset();
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/umami?schema=public';
  });

  test('matches concrete paths and extracts parameters', () => {
    const match = matchDispatchRoute('GET', '/api/websites/abc/sessions/def/activity');

    expect(match?.route.path).toBe('/api/websites/{websiteId}/sessions/{sessionId}/activity');
    expect(match?.params).toEqual({ websiteId: 'abc', sessionId: 'def' });
  });

  test('ignores a base path prefix and rejects unknown routes', () => {
    expect(matchDispatchRoute('GET', '/umami/api/websites')?.route.path).toBe('/api/websites');
    expect(matchDispatchRoute('POST', '/api/websites')).toBeNull();
    expect(matchDispatchRoute('GET', '/api/admin/users')).toBeNull();
    expect(matchDispatchRoute('DELETE', '/api/websites/abc')).toBeNull();
  });

  test('exposes saved definitions and performance as GET only', () => {
    expect(matchDispatchRoute('GET', '/api/websites/abc/funnels/def/stats')?.params).toEqual({
      websiteId: 'abc',
      funnelId: 'def',
    });
    expect(matchDispatchRoute('GET', '/api/websites/abc/goals/def/stats')?.params).toEqual({
      websiteId: 'abc',
      goalId: 'def',
    });

    for (const path of ['goals', 'funnels', 'segments', 'annotations', 'performance/stats']) {
      expect(matchDispatchRoute('GET', `/api/websites/abc/${path}`)).not.toBeNull();
      expect(matchDispatchRoute('POST', `/api/websites/abc/${path}`)).toBeNull();
    }

    expect(matchDispatchRoute('GET', '/api/websites/abc/goals/def')).toBeNull();
    expect(matchDispatchRoute('DELETE', '/api/websites/abc/segments/def')).toBeNull();
  });

  test('resolves a short site number to the UUID before route matching, like the middleware does', async () => {
    const uuid = '67a8e084-de35-5f1c-a2b0-8f2732f830bf';
    queryMock.mockResolvedValue({ rows: [{ website_id: uuid }] });

    const pathname = await rewriteHandlePathname('/api/websites/101/stats');
    const match = matchDispatchRoute('GET', pathname);

    expect(match?.route.path).toBe('/api/websites/{websiteId}/stats');
    expect(match?.params).toEqual({ websiteId: uuid });
  });
});
