import assert from 'node:assert/strict';
import { test } from 'node:test';
import { manualReadKind, livePageReadAllowed } from '../../scripts/liekan-manual-read-contract.mjs';

test('limits automatic reads to realtime, today and their bounded job protocol', () => {
  const now = +new Date('2026-10-24T10:00Z');
  assert.equal(livePageReadAllowed({ path: '/api/realtime/site' }, now), true);
  assert.equal(livePageReadAllowed({ path: '/api/websites/site/active' }, now), true);
  assert.equal(livePageReadAllowed({ path: '/api/websites/site/heatmaps', startAt: 0, endAt: now }, now), false);
  assert.equal(livePageReadAllowed({ path: '/api/websites/site/stats', startAt: 0, endAt: now - 86400000 }, now), false);
  assert.equal(livePageReadAllowed({ path: '/api/websites/site/stats', startAt: 0, endAt: now }, now), true);
  assert.equal(livePageReadAllowed({ path: '/api/liekan/websites/site/page-report', resource: 'logs', startAt: 0, endAt: now }, now), false);
  assert.equal(livePageReadAllowed({ path: '/api/liekan/websites/site/page-report', resource: 'ai/overview', startAt: 0, endAt: +new Date('2026-10-24T00:00Z'), crawlerMetricsVersion: '1' }, now), false);
});

test('public geography credits remain recorded metadata during share reauthorization', () => {
  assert.equal(manualReadKind('GET', '/api/liekan/geography/attribution'), 'metadata');
});

test('statistics, reports and nearby paths retain strict ordinary-read checks', () => {
  for (const path of [
    '/api/websites/site/stats',
    '/api/websites/site/metrics',
    '/api/liekan/websites/site/shared-report',
    '/api/liekan/websites/site/attribution',
    '/api/liekan/geography/attribution/extra',
    '/api/liekan/history-repair/extra',
  ]) assert.equal(manualReadKind('GET', path), 'ordinary', path);
});

test('authorization and non-read operations preserve their existing exceptions', () => {
  for (const path of ['/api/auth/verify', '/api/2fa/status', '/api/auth/subscription',
    '/api/liekan/history-repair', '/api/admin/users/person/2fa', '/api/share/public'])
    assert.equal(manualReadKind('GET', path), 'ignored', path);
  assert.equal(manualReadKind('POST', '/api/websites/site/stats'), 'ignored');
  assert.equal(manualReadKind('GET', '/websites'), 'ignored');
});
