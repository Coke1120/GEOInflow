// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildOpenApiDocument } from './document';

let document: Awaited<ReturnType<typeof buildOpenApiDocument>>['document'];
let coverage: Awaited<ReturnType<typeof buildOpenApiDocument>>['coverage'];
beforeAll(async () => {
  vi.stubEnv(
    'DATABASE_URL',
    process.env.DATABASE_URL || 'postgresql://synthetic:synthetic@127.0.0.1:1/synthetic',
  );
  ({ document, coverage } = await buildOpenApiDocument('all'));
}, 120000);
afterAll(() => vi.unstubAllEnvs());
const site = '/api/websites/{websiteId}';
const types = (value: any): string[] =>
  value.type
    ? Array.isArray(value.type)
      ? value.type
      : [value.type]
    : (value.anyOf || value.oneOf || []).flatMap(types);
const operation = (path: string) => document.paths[path].get as any;
const schema = (path: string) => {
  let value = operation(path).responses['200'].content['application/json'].schema;
  while (value.$ref)
    value = value.$ref
      .slice(2)
      .split('/')
      .reduce((node: any, key: string) => node[key], document);
  return value;
};

describe('published reporting-population contracts', () => {
  it('discovers the real delegated event-data handler with its typed response and protected query', () => {
    const route = coverage.discovered.find(
      entry => entry.path === `${site}/event-data` && entry.method === 'get',
    );
    expect(route.analysis.auth).toBe('bearer-or-share');
    expect(route.analysis.requestSchema).toHaveProperty('properties.startAt');
    expect(route.analysis.requestSchema).toHaveProperty('properties.page');
    expect(route.analysis.responseSchemas[200]).toHaveProperty('properties.data');
    expect(route.analysis.responseStatuses).toContain(401);
  });
  it('preserves protected route security and request parameters through cached GET wrappers', () => {
    for (const path of [
      `${site}/event-data`,
      `${site}/sessions/weekly`,
      `${site}/sessions/stats`,
    ]) {
      const op = operation(path);
      expect(op.security).toContainEqual({ bearerAuth: [] });
      expect(op.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ in: 'path', name: 'websiteId' }),
          expect.objectContaining({ in: 'query', name: 'startAt' }),
          expect.objectContaining({ in: 'query', name: 'endAt' }),
        ]),
      );
      expect(op.responses['401']).toBeDefined();
      expect(op.responses['200'].headers['X-Liekan-Population']).toBeDefined();
    }
  });
  it('keeps weekly array responses and nullable identity-dependent nested values', () => {
    const weekly = schema(`${site}/sessions/weekly`);
    expect(weekly.type).toBe('array');
    expect(weekly.items.type).toBe('array');
    expect(weekly.items.items.type).toEqual(['number', 'null']);
    const stats = schema(`${site}/sessions/stats`);
    expect(stats.properties.visitors.properties.value.type).toEqual(['number', 'null']);
    expect(stats.properties.visits.properties.value.type).toEqual(['number', 'null']);
    expect(stats.properties.pageviews.properties.value.type).toBe('number');
    expect(stats.properties.population.properties.identity.properties.status.enum).toContain(
      'partial',
    );
    expect(stats.properties.population.properties.governanceProcessing).toBeDefined();
    const detail = schema(`${site}/sessions/{sessionId}`);
    expect(detail.properties.stitchedSessionCount.type).toEqual(['number', 'null']);
    expect(detail.properties.visits.type).toEqual(['number', 'null']);
    expect(detail.properties.totaltime.type).toEqual(['number', 'string', 'null']);
    expect(detail.properties.population).toBeDefined();
  });
  it('publishes nullable counts on the exact session detail and replay feature alternatives', () => {
    const analytics = schema('/api/liekan/websites/{websiteId}/analytics');
    const branches = analytics.anyOf || analytics.oneOf;
    const session = branches.find(
      (branch: any) => branch.properties?.totals?.properties?.entryPath,
    );
    const replays = branches.find(
      (branch: any) => branch.properties?.rows?.items?.properties?.chunkCount,
    );
    expect(types(session.properties.totals.properties.count)).toContain('null');
    expect(types(replays.properties.count)).toContain('null');
    expect(types(session.properties.totals.properties.views)).not.toContain('null');
    const revenue = branches.find(
      (branch: any) => branch.properties?.rows?.items?.properties?.amount,
    );
    expect(types(revenue.properties.count)).not.toContain('null');
  });
  it('publishes crawler and reception identity nulls with their distinct metadata', () => {
    const base = '/api/liekan/websites/{websiteId}';
    const analysis = schema(`${base}/crawler-analysis`);
    expect(analysis.properties.population).toBeDefined();
    expect(analysis.properties.previous.properties.population).toBeDefined();
    const platform = analysis.properties.platforms.items;
    expect(platform.properties.state.enum).toContain('unknown');
    expect(types(platform.properties.landingPages.items.properties.visits)).toContain('null');
    const outcomes = schema(`${base}/crawler-analysis/outcomes`);
    expect(outcomes.properties.meta.properties.browserPopulation).toBeDefined();
    expect(types(outcomes.properties.rows.items.properties.visits)).toContain('null');
    expect(types(outcomes.properties.rows.items.properties.unknownBrowserHost)).toContain('null');
    const observations = schema(`${base}/traffic-quality/observations`);
    expect(types(observations.properties.rows.items.properties.uv)).toContain('null');
    const identity = observations.properties.meta.properties.observationIdentity;
    expect(identity.properties.timeBasis.const).toBe('received_at');
    expect(identity.properties.population.enum).toEqual(['raw_public_pv', 'eligible_public_pv']);
    expect(identity.properties.range.properties.endExclusive.const).toBe(true);
    expect(identity.properties.totalPV).toBeDefined();
  });
  it('documents decimal revenue precision and isolates unavailable paging to identity lists', () => {
    const revenue = schema(`${site}/revenue/stats`);
    expect(revenue.properties.sum.type).toEqual(['number', 'string', 'null']);
    expect(revenue.properties.comparison.properties.sum.type).toEqual(['number', 'string', 'null']);
    expect(revenue.properties.count.type).toBe('number');
    for (const suffix of ['sessions', 'session-data-pivot', 'revenue/sessions', 'replays']) {
      const list = schema(`${site}/${suffix}`);
      expect(types(list.properties.count), suffix).toContain('null');
      expect(
        types(list.properties.count).some(type => ['number', 'integer'].includes(type)),
        suffix,
      ).toBe(true);
      expect(list.properties.population).toBeDefined();
    }
    const unrelated = schema('/api/teams/{teamId}/users');
    expect(unrelated.properties.count.type).toBe('number');
    expect(unrelated.properties.population).toBeUndefined();
  });
});
