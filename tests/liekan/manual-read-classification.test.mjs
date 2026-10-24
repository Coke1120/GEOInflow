import assert from 'node:assert/strict';
import { test } from 'node:test';
import { manualReadKind } from '../../scripts/liekan-manual-read-contract.mjs';

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
