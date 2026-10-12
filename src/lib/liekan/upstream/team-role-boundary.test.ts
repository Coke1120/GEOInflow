import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ parse: vi.fn(), member: vi.fn(), update: vi.fn() }));
vi.mock('@/lib/request', () => ({ parseRequest: h.parse }));
vi.mock('@/permissions', () => ({ canUpdateTeam: () => true, canDeleteTeamUser: () => true }));
vi.mock('@/queries/prisma', () => ({ getTeamUser: h.member, updateTeamUser: h.update }));
vi.mock('@/lib/liekan/upstream/team-member-access', () => ({
  mutateTeamMember: h.update,
  memberWriteError: vi.fn(),
}));
import { POST } from '@/app/api/teams/[teamId]/users/[userId]/route';
beforeEach(() => {
  vi.clearAllMocks();
  h.parse.mockResolvedValue({
    auth: { user: { id: 'manager', role: 'user' } },
    body: { role: 'team-manager' },
  });
  h.member.mockImplementation(async (_team, user) => ({
    id: user,
    userId: user,
    role: user === 'manager' ? 'team-manager' : 'team-member',
  }));
  h.update.mockResolvedValue({ role: 'team-manager' });
});
it('rejects a manager promoting a lower member to manager before writing', async () => {
  const response = await POST(
    new Request('http://localhost/api/teams/team/users/member', { method: 'POST' }),
    { params: Promise.resolve({ teamId: 'team', userId: 'member' }) },
  );
  expect(response.status).toBe(401);
  expect(h.update).not.toHaveBeenCalled();
});
