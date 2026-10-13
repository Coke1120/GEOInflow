// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  assertManualReadPolicy,
  manualPageReads,
  assertManualPageReads,
} from '../../../../scripts/liekan-manual-read-contract.mjs';

it('accepts the complete classified page inventory and closed ordinary read policy', () => {
  const inventory = assertManualReadPolicy();
  expect(inventory.features).toHaveLength(68);
  expect(inventory.routes).toHaveLength(58);
  expect(inventory.files).toHaveLength(74);
});

it.each(['refetchOnWindowFocus', 'refetchOnReconnect', 'refetchInterval', 'retry'])(
  'rejects a restored automatic option: %s',
  option => {
    const read = (path: string) =>
      readFileSync(path, 'utf8').replace(`${option}: false`, `${option}: true`);
    expect(() => assertManualReadPolicy(read)).toThrow(option);
  },
);

it('rejects a direct AI query bypass and navigation prefetch', () => {
  const read = (path: string) => readFileSync(path, 'utf8');
  expect(() =>
    assertManualReadPolicy(path =>
      path.endsWith('/AiShared.tsx')
        ? read(path).replace('contracts/manual-refresh', 'upstream/raw')
        : read(path),
    ),
  ).toThrow('AiShared');
  expect(() =>
    assertManualReadPolicy(path =>
      path.endsWith('/Navigation.tsx') ? read(path) + '\nprefetchQuery(' : read(path),
    ),
  ).toThrow('prefetch');
});

it('classifies every feature and requires its own successful data endpoint', () => {
  const inventory = assertManualReadPolicy();
  for (const feature of inventory.features) {
    const policy = manualPageReads(feature.id, { websiteId: 'site', id: 'record' });
    expect(() => assertManualPageReads(policy, policy.endpoints, feature.id)).not.toThrow();
    if (policy.endpoints.length)
      expect(() =>
        assertManualPageReads(policy, [{ path: '/api/me/websites' }], feature.id),
      ).toThrow('missing successful page read');
    else expect(policy.exception).toBeTruthy();
  }
  const policy = manualPageReads('sessions', { websiteId: 'site' });
  expect(() =>
    assertManualPageReads(
      policy,
      [{ path: '/api/liekan/websites/site/analytics', kind: 'events' }],
      'sessions',
    ),
  ).toThrow();
});

it.each(['tracking', 'install-check', 'website-settings'])(
  '%s requires original collection presence independently of filtered analytics',
  page => {
    const policy = manualPageReads(page, { websiteId: 'site' });
    const metadata = { path: '/api/websites/site' };
    const presence = { path: '/api/liekan/websites/site/installation' };
    expect(() => assertManualPageReads(policy, [metadata, presence], page)).not.toThrow();
    expect(() =>
      assertManualPageReads(
        policy,
        [metadata, { path: '/api/websites/site/stats' }, { path: '/api/websites/site/daterange' }],
        page,
      ),
    ).toThrow('installation');
    expect(() => assertManualPageReads(policy, [presence], page)).toThrow('/api/websites/site');
  },
);
