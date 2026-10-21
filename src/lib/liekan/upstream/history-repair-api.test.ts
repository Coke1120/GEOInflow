// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), authorize: vi.fn() }));
vi.mock('./crawler-maintenance', () => ({ authenticateCrawlerMaintenance: mocks.authenticate }));
vi.mock('./server', () => ({
  authorize: mocks.authorize,
  LiekanError: class extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.status = status;
    }
  },
}));
import { authenticateHistoryRepair, authorizeHistoryRepair } from './history-repair-api';
beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
it('uses full session maintenance authentication before resolving explicit website management', async () => {
  mocks.authenticate.mockResolvedValue({ id: 'actor' });
  mocks.authorize.mockResolvedValue({ website: { id: 'resolved-site' } });
  const request = new Request('https://example.com/api/liekan/history-repair');
  expect(await authorizeHistoryRepair(request, '123')).toEqual({
    websiteId: 'resolved-site',
    identity: { userId: 'actor' },
  });
  expect(mocks.authenticate).toHaveBeenCalledWith(request);
  expect(mocks.authorize).toHaveBeenCalledWith(request, '123', true);
});
it('rejects incomplete or forbidden authentication before reading a website', async () => {
  mocks.authenticate.mockRejectedValue(new Error('session required'));
  await expect(authorizeHistoryRepair(new Request('https://example.com'), 'site')).rejects.toThrow(
    'session required',
  );
  expect(mocks.authorize).not.toHaveBeenCalled();
});
it('fails with an explicit unsupported state for ClickHouse', async () => {
  vi.stubEnv('CLICKHOUSE_URL', 'https://unsupported.invalid');
  await expect(authenticateHistoryRepair(new Request('https://example.com'))).rejects.toMatchObject(
    { status: 501 },
  );
  expect(mocks.authenticate).not.toHaveBeenCalled();
});
