// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiExecutor } from '../upstream/ai-db';
import { readReconciliation } from './evidence-read';
import { readOutcomes } from './outcomes-read';
import { readObservations } from './observation-read';

beforeEach(() => vi.stubEnv('DATABASE_URL', 'postgresql://fixture:fixture@127.0.0.1:1/isolated'));
afterEach(() => vi.unstubAllEnvs());

const websiteId = '00000000-0000-0000-0000-000000000001';
const range = {
  startAt: Date.now() - 3600000,
  endAt: Date.now() - 1000,
  timezone: 'Asia/Shanghai',
};
const params = {
  ...range,
  sourceId: 'manual',
  hostname: 'example.com',
  page: 1,
  sort: 'requests',
  direction: 'desc',
} as any;
const input = {
  access: { domain: 'example.com' },
  sources: [],
  catalog: [{ path: '/' }],
  baseline: { epoch: 1, catalog: 'catalog', populationVersion: 'v1' },
  policy: { mode: 'strict', revision: '1' },
  policySnapshot: 'policy',
  dataRevision: '1',
  quality: { state: 'complete', sourceVersion: '1' },
  measurement: {
    intervals: 1,
    interval: '1',
    intervalSamples: 2,
    requests: 2,
    versions: 1,
    samples: 2,
  },
} as any;
function executor(reliable: number) {
  const metadata = {
    resourceKind: 'website',
    eligibleEvents: 2,
    qualifiedEvents: reliable,
    eligiblePV: 2,
    qualifiedPV: reliable,
    qualifiedVisitors: reliable ? 1 : 0,
  };
  return {
    execute: vi.fn(),
    query: vi.fn(async (sql: string) => {
      if (sql.includes('WITH population AS MATERIALIZED')) return [metadata];
      if (sql.includes('AS "identityQualifiedPv"'))
        return [
          {
            pv: 2,
            uv: 1,
            visits: 1,
            observed: 2,
            notCollected: 0,
            currentVersion: 2,
            identityQualifiedPv: reliable,
            identityQualifiedVisitors: reliable ? 1 : 0,
            identityVersions: ['v1'],
          },
        ];
      if (sql.includes('AS "flaggedPv"')) return [{ flaggedPv: 2, flaggedUv: 1 }];
      if (sql.includes("coalesce(s.browser,'unknown')"))
        return [
          {
            browser: 'Chrome',
            source: 'browser',
            classification: 'eligible_browser',
            version: 'v1',
            features: null,
            pv: 2,
            uv: 1,
          },
        ];
      if (sql.includes('AS observed'))
        return [{ pv: 2, uv: 1, visits: 1, observed: 2, currentVersion: 2 }];
      if (sql.includes('liekan_observation_state')) return [];
      if (sql.includes('WITH first_in_window'))
        return [
          {
            referrer: 'chatgpt.com',
            utmSource: null,
            utmMedium: null,
            utmCampaign: null,
            path: '/',
            hostname: 'example.com',
            visits: 1,
            conversions: 1,
            goalEvents: 2,
          },
        ];
      if (sql.includes('AS configured')) return [{ configured: true }];
      if (sql.includes('AS connected')) return [{ connected: true }];
      if (sql.includes('q.hostname IS NULL')) return [];
      if (sql.includes('SELECT e.url_path AS path'))
        return [{ path: '/', pv: 2, uv: 1, visits: 1 }];
      if (sql.startsWith('SELECT count(*)::float8 AS pv')) return [{ pv: 2, uv: 1, visits: 1 }];
      return [];
    }),
  };
}
describe('browser identity in crawler evidence', () => {
  it.each([0, 1, 2])(
    'gates reconciliation and outcomes over the same full window (%s reliable PV)',
    async reliable => {
      const tx = executor(reliable);
      const reconciliation = await readReconciliation(tx as any, websiteId, params, input);
      expect(reconciliation.rows[0]).toMatchObject({
        pv: 2,
        uv: reliable === 2 ? 1 : null,
        visits: reliable === 2 ? 1 : null,
      });
      expect(reconciliation.browserTotals).toEqual({
        pv: 2,
        uv: reliable === 2 ? 1 : null,
        visits: reliable === 2 ? 1 : null,
      });
      const outcomes = await readOutcomes(tx as any, websiteId, params, input);
      expect(outcomes.rows[0]).toMatchObject({
        visits: reliable === 2 ? 1 : null,
        observedVisits: reliable === 2 ? 1 : null,
        conversions: reliable === 2 ? 1 : null,
        goalEvents: 2,
        ratioDenominator: reliable === 2 ? 1 : null,
      });
      expect(outcomes.totals.visits).toBe(reliable === 2 ? 1 : null);
      expect(outcomes.reasons[0]).toMatchObject({
        visits: reliable === 2 ? 1 : null,
        conversions: reliable === 2 ? 1 : null,
        goalEvents: 2,
      });
      expect(outcomes.meta.browserPopulation).toEqual(reconciliation.meta.browserPopulation);
      expect(outcomes.meta.browserPopulation.range).toEqual({ ...range, endExclusive: true });
      expect(
        tx.query.mock.calls.filter(([sql]) => sql.includes('WITH population AS MATERIALIZED')),
      ).toHaveLength(1);
    },
  );
  it.each(['raw', 'eligible'])(
    'uses the actual reception population for %s observation identities',
    async subset => {
      const tx = executor(subset === 'raw' ? 1 : 2);
      const result = await readObservations(tx as any, websiteId, { ...params, subset }, input);
      const usable = subset === 'eligible';
      expect(result.rows[0]).toMatchObject({ pv: 2, uv: usable ? 1 : null });
      expect(result.totals).toMatchObject({
        pv: 2,
        uv: usable ? 1 : null,
        visits: usable ? 1 : null,
        flaggedPv: 2,
        flaggedUv: usable ? 1 : null,
      });
      expect(result.meta.observationIdentity).toMatchObject({
        timeBasis: 'received_at',
        population: `${subset}_public_pv`,
        range: { ...range, endExclusive: true },
        status: usable ? 'complete' : 'partial',
        qualifiedPV: usable ? 2 : 1,
        coverage: usable ? 1 : 0.5,
      });
      expect(
        tx.query.mock.calls.some(([sql]) => sql.includes('WITH population AS MATERIALIZED')),
      ).toBe(false);
      const identitySql = tx.query.mock.calls.find(([sql]) =>
        sql.includes('AS "identityQualifiedPv"'),
      )?.[0];
      expect(identitySql).toContain('JOIN "public"."session" s');
      expect(identitySql).toContain('coalesce(o.received_at,q.created_at)>=$2');
      expect(identitySql).toContain('coalesce(o.received_at,q.created_at)<$3');
      expect(identitySql?.includes('EXISTS(SELECT 1 FROM website_event eligible')).toBe(usable);
    },
  );
});

