// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ auth: vi.fn(), transaction: vi.fn(), tx: null as any }));
vi.mock('@/lib/auth', () => ({ checkAuth: h.auth }));
vi.mock('@/lib/prisma', () => ({ default: { transaction: h.transaction } }));
vi.mock('./ai-lifecycle', () => ({ invalidateAiActorRunsInTransaction: vi.fn() }));
import { checkPassword } from '@/lib/password';
import { SHARE_CONTEXT_HEADER, SHARE_TOKEN_HEADER } from '@/lib/constants';
import { createTeamUserAccount, readTeamUserCreation } from './team-users';
const actorId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const teamId = '33333333-3333-4333-8333-333333333333';
const request = new Request('http://localhost/api/liekan/teams/abc/users/create');
const input = { userId, username: ' Example ', password: 'test-pass-1' };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost/test?schema=team_test');
  h.auth.mockResolvedValue({ authType: 'session', user: { id: actorId, role: 'admin' } });
  const user = { id: userId, username: 'example', role: 'user' };
  h.tx = {
    $executeRawUnsafe: vi.fn(),
    $queryRawUnsafe: vi.fn(async (sql: string) =>
      sql.includes('FROM "user"') ? [{ user_id: actorId, role: 'admin' }] : [{ team_id: teamId }],
    ),
    user: {
      findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValue(user),
      create: vi.fn().mockResolvedValue(user),
    },
    teamUser: {
      create: vi.fn(),
      findFirst: vi.fn().mockResolvedValue({
        id: userId,
        userId,
        teamId,
        role: 'team-view-only',
        createdAt: new Date(0),
      }),
      count: vi.fn().mockResolvedValue(21),
    },
  };
  h.transaction.mockImplementation(work => work(h.tx));
});
it.each(['api-key', 'share', undefined])(
  'rejects %s credentials without database writes',
  async authType => {
    h.auth.mockResolvedValue({ authType, user: { id: actorId, role: 'admin' } });
    await expect(createTeamUserAccount(request, teamId, input)).rejects.toMatchObject({
      status: 401,
    });
    expect(h.transaction).not.toHaveBeenCalled();
  },
);
it('rejects nonadministrator sessions and elevated payloads', async () => {
  h.auth.mockResolvedValue({ authType: 'session', user: { id: actorId, role: 'user' } });
  await expect(createTeamUserAccount(request, teamId, input)).rejects.toMatchObject({
    status: 403,
  });
  h.auth.mockResolvedValue({ authType: 'session', user: { id: actorId, role: 'admin' } });
  await expect(
    createTeamUserAccount(request, teamId, { ...input, role: 'admin' }),
  ).rejects.toMatchObject({ status: 400 });
  expect(h.tx.user.create).not.toHaveBeenCalled();
});
it.each([SHARE_CONTEXT_HEADER, SHARE_TOKEN_HEADER])(
  'rejects mixed session and %s headers before authentication queries',
  async header => {
    const mixed = new Request(request.url, { headers: { [header]: 'revoked-share-context' } });
    await expect(createTeamUserAccount(mixed, teamId, input)).rejects.toMatchObject({
      status: 401,
    });
    await expect(readTeamUserCreation(mixed, teamId, { userId })).rejects.toMatchObject({
      status: 401,
    });
    expect(h.auth).not.toHaveBeenCalled();
    expect(h.transaction).not.toHaveBeenCalled();
  },
);
it('hashes the password, forces a regular account and locates page two in the same transaction', async () => {
  const result = await createTeamUserAccount(request, teamId, input);
  expect(result).toMatchObject({
    state: 'created',
    page: 2,
    user: { username: 'example', role: 'user' },
    member: { role: 'team-view-only' },
  });
  const data = h.tx.user.create.mock.calls[0][0].data;
  expect(data.password).not.toBe(input.password);
  expect(checkPassword(input.password, data.password)).toBe(true);
  expect(JSON.stringify(result)).not.toContain(data.password);
  expect(h.tx.$executeRawUnsafe).toHaveBeenCalledWith('SET LOCAL search_path TO "team_test"');
  expect(h.auth.mock.calls[1][1]).toBeTypeOf('function');
});
it('rechecks administrator revocation and missing teams before account insertion', async () => {
  h.tx.$queryRawUnsafe.mockResolvedValue([{ user_id: actorId, role: 'user' }]);
  await expect(createTeamUserAccount(request, teamId, input)).rejects.toMatchObject({
    status: 403,
  });
  expect(h.tx.user.create).not.toHaveBeenCalled();
  h.tx.$queryRawUnsafe.mockImplementation(async sql =>
    sql.includes('FROM "user"') ? [{ user_id: actorId, role: 'admin' }] : [],
  );
  await expect(createTeamUserAccount(request, teamId, input)).rejects.toMatchObject({
    status: 404,
  });
  expect(h.tx.user.create).not.toHaveBeenCalled();
});
it('maps unique conflicts without replacing an existing password or membership', async () => {
  h.tx.user.create.mockRejectedValue({ code: 'P2002' });
  await expect(createTeamUserAccount(request, teamId, input)).rejects.toMatchObject({
    status: 409,
  });
  expect(h.tx.teamUser.create).not.toHaveBeenCalled();
});
it('classifies a username collision in the installed PostgreSQL adapter error shape', async () => {
  h.tx.user.create.mockRejectedValue({
    code: 'P2002',
    meta: { driverAdapterError: { cause: { constraint: { index: 'user_username_key' } } } },
  });
  await expect(createTeamUserAccount(request, teamId, input)).rejects.toMatchObject({
    status: 409,
    code: 'username-conflict',
  });
  expect(h.tx.teamUser.create).not.toHaveBeenCalled();
});
it('reports a membership write failure from the account creation transaction', async () => {
  h.tx.teamUser.create.mockRejectedValue(new Error('membership write failed'));
  await expect(createTeamUserAccount(request, teamId, input)).rejects.toThrow(
    'membership write failed',
  );
  expect(h.transaction).toHaveBeenCalledTimes(1);
});
it('read-only reconciliation preserves unconfirmed outcomes and changed membership', async () => {
  h.tx.user.findFirst.mockReset().mockResolvedValue(null);
  expect(await readTeamUserCreation(request, teamId, { userId })).toEqual({ state: 'unconfirmed' });
  h.tx.user.findFirst.mockResolvedValue({ id: userId, username: 'example', role: 'user' });
  h.tx.teamUser.findFirst.mockResolvedValue(null);
  expect(await readTeamUserCreation(request, teamId, { userId })).toMatchObject({
    state: 'changed',
  });
  h.tx.teamUser.findFirst.mockResolvedValue({ role: 'team-member', createdAt: null });
  expect(await readTeamUserCreation(request, teamId, { userId })).toMatchObject({
    state: 'changed',
  });
  expect(h.tx.user.create).not.toHaveBeenCalled();
  expect(h.tx.teamUser.create).not.toHaveBeenCalled();
});
