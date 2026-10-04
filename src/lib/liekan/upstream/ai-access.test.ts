import { beforeEach, expect, it, vi } from 'vitest';
const boundary = vi.hoisted(() => ({ checkAuth: vi.fn() }));
vi.mock('@/lib/auth', () => boundary);
import { authenticateAiRequest, authorizeAiSpace } from './ai-access';
beforeEach(() => boundary.checkAuth.mockReset());
it.each(['api-key', 'share', undefined])(
  'rejects %s identity before access to AI data',
  async authType => {
    boundary.checkAuth.mockResolvedValue({
      authType,
      user: { id: '11111111-1111-4111-8111-111111111111', role: 'admin' },
    });
    await expect(
      authenticateAiRequest(new Request('http://localhost/api/liekan/ai/catalog')),
    ).rejects.toMatchObject({ status: 401 });
  },
);
it('accepts a full session and keeps only necessary actor identity', async () => {
  boundary.checkAuth.mockResolvedValue({
    authType: 'session',
    user: { id: '11111111-1111-4111-8111-111111111111', role: 'user' },
    token: 'private',
  });
  await expect(
    authenticateAiRequest(new Request('http://localhost/api/liekan/ai/catalog')),
  ).resolves.toEqual({ id: '11111111-1111-4111-8111-111111111111', role: 'user' });
});

it('accepts canonical-equivalent personal UUIDs without changing ownership', async () => {
  const id = 'abcdefab-1111-4111-8111-111111111111';
  const tx = {
    query: vi
      .fn()
      .mockResolvedValueOnce([{ role: 'user' }])
      .mockResolvedValueOnce([{ user_id: id }]),
  };
  await expect(
    authorizeAiSpace(
      tx as any,
      { id, role: 'user' },
      { kind: 'personal', id: id.toUpperCase() },
      'manage',
    ),
  ).resolves.toMatchObject({ canManage: true });
});