describe('observation raw session schema through the real policy executor', () => {
  it.each(
    ['public', 'tenant_analytics', 'Tenant_2026'].flatMap(schema =>
      ['raw', 'eligible'].map(subset => ({ schema, subset })),
    ),
  )('uses configured $schema for $subset reception reads', async ({ schema, subset }) => {
    const url = new URL('postgresql://fixture:fixture@127.0.0.1:1/isolated');
    if (schema !== 'public') url.searchParams.set('schema', schema);
    vi.stubEnv('DATABASE_URL', url.toString());
    const fixture = executor(2);
    const raw = {
      $queryRawUnsafe: vi.fn((sql: string) => fixture.query(sql)),
      $executeRawUnsafe: vi.fn(),
    };
    const result = await readObservations(aiExecutor(raw), websiteId, { ...params, subset }, input);
    expect(result.totals).toMatchObject({ pv: 2, uv: 1, visits: 1 });
    const statements = raw.$queryRawUnsafe.mock.calls.filter(([sql]) =>
      sql.includes('liekan_raw_website_event e'),
    );
    expect(statements).toHaveLength(3);
    for (const [sql] of statements) {
      expect(sql).toContain(`JOIN "${schema}"."session" s`);
      expect(sql).not.toContain('liekan_effective_session');
      expect(
        sql.includes(
          'website_event AS NOT MATERIALIZED (SELECT * FROM liekan_geographic_website_event)',
        ),
      ).toBe(subset === 'eligible');
    }
  });
  it.each(['tenant"; DROP TABLE session;--', 'tenant,public', 'tenant.schema'])(
    'rejects invalid schema before issuing observation SQL (%s)',
    async schema => {
      const url = new URL('postgresql://fixture:fixture@127.0.0.1:1/isolated');
      url.searchParams.set('schema', schema);
      vi.stubEnv('DATABASE_URL', url.toString());
      const fixture = executor(2);
      const raw = {
        $queryRawUnsafe: vi.fn((sql: string) => fixture.query(sql)),
        $executeRawUnsafe: vi.fn(),
      };
      await expect(
        readObservations(aiExecutor(raw), websiteId, { ...params, subset: 'raw' }, input),
      ).rejects.toMatchObject({ code: 'database_unavailable', status: 503 });
      expect(raw.$queryRawUnsafe).not.toHaveBeenCalled();
    },
  );
});
