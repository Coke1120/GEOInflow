import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ read: vi.fn(), authorize: vi.fn(), query: vi.fn() }));
vi.mock('../upstream/query-cache', () => ({
  analyticsCache: { read: h.read },
  analyticsCacheKey: (_kind: string, value: unknown) => JSON.stringify(value),
  websiteCacheTag: (id: string) => `website:${id}`,
}));
vi.mock('../upstream/crawler-access', () => ({
  authorizeCrawler: h.authorize,
  crawlerTransaction: (work: any) => work({ query: h.query }),
}));
vi.mock('../upstream/analytics', () => ({ crawlerReferralRows: vi.fn() }));

import { crawlerAnalysis } from './analysis';
import { withQueryCacheHeaders } from '../upstream/cache-context';

beforeEach(() => {
  h.authorize.mockResolvedValue({ canDraft: true, canControl: true });
  h.query.mockResolvedValue([{ epoch: 1, data_revision: 0 }]);
  h.read.mockResolvedValue({
    value: { bots: [], criticalPaths: [] },
    generatedAt: 1000,
    expiresAt: 31000,
    status: 'hit',
    tier: 'memory',
  });
});

it('reports the actual cached crawler snapshot time through the request boundary', async () => {
  const response = await withQueryCacheHeaders(async () =>
    Response.json(
      await crawlerAnalysis({ id: 'actor', role: 'admin' }, 'site', {
        startAt: 1,
        endAt: 1000,
        timezone: 'UTC',
      }),
    ),
  );
  expect(response.headers.get('x-liekan-generated-at')).toBe('1000');
  expect(response.headers.get('x-liekan-expires-at')).toBe('31000');
  expect(response.headers.get('x-liekan-cache')).toBe('hit');
  expect(h.authorize).toHaveBeenCalledTimes(2);
});
