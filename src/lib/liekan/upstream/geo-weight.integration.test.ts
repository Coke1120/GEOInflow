// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getBundledPublishedCatalog } from '../crawlers/catalog-seed';
import { geoWeightAggregate, geoWeightFirstEvidence } from './geo-weight-sql';
import { geoWindow } from '../geo-weight/window';
import { geoPoint } from '../geo-weight/evidence';
import type { AiTx } from './ai-db';

const enabled = !!process.env.LIEKAN_GEO_TEST_URL;
const site = randomUUID(),
  source = randomUUID(),
  catalog = getBundledPublishedCatalog();
const window = geoWindow('2026-10-20', 'Asia/Shanghai');
let pool: Pool, client: PoolClient, tx: AiTx;
const q = (sql: string, ...params: unknown[]) => client.query(sql, params);
async function log(overrides: Record<string, unknown> = {}) {
  const id = randomUUID(),
    { evidence = {}, ...fields } = overrides;
  const value = {
    id,
    website_id: site,
    created_at: '2026-10-10T00:00:00Z',
    path: '/article',
    method: 'GET',
    status: 200,
    source_id: source,
    ai_eligible: true,
    recognition_state: 'recognized',
    verification: 'verified_range',
    verification_version: 'snapshot-1',
    verification_observed_at: '2026-10-10T00:00:00Z',
    verification_reason: 'verified_range',
    user_agent: 'OAI-SearchBot',
    ...fields,
  };
  await q(
    `INSERT INTO liekan_effective_log (${Object.keys(value).join(',')}) VALUES (${Object.keys(value)
      .map((_, i) => '$' + (i + 1))
      .join(',')})`,
    ...Object.values(value),
  );
  const ev = {
    website_id: site,
    log_id: id,
    crawler_id: 'oai-searchbot',
    catalog_version: catalog.version,
    classification_version: 'class-1',
    identity_evidence: '{}',
    measurement: JSON.stringify({
      host: 'www.example.com',
      hostBasis: 'request_host',
      samplingRate: 1,
      samplingBasis: 'observed_provider_config',
      samplingTimeBasis: 'event_time',
    }),
    edge_observation: JSON.stringify({
      fields: { EdgeResponseContentType: { state: 'present', value: 'text/html' } },
    }),
    ...(evidence as object),
  };
  await q(
    `INSERT INTO liekan_crawler_evidence (${Object.keys(ev).join(',')}) VALUES (${Object.keys(ev)
      .map((_, i) => '$' + (i + 1))
      .join(',')})`,
    ...Object.values(ev),
  );
}
const aggregate = async () =>
  (await geoWeightAggregate(tx, site, 'www.example.com', 'Asia/Shanghai', [window]))[0];
