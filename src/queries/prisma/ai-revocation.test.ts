// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  transaction: vi.fn(),
  invalidate: vi.fn(),
  userUpdate: vi.fn(),
  memberUpdate: vi.fn(),
  memberDelete: vi.fn(),
}));
vi.mock('@/lib/liekan/upstream/ai-lifecycle', () => ({
  invalidateAiActorRunsInTransaction: h.invalidate,
  clearAiUserInTransaction: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    client: {
      user: { update: h.userUpdate },
      teamUser: { update: h.memberUpdate, deleteMany: h.memberDelete },
    },
    transaction: h.transaction,
  },
}));
vi.mock('@/lib/redis', () => ({ default: {} }));
import { updateUser } from './user';
import { updateTeamUser, deleteTeamUser } from './teamUser';
beforeEach(() => {
  vi.clearAllMocks();
});
it('invalidates existing paid runs in the same transaction as account role changes', async () => {
  const result = { id: 'actor', role: 'view-only' };
  const tx = {
    user: {
      findUnique: vi.fn().mockResolvedValue({ role: 'user' }),
      update: vi.fn().mockResolvedValue(result),
    },
  };
  h.userUpdate.mockResolvedValue(result);
  h.transaction.mockImplementation(fn => fn(tx));
  expect(await updateUser('actor', { role: 'view-only' })).toEqual(result);
  expect(h.invalidate).toHaveBeenCalledWith(tx, 'actor');
});
it('invalidates existing team runs on a membership role change', async () => {
  const result = { id: 'member', userId: 'actor', teamId: 'team', role: 'team-view-only' };
  const tx = {
    teamUser: {
      findUnique: vi.fn().mockResolvedValue({ ...result, role: 'team-member' }),
      update: vi.fn().mockResolvedValue(result),
    },
  };
  h.memberUpdate.mockResolvedValue(result);
  h.transaction.mockImplementation(fn => fn(tx));
  expect(await updateTeamUser('member', { role: 'team-view-only' })).toEqual(result);
  expect(h.invalidate).toHaveBeenCalledWith(tx, 'actor', 'team');
});
it('invalidates existing team runs atomically with member removal', async () => {
  const tx = { teamUser: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) } };
  h.memberDelete.mockResolvedValue({ count: 1 });
  h.transaction.mockImplementation(fn => fn(tx));
  expect(await deleteTeamUser('team', 'actor')).toEqual({ count: 1 });
  expect(h.invalidate).toHaveBeenCalledWith(tx, 'actor', 'team');
});

it('invalidates an explicit repeated role assignment without trusting an old role snapshot', async () => {
  const result = { id: 'actor', role: 'view-only' };
  const tx = {
    user: {
      findUnique: vi.fn().mockResolvedValue({ role: 'view-only' }),
      update: vi.fn().mockResolvedValue(result),
    },
  };
  h.transaction.mockImplementation(fn => fn(tx));
  await updateUser('actor', { role: 'view-only' });
  expect(h.invalidate).toHaveBeenCalledWith(tx, 'actor');
});
it('keeps active runs when an account edit does not supply a role', async () => {
  const tx = { user: { update: vi.fn().mockResolvedValue({ id: 'actor', role: 'user' }) } };
  h.transaction.mockImplementation(fn => fn(tx));
  await updateUser('actor', { username: 'renamed' });
  expect(h.invalidate).not.toHaveBeenCalled();
});
