// @vitest-environment node
import { expect, it } from 'vitest';
import {
  analysisDigest,
  encodeAnalysisResult,
  analysisQueryParameters,
  analysisResultFresh,
} from './analysis-query-model';
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