describe.skipIf(!enabled)('GEO full-population PostgreSQL aggregate', () => {
  beforeAll(async () => {
    const url = new URL(process.env.LIEKAN_GEO_TEST_URL);
    if (url.hostname !== '127.0.0.1' || url.port !== '15450' || url.pathname !== '/liekan_geo_test')
      throw new Error('Only owned GEO acceptance database is allowed');
    pool = new Pool({ connectionString: url.toString() });
  });
  beforeEach(async () => {
    client = await pool.connect();
    await q('BEGIN');
    // Temporary fixture tables exercise the production aggregate in real PostgreSQL.
    await q(`CREATE TEMP TABLE liekan_effective_log (id text,website_id uuid,created_at timestamptz,path text,method text,status int,source_id uuid,ai_eligible boolean,recognition_state text,verification text,verification_version text,verification_observed_at timestamptz,verification_reason text,user_agent text);
      CREATE TEMP TABLE liekan_crawler_evidence (website_id uuid,log_id text,crawler_id text,catalog_version uuid,classification_version text,measurement jsonb,identity_evidence jsonb,edge_observation jsonb);
      CREATE TEMP TABLE liekan_crawler_rule_version (website_id uuid,version text,catalog_version uuid,crawler_configuration jsonb);
      CREATE TEMP TABLE liekan_crawler_registry_version (version uuid,payload jsonb);
      CREATE TEMP TABLE liekan_crawler_range_snapshot (version text,crawler_ids jsonb,source_id text,source_url text);`);
    await q(
      'INSERT INTO liekan_crawler_registry_version VALUES($1,$2)',
      catalog.version,
      JSON.stringify(catalog.payload),
    );
    await q(
      'INSERT INTO liekan_crawler_rule_version VALUES($1,$2,$3,$4)',
      site,
      'class-1',
      catalog.version,
      '{}',
    );
    const range = catalog.payload.rangeSources.find(r => r.crawlerIds.includes('oai-searchbot'));
    await q(
      'INSERT INTO liekan_crawler_range_snapshot VALUES($1,$2,$3,$4)',
      'snapshot-1',
      JSON.stringify(range.crawlerIds),
      range.id,
      range.url,
    );
    tx = {
      query: async (sql, ...args) => (await q(sql, ...args)).rows,
      execute: async (sql, ...args) => (await q(sql, ...args)).rowCount,
    };
  });
  afterEach(async () => {
    await q('ROLLBACK');
    client.release();
  });
  afterAll(async () => {
    await pool?.end();
  });
  it('retains archived ordinary traffic as observation evidence without requiring a crawler identity', async () => {
    await log({
      ai_eligible: false,
      recognition_state: 'unknown',
      verification: 'not_applicable',
      evidence: { crawler_id: null },
    });
    const quality = {
      state: 'complete',
      basis: 'event_time',
      classificationVersion: 'class-1',
      sourceVersion: source,
      timezone: 'Asia/Shanghai',
    } as const;
    let result = await aggregate();
    expect(result.stats).toMatchObject({
      historyMissing: 0,
      identityMissing: 0,
      firstEvidenceDay: '2026-10-10',
    });
    expect(geoPoint(window, result, quality, false, true)).toMatchObject({
      state: 'observed_zero',
      weightedUnits: 0,
      level: 0,
      reasons: [],
    });
    await log();
    result = await aggregate();
    expect(geoPoint(window, result, quality, false, true)).toMatchObject({
      state: 'aligned',
      reasons: [],
    });
    await q('UPDATE liekan_crawler_rule_version SET crawler_configuration=NULL');
    expect((await aggregate()).stats.historyMissing).toBe(2);
  });
  it('uses archived ordinary input outside the score window to establish observation span', async () => {
    await log({
      created_at: '2026-08-01T00:00:00Z',
      ai_eligible: false,
      recognition_state: 'unknown',
      evidence: { crawler_id: null },
    });
    await log({ created_at: '2026-07-01T00:00:00Z', user_agent: 'Liekan-Crawler-Check/1' });
    await log({ created_at: '2026-06-01T00:00:00Z', evidence: { catalog_version: randomUUID() } });
    await log({
      created_at: '2026-05-01T00:00:00Z',
      evidence: {
        measurement: JSON.stringify({ host: 'other.example.com', hostBasis: 'request_host' }),
      },
    });
    expect(
      await geoWeightFirstEvidence(tx, site, 'www.example.com', 'Asia/Shanghai', window.endAt),
    ).toBe('2026-08-01');
    await q('UPDATE liekan_crawler_rule_version SET crawler_configuration=NULL');
    expect(
      await geoWeightFirstEvidence(tx, site, 'www.example.com', 'Asia/Shanghai', window.endAt),
    ).toBeUndefined();
  });
  it('keeps personal-agent observations within the current host after a domain change', async () => {
    const agent = { crawler_id: 'chatgpt-agent' };
    await log({ evidence: agent });
    await log({
      evidence: {
        ...agent,
        measurement: JSON.stringify({ host: 'old.example.com', hostBasis: 'request_host' }),
      },
    });
    await log({ evidence: { ...agent, measurement: JSON.stringify({ host: 'www.example.com' }) } });
    await log({ recognition_state: 'ambiguous', evidence: agent });
    const result = await aggregate();
    expect(result.forms).toEqual([{ form: 'personal_agent', requests: 1 }]);
    expect(result.exclusions).toMatchObject({ host: 2, ambiguous: 1, outside_scope: 1 });
  });
  it('keeps self-check-only windows equivalent to empty windows for evidence quality', async () => {
    const quality = {
      state: 'complete',
      basis: 'event_time',
      classificationVersion: 'class-1',
      sourceVersion: source,
      timezone: 'Asia/Shanghai',
    } as const;
    const empty = geoPoint(window, await aggregate(), quality, false, true);
    await log({ user_agent: 'Liekan-Crawler-Check/1' });
    const checked = geoPoint(window, await aggregate(), quality, false, true);
    expect(checked).toMatchObject({
      state: empty.state,
      reasons: empty.reasons,
      comparableKey: empty.comparableKey,
      accepted: 0,
      requests: 1,
      exclusions: { self_check: 1 },
    });
    expect(
      geoPoint(window, await aggregate(), { ...quality, state: 'missing' }, false, false).state,
    ).toBe('missing');
  });
  it('combines repeated 200/304 requests and grants operator breadth only at ten units over three days', async () => {
    await log();
    await log({ status: 304 });
    await log({ path: '/another' });
    let result = await aggregate();
    expect(result.factors).toEqual([
      { purpose: 'search', paths: 2, units: 2, days: 1, operators: 0 },
    ]);
    expect(result.stats).toMatchObject({ accepted: 3, status200: 2, status304: 1 });
    for (let i = 0; i < 8; i++)
      await log({
        path: '/extra-' + i,
        created_at: i % 2 ? '2026-10-11T00:00:00Z' : '2026-10-12T00:00:00Z',
      });
    result = await aggregate();
    expect(result.factors[0]).toMatchObject({ paths: 10, units: 10, days: 3, operators: 1 });
  });
  it('uses an exclusive reason for self checks, host gaps, ambiguity, missing history and invalid verification', async () => {
    await log({ user_agent: 'Liekan-Crawler-Check/1', status: 500 });
    await log({ evidence: { measurement: JSON.stringify({ host: 'www.example.com' }) } });
    await log({ recognition_state: 'ambiguous' });
    await log({ evidence: { crawler_id: 'bytespider' } });
    await log({ evidence: { catalog_version: randomUUID() } });
    await log({ verification_observed_at: '2026-01-01T00:00:00Z' });
    await log({ method: 'HEAD' });
    await log({ path: '/sitemap-index.xml' });
    const result = await aggregate();
    expect(result.stats.accepted).toBe(0);
    expect(result.exclusions).toEqual({
      self_check: 1,
      host: 1,
      ambiguous: 1,
      outside_scope: 1,
      history: 1,
      verification: 1,
      response: 1,
      content: 1,
    });
  });
  it('lets explicit HTML MIME override a static suffix and retains path-inference diagnostics', async () => {
    await log({ path: '/article.json' });
    await log({ path: '/article.pdf', evidence: { edge_observation: null } });
    await log({ path: '/static.css', evidence: { edge_observation: null } });
    await log({
      path: '/looks-readable',
      evidence: {
        edge_observation: JSON.stringify({
          fields: { EdgeResponseContentType: { state: 'invalid' } },
        }),
      },
    });
    expect((await aggregate()).stats).toMatchObject({
      accepted: 2,
      mimeConfirmed: 1,
      pathInferred: 1,
    });
  });
  it('deduplicates range bindings and excludes disabled or mismatched identity sources', async () => {
    await log();
    const changed = structuredClone(catalog.payload);
    const range = changed.rangeSources.find(r => r.crawlerIds.includes('oai-searchbot'));
    changed.rangeSources.push(structuredClone(range));
    await q('UPDATE liekan_crawler_registry_version SET payload=$1', JSON.stringify(changed));
    expect((await aggregate()).stats.accepted).toBe(1);
    for (const source of changed.rangeSources) source.enabled = false;
    await q('UPDATE liekan_crawler_registry_version SET payload=$1', JSON.stringify(changed));
    expect((await aggregate()).exclusions.verification).toBe(1);
    for (const source of changed.rangeSources) {
      source.enabled = true;
      source.crawlerIds = ['gptbot'];
    }
    await q('UPDATE liekan_crawler_registry_version SET payload=$1', JSON.stringify(changed));
    expect((await aggregate()).exclusions.verification).toBe(1);
  });
  it('uses archived catalog semantics and binding, and never upgrades unknown history', async () => {
    await log();
    const changed = structuredClone(catalog.payload);
    changed.identities.find(i => i.id === 'oai-searchbot').purpose = 'training';
    await q(
      'INSERT INTO liekan_crawler_registry_version VALUES($1,$2)',
      randomUUID(),
      JSON.stringify(changed),
    );
    expect((await aggregate()).stats.accepted).toBe(1);
    await q(
      "UPDATE liekan_crawler_range_snapshot SET source_url='https://unbound.example.org/list'",
    );
    expect((await aggregate()).exclusions.verification).toBe(1);
    await q('UPDATE liekan_crawler_rule_version SET crawler_configuration=NULL');
    expect((await aggregate()).exclusions.history).toBe(1);
  });
  it('counts the full population past page-list limits and excludes adjacent sites and end boundary', async () => {
    await log();
    await q(
      `INSERT INTO liekan_effective_log SELECT 'bulk-'||n,website_id,created_at,'/bulk-'||n,method,status,source_id,ai_eligible,recognition_state,verification,verification_version,verification_observed_at,verification_reason,user_agent FROM liekan_effective_log CROSS JOIN generate_series(1,1200) n`,
    );
    await q(
      `INSERT INTO liekan_crawler_evidence SELECT website_id,'bulk-'||n,crawler_id,catalog_version,classification_version,measurement,identity_evidence,edge_observation FROM liekan_crawler_evidence CROSS JOIN generate_series(1,1200) n`,
    );
    await log({ website_id: randomUUID() });
    await log({ created_at: new Date(window.endAt).toISOString() });
    const result = await aggregate();
    expect(result.factors[0]).toMatchObject({ paths: 1201, units: 1201 });
    expect(JSON.stringify(result)).not.toMatch(/user_agent|ip_hash|ip_masked/);
  });
});
