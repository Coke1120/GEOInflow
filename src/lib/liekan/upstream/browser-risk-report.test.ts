// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

const queries = vi.hoisted(() => vi.fn());
vi.mock('./server', () => ({
  LiekanError: class extends Error {},
  transaction: async (work: any) => work({ $executeRawUnsafe: vi.fn(), $queryRawUnsafe: queries }),
  lockWritableWebsite: vi.fn(),
}));
vi.mock('./analytics-revision', () => ({ bumpAnalyticsRevision: vi.fn() }));
vi.mock('./query-cache', () => ({ invalidateWebsiteAnalytics: vi.fn() }));

import { operations } from '@/app/api/liekan/websites/[websiteId]/traffic-quality/risk/contract';
import { browserRiskReport } from './browser-risk';

const filters = {
  startAt: '0',
  endAt: '1000',
  classification: 'browser',
  source: 'browser',
  hostname: 'example.test',
};

beforeEach(() => {
  vi.stubEnv('CLICKHOUSE_URL', '');
  queries.mockReset();
  queries.mockImplementation(async (sql: string, ...values: any[]) => {
    if (sql.includes('FROM liekan_browser_risk_state')) return [];
    if (sql.includes('AS windows'))
      return [{ windows: 1, partialWindows: 0, firstWindow: null, lastWindow: null }];
    if (sql.includes('SELECT r.session_id')) return [];
    if (sql.includes('AS "rawPV"')) {
      // The selected path has no pageviews; the retained filter scope has two visitors.
      const count = values[6] == null ? 2 : 0;
      return [
        {
          rawPV: count,
          includedPV: count,
          rawUV: count,
          includedUV: count,
          missingVerdictPV: 0,
        },
      ];
    }
    if (sql.includes('WITH population AS')) return [{ flaggedPV: 0, remainingUV: 2 }];
    throw new Error(`Unexpected query: ${sql}`);
  });
});

it('does not advertise the audit-only path filter on the behavior risk endpoint', () => {
  const parsed = operations[0].operation.requestParams.query.parse({
    ...filters,
    path: '/missing',
  });
  expect(parsed).not.toHaveProperty('path');
  expect(parsed).toMatchObject({
    classification: filters.classification,
    source: filters.source,
    hostname: filters.hostname,
  });
});

it('keeps risk totals and impact in the same scope when an audit path is supplied', async () => {
  const unfiltered = await browserRiskReport('website', new URLSearchParams(filters));
  const withPath = await browserRiskReport(
    'website',
    new URLSearchParams({ ...filters, path: '/missing' }),
  );
  expect(withPath).toEqual(unfiltered);
  if (!('impact' in withPath)) throw new Error('Expected a supported browser risk report');
  expect(withPath.impact).toEqual({
    includedPV: 2,
    includedUV: 2,
    flaggedPV: 0,
    fullyExcludedUV: 0,
  });
  for (const [sql, ...values] of queries.mock.calls) {
    if (sql.includes('AS "rawPV"'))
      expect(values.slice(3, 7)).toEqual(['browser', 'browser', 'example.test', null]);
    if (sql.includes('SELECT r.session_id') || sql.includes('WITH population AS'))
      expect(values.slice(4)).toEqual(['browser', 'browser', 'example.test']);
  }
});
