// @vitest-environment node
import { expect, it } from 'vitest';
import { dayDto } from './history-repair-worker';

const row = {
  day: '2026-10-26',
  before_pv: '3',
  after_pv: '2',
  before_uv: '2',
  after_uv: '1',
  before_identity_missing_pv: '80',
  after_identity_missing_pv: '80',
  event_rows: '85',
  log_rows: '0',
  changed_events: '1',
  changed_logs: '0',
  coverage: 'partial',
};
it('retains qualified daily UV consistently with preview and export totals', () => {
  expect(dayDto(row, 'qualified-browser')).toMatchObject({
    beforeUV: '2',
    afterUV: '1',
    beforeQualifiedUV: '2',
    afterQualifiedUV: '1',
    beforeIdentityMissingPV: '80',
    afterIdentityMissingPV: '80',
  });
});
it('preserves archived whole-population missing-input semantics', () => {
  expect(dayDto(row)).toMatchObject({ beforeUV: null, afterUV: null, beforeQualifiedUV: '2' });
});
it('keeps a completely unqualified daily population unavailable', () => {
  expect(dayDto({ ...row, before_uv: '0', after_uv: '0' }, 'qualified-browser')).toMatchObject({
    beforeUV: null,
    afterUV: null,
  });
});
