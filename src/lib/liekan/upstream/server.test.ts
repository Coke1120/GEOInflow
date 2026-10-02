import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  website: vi.fn(),
  view: vi.fn(),
  update: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({
  checkAuth: mocks.auth,
  hasPermission: async (role: string, permission: string) =>
    role === 'admin'
      ? permission === 'all'
      : role === 'team-member' && permission === 'website:update',
}));
vi.mock('@/permissions', () => ({ canViewWebsite: mocks.view, canUpdateWebsite: mocks.update }));
vi.mock('@/lib/prisma', () => ({
  default: { client: { website: { findFirst: mocks.website } } },
  getRawQueryClient: vi.fn(),
}));
vi.mock('@/queries/sql', () => ({ getWebsiteStats: vi.fn() }));

import { authorize, lockWritableWebsite } from './server';

const id = '5b4c0de0-6c47-5b51-8f53-11e5e8c79001';
const request = new Request(`http://localhost/api/liekan/websites/${id}/report`);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.website.mockResolvedValue({ id, name: 'Website', domain: 'example.com' });
  mocks.view.mockResolvedValue(true);
  mocks.update.mockResolvedValue(false);
});
describe('Liekan authenticated website boundary', () => {
  it('requires full user authentication and excludes valid share context', async () => {
    mocks.auth.mockResolvedValue(null);
    await expect(authorize(request, id)).rejects.toMatchObject({ status: 401 });
    mocks.auth.mockResolvedValue({ shareToken: { websiteId: id }, authType: 'share' });
    await expect(authorize(request, id)).rejects.toMatchObject({ status: 401 });
    expect(mocks.website).not.toHaveBeenCalled();
  });
  it('rejects deleted or missing sites even for an administrator', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'admin', isAdmin: true } });
    mocks.website.mockResolvedValue(null);
    await expect(authorize(request, id)).rejects.toMatchObject({ status: 404 });
    expect(mocks.view).not.toHaveBeenCalled();
  });
  it('permits read access but denies mutation for a viewer', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'viewer' } });
    await expect(authorize(request, id)).resolves.toMatchObject({ canManage: false });
    await expect(authorize(request, id, true)).rejects.toMatchObject({ status: 403 });
  });
  it('rejects cross-website reads and invalid IDs', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'stranger' } });
    mocks.view.mockResolvedValue(false);
    await expect(authorize(request, id)).rejects.toMatchObject({ status: 403 });
    await expect(authorize(request, "';DROP TABLE website")).rejects.toMatchObject({ status: 400 });
  });
  it('rechecks ownership and live identity while holding the website write lock', async () => {
    const tx = {
      $queryRawUnsafe: vi
        .fn()
        .mockResolvedValueOnce([{ user_id: 'new-owner', team_id: null }])
        .mockResolvedValueOnce([{ role: 'user' }]),
    };
    await expect(lockWritableWebsite(tx, id, { userId: 'old-owner' })).rejects.toMatchObject({
      status: 403,
    });
    tx.$queryRawUnsafe.mockResolvedValueOnce([]);
    await expect(lockWritableWebsite(tx, id, { userId: 'old-owner' })).rejects.toMatchObject({
      status: 404,
    });
    tx.$queryRawUnsafe
      .mockResolvedValueOnce([{ user_id: 'old-owner', team_id: null }])
      .mockResolvedValueOnce([]);
    await expect(lockWritableWebsite(tx, id, { userId: 'old-owner' })).rejects.toMatchObject({
      status: 401,
    });
    tx.$queryRawUnsafe
      .mockResolvedValueOnce([{ user_id: 'owner', team_id: null }])
      .mockResolvedValueOnce([{ role: 'user' }]);
    await expect(lockWritableWebsite(tx, id, { userId: 'owner' })).resolves.toBeUndefined();
  });
  it('rejects a team viewer after an initial authorization while allowing a current member', async () => {
    const tx = { $queryRawUnsafe: vi.fn() };
    for (const role of ['team-view-only', 'team-member']) {
      tx.$queryRawUnsafe
        .mockResolvedValueOnce([{ user_id: null, team_id: 'team' }])
        .mockResolvedValueOnce([{ role: 'user' }])
        .mockResolvedValueOnce([{ role }]);
      const pending = lockWritableWebsite(tx, id, { userId: 'teammate' });
      if (role === 'team-member') await expect(pending).resolves.toBeUndefined();
      else await expect(pending).rejects.toMatchObject({ status: 403 });
    }
  });
});
