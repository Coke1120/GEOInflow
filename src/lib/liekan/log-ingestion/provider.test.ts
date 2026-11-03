import { beforeEach, expect, it, vi } from 'vitest';
import { LiekanError } from '../upstream/errors';
const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  query: vi.fn(),
  sources: vi.fn(),
  execute: vi.fn(),
  maintain: vi.fn(),
}));
vi.mock('../upstream/server', async () => ({
  ...(await vi.importActual('../upstream/errors')),
  transaction: mocks.transaction,
  query: mocks.sources,
}));
vi.mock('./cloudflare', () => ({ maintainCloudflare: mocks.maintain }));
import { maintainDueCloudflareSources, maintainProvider } from './provider';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue([{ id: 'source' }]);
  mocks.sources.mockResolvedValue([]);
  mocks.execute.mockResolvedValue(1);
  mocks.maintain.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(fn =>
    fn({ $queryRawUnsafe: mocks.query, $executeRawUnsafe: mocks.execute }),
  );
});
it.each(['provider-not-entitled', 'provider-permission-denied'])(
  'pauses %s without revoking the existing receiver credential',
  async code => {
    mocks.maintain.mockRejectedValue(new LiekanError('Provider unavailable', 403, code));
    await maintainProvider('source', 'configure', 'worker');
    expect(mocks.execute.mock.calls).toContainEqual([
      'UPDATE liekan_log_source SET error_code=$2 WHERE id=$1::uuid',
      'source',
      code,
    ]);
    const sql = mocks.execute.mock.calls.map(call => call[0]).join('\n');
    expect(sql).toContain("state='paused'");
    expect(sql).toContain('ends_at=clock_timestamp()');
    expect(sql).toContain('policy_revision=policy_revision+1');
    expect(sql).not.toContain('credential_hash=NULL');
    expect(sql).toContain('provider_lease=NULL');
  },
);
it('continues revoking credentials for real authorization failures', async () => {
  mocks.maintain.mockRejectedValue(new LiekanError('Expired', 401));
  await maintainProvider('source', 'configure', 'worker');
  expect(mocks.execute.mock.calls.some(call => call[0].includes('credential_hash=NULL'))).toBe(
    true,
  );
  expect(JSON.stringify(mocks.execute.mock.calls)).not.toContain('providerCredentialUnusable');
});
it('records an unusable Cloudflare credential so periodic maintenance stops calling the provider', async () => {
  mocks.maintain.mockRejectedValue(new LiekanError('Expired', 401, 'reauthorization-required'));
  await maintainProvider('source', 'health', 'worker');
  expect(mocks.execute.mock.calls).toContainEqual([
    `UPDATE liekan_log_source SET health=COALESCE(health,'{}'::jsonb) || $2::jsonb WHERE id=$1::uuid`,
    'source',
    JSON.stringify({ providerCredentialUnusable: true }),
  ]);
});
it('leaves a still-usable disconnect in the maintenance pass and skips a rejected credential', async () => {
  mocks.sources.mockResolvedValue([
    {
      id: 'dead',
      state: 'error',
      credential_hash: null,
      error_code: 'reauthorization-required',
      health: { providerCredentialUnusable: true },
    },
    {
      id: 'closing',
      state: 'disconnected',
      credential_hash: null,
      error_code: null,
      health: {},
    },
  ]);
  await maintainDueCloudflareSources('worker');
  expect(mocks.maintain).toHaveBeenCalledTimes(1);
  expect(mocks.maintain).toHaveBeenCalledWith('closing', 'disconnect');
  expect(String(mocks.sources.mock.calls[0][0])).toContain(
    "COALESCE(health->>'providerCredentialUnusable','false')<>'true'",
  );
});
it('stops the maintenance pass when the worker is shutting down', async () => {
  let stop = false;
  mocks.sources.mockResolvedValue([
    { id: 'first', state: 'active', credential_hash: 'hash', health: {} },
    { id: 'second', state: 'active', credential_hash: 'hash', health: {} },
  ]);
  mocks.maintain.mockImplementation(async () => {
    stop = true;
  });
  await maintainDueCloudflareSources('worker', () => stop);
  expect(mocks.maintain).toHaveBeenCalledTimes(1);
  expect(mocks.maintain).toHaveBeenCalledWith('first', 'health');
});
it('keeps transient failures retryable and always releases its lease', async () => {
  mocks.maintain.mockRejectedValue(new LiekanError('Network unavailable', 503));
  await expect(maintainProvider('source', 'configure', 'worker')).rejects.toThrow(
    'Provider temporarily unavailable',
  );
  expect(mocks.execute.mock.calls.some(call => call[0].includes('provider_lease=NULL'))).toBe(true);
  expect(mocks.execute.mock.calls.some(call => call[0].includes('credential_hash=NULL'))).toBe(
    false,
  );
});
