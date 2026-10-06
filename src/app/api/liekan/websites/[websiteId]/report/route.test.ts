import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ inside: false, authorize: vi.fn() }));
vi.mock('@/lib/liekan/upstream/server', () => ({
  authorize: mocks.authorize,
  reportSnapshot: async (work: () => Promise<unknown>) => {
    mocks.inside = true;
    try {
      return await work();
    } finally {
      mocks.inside = false;
    }
  },
}));
vi.mock('@/lib/liekan/http', () => ({ api: async (work: () => Promise<unknown>) => work() }));
vi.mock('@/lib/liekan/upstream/cache-context', () => ({
  withoutQueryCache: (work: () => unknown) => work(),
}));
vi.mock('@/lib/liekan/report', () => ({
  buildReport: async () => {
    expect(mocks.inside).toBe(true);
    return { coherent: true };
  },
}));
import { GET } from './route';
it('reads the full report inside one snapshot while the worker can write', async () => {
  mocks.authorize.mockResolvedValue({ website: { id: 'site' }, canManage: false });
  expect(
    await GET(new Request('https://example.com/report'), {
      params: Promise.resolve({ websiteId: 'site' }),
    }),
  ).toEqual({ coherent: true });
});
it('checks permissions before opening a report snapshot', async () => {
  mocks.authorize.mockRejectedValue(new Error('forbidden'));
  await expect(
    GET(new Request('https://example.com/report'), {
      params: Promise.resolve({ websiteId: 'site' }),
    }),
  ).rejects.toThrow('forbidden');
  expect(mocks.inside).toBe(false);
});
