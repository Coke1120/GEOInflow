import { expect, it } from 'vitest';
import { parseAiMaintenanceArgs } from './maintenance-args';
it('defaults to a read-only check and explicit dry-run maintenance', () => {
  expect(parseAiMaintenanceArgs([])).toMatchObject({ operation: 'check', apply: false });
  expect(parseAiMaintenanceArgs(['cleanup'])).toMatchObject({ operation: 'cleanup', apply: false });
  expect(
    parseAiMaintenanceArgs([
      'rotate-key',
      '--apply',
      '--database',
      'isolated',
      '--old-key-file',
      'old.key',
      '--new-key-file',
      'new.key',
    ]),
  ).toMatchObject({
    apply: true,
    database: 'isolated',
    oldKeyFile: 'old.key',
    newKeyFile: 'new.key',
  });
});
it.each(
  [
    ['cleanup', '--aply'],
    ['cleanup', '--apply'],
    ['cleanup', '--database'],
    ['cleanup', '--database', 'a', '--database', 'b'],
    ['check', '--apply', '--database', 'a'],
    ['cleanup', '--new-key-file', 'key'],
    ['rotate-key', '--apply', '--database', 'a', '--old-key-file', '--new-key-file', 'key'],
  ].map(args => ({ args })),
)('rejects unsafe ambiguous flags before any database work', ({ args }) =>
  expect(() => parseAiMaintenanceArgs(args)).toThrow(),
);
