// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), export: vi.fn() }));
vi.mock('@/lib/liekan/upstream/history-repair-api', () => ({
  authorizeHistoryRepair: mocks.authorize,
}));
vi.mock('@/lib/liekan/upstream/history-repair', () => ({ exportHistoryRepair: mocks.export }));
vi.mock('@/lib/liekan/http', () => ({
  requestApi: async (_req: Request, work: () => Promise<unknown>) => work(),
}));
import { GET } from './route';
const request = new Request(
  'https://example.com/api/liekan/websites/site/history-repair/export?locale=en-US',
);
const context = { params: Promise.resolve({ websiteId: 'site' }) };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authorize.mockResolvedValue({ websiteId: 'site', identity: { userId: 'owner' } });
  mocks.export.mockResolvedValue({ csv: 'safe csv', filename: 'result.csv' });
});
it('checks permissions again after assembling an export and prevents response caching', async () => {
  const result = await GET(request, context);
  expect(mocks.authorize).toHaveBeenCalledTimes(2);
  expect(result.headers.get('Cache-Control')).toBe('private, no-store');
  expect(result.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(await result.text()).toBe('safe csv');
});
it('does not disclose an assembled file after permission is revoked', async () => {
  mocks.authorize
    .mockResolvedValueOnce({ websiteId: 'site', identity: { userId: 'owner' } })
    .mockRejectedValueOnce(new Error('revoked'));
  await expect(GET(request, context)).rejects.toThrow('revoked');
  expect(mocks.export).toHaveBeenCalledTimes(1);
});
