// @vitest-environment node
import { expect, it } from 'vitest';
import {
  analysisDigest,
  encodeAnalysisResult,
  encodeAnalysisEnvelope,
  decodeAnalysisEnvelope,
  analysisQueryParameters,
  analysisResultFresh,
} from './analysis-query-model';

const websiteId = '11111111-1111-4111-8111-111111111111';
const population = {
  resourceId: websiteId,
  populationVersion: 'browser-population-v4',
  resourceKind: 'website' as const,
  capability: 'supported' as const,
  scope: 'resource-window' as const,
  policyRevision: '1',
  historyActiveGeneration: null,
  historyRevision: null,
  epoch: '3',
  governanceRevision: '4',
  governanceWatermark: null,
  identity: {
    status: 'partial' as const,
    eligibleEvents: 8,
    eligiblePV: 5,
    qualifiedPV: 2,
    qualifiedVisitors: 1,
    coverage: 0.4,
    versions: ['identity-v1'],
  },
  ruleVersions: ['rule-v1'],
  catalogVersions: ['catalog-v1'],
  versionSetsTruncated: false,
  range: { startAt: 1000, endAt: 2000, timezone: 'Asia/Shanghai', endExclusive: true },
};

it('round-trips native values and complete current/comparison population metadata', () => {
  const comparison = { ...population, range: { ...population.range, startAt: 0, endAt: 1000 } };
  const value = [{ x: 'Chrome', y: 2n }];
  const encoded = encodeAnalysisEnvelope(value, [population, comparison], websiteId);
  const result = decodeAnalysisEnvelope(JSON.parse(encoded), websiteId);
  expect(result.value).toEqual([{ x: 'Chrome', y: 2 }]);
  expect(result.populations).toEqual([population, comparison]);
  expect(result.value).not.toHaveProperty('format');
});

it('rejects unknown, incomplete and cross-resource durable result envelopes', () => {
  const valid = JSON.parse(encodeAnalysisEnvelope([], [population], websiteId));
  for (const input of [
    [],
    { format: 'unknown', value: [], populations: [] },
    { ...valid, arbitrary: true },
    { format: valid.format, populations: [] },
    { ...valid, populations: [{ ...population, resourceId: 'another-site' }] },
    { ...valid, populations: [{ ...population, identity: { status: 'invented' } }] },
  ])
    expect(() => decodeAnalysisEnvelope(input, websiteId)).toThrow();
});

it('counts the whole metadata envelope against the unchanged durable byte limit', () => {
  const large = { ...population, ruleVersions: ['x'.repeat(2 * 1024 * 1024)] };
  expect(() => encodeAnalysisEnvelope([], [large], websiteId)).toThrow('保存上限');
});
it('canonicalizes parameter order and refresh control without losing filters', () => {
  const input = { startAt: 0, endAt: 2000, browser: 'eq.Chrome', type: 'browser' };
  expect(analysisDigest(input)).toBe(
    analysisDigest({ type: 'browser', browser: 'eq.Chrome', endAt: 2000, startAt: 0 }),
  );
  expect(analysisQueryParameters('native:metrics', { ...input, refresh: '1' })).toMatchObject({
    browser: 'eq.Chrome',
    type: 'browser',
  });
  expect(analysisQueryParameters('native:metrics', { ...input, refresh: '1' })).not.toHaveProperty(
    'refresh',
  );
});
it('rejects unregistered targets, row protocols and silently stripped conditions', () => {
  for (const target of ['feature:shared-report', 'native:arbitrary'])
    expect(() => analysisQueryParameters(target, { startAt: 0, endAt: 2000 })).toThrow();
  for (const resource of ['logs', 'human/keywords'])
    expect(() =>
      analysisQueryParameters('feature:page-report', { resource, startAt: 0, endAt: 2000 }),
    ).toThrow();
  expect(() =>
    analysisQueryParameters('native:stats', { startAt: 0, endAt: 2000, inventedFilter: 'foo' }),
  ).toThrow();
});
it('keeps retention distinct from freshness, including exact expiry', () => {
  const row = { status: 'ready', expires_at: new Date(1000), retention_until: new Date(100000) };
  expect(analysisResultFresh(row, 999)).toBe(true);
  expect(analysisResultFresh(row, 1000)).toBe(false);
  expect(analysisResultFresh({ ...row, status: 'running' }, 500)).toBe(false);
  expect(analysisResultFresh({ ...row, retention_until: new Date(1) }, 500)).toBe(false);
});

it('excludes row and realtime feature protocols from persistent tasks', () => {
  for (const kind of [
    'realtime',
    'session',
    'sessions',
    'session-properties',
    'events',
    'replays',
    'revenue',
  ])
    expect(() =>
      analysisQueryParameters('feature:analytics', { kind, startAt: 0, endAt: 2000 }),
    ).toThrow('独立读取协议');
});

it('rejects unsafe bigint before a global bigint serializer can round it', () => {
  const prototype = BigInt.prototype as any;
  const original = prototype.toJSON;
  try {
    prototype.toJSON = function () {
      return Number(this);
    };
    expect(() => encodeAnalysisResult({ visitors: 9007199254740993n })).toThrow('安全范围');
    expect(encodeAnalysisResult({ visitors: 7n })).toBe('{"visitors":7}');
  } finally {
    if (original) prototype.toJSON = original;
    else delete prototype.toJSON;
  }
});
