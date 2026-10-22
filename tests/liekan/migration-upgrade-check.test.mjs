import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertMigrationUpgrade } from '../../scripts/liekan-migration-upgrade-check.mjs';

test('upgrade preserves independent migration records and verifies the complete candidate', () => {
  const prior = [{ name: '036_parallel.sql', checksum: 'parallel', appliedAt: 'old-time' }];
  const added = { name: '037_browser.sql', checksum: 'browser', appliedAt: 'new-time' };
  assert.deepEqual(
    assertMigrationUpgrade(prior, [...prior, added], { '037_browser.sql': 'browser' }),
    ['036_parallel.sql'],
  );
  assert.deepEqual(assertMigrationUpgrade([], [added], { '037_browser.sql': 'browser' }), []);
  for (const after of [
    [],
    prior,
    [added],
    [...prior, { ...added, checksum: 'modified' }],
    [{ ...prior[0], appliedAt: 'rewritten' }, added],
    [...prior, added, added],
    [...prior, added, { name: 'unexpected', checksum: 'x' }],
  ])
    assert.throws(() => assertMigrationUpgrade(prior, after, { '037_browser.sql': 'browser' }));
  assert.throws(() => assertMigrationUpgrade(prior, prior, { '036_parallel.sql': 'conflict' }));
});
