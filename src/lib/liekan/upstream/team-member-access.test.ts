// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  transaction: vi.fn(),
  invalidate: vi.fn(),
  tx: null as any,
  actorRole: 'user',
  teamRole: 'team-manager',
}));
vi.mock('@/lib/prisma', () => ({ default: { transaction: h.transaction } }));
vi.mock('./ai-lifecycle', () => ({ invalidateAiActorRunsInTransaction: h.invalidate }));
import { mutateTeamMember } from './team-member-access';
const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  target = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  team = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost/test');
  h.actorRole = 'user';
  h.teamRole = 'team-manager';
  h.tx = {
    $executeRawUnsafe: vi.fn(),
    $queryRawUnsafe: vi.fn(async sql =>
      sql.includes('FROM "user"')
        ? [
            { user_id: actor, role: h.actorRole },
            { user_id: target, role: 'user' },
          ]
        : [{ team_id: team }],
    ),
    teamUser: {
      findFirst: vi.fn(async ({ where }) => ({
        id: where.userId,
        role: where.userId === actor ? h.teamRole : 'team-member',
      })),
      update: vi.fn().mockResolvedValue({ userId: target }),
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
  };
  h.transaction.mockImplementation(work => work(h.tx));
});
it('rejects an equal-rank grant inside the locked write transaction', async () => {
  await expect(mutateTeamMember(actor, team, target, 'edit', 'team-manager')).rejects.toMatchObject(
    { status: 403 },
  );
  expect(h.tx.teamUser.update).not.toHaveBeenCalled();
});
it('allows a lower grant and invalidates old runs in the same transaction', async () => {
  await mutateTeamMember(actor, team, target, 'edit', 'team-view-only');
  expect(h.invalidate).toHaveBeenCalledWith(h.tx, target, team);
  expect(
    h.tx.$queryRawUnsafe.mock.calls.some(
      ([sql]) => sql.includes('FROM team') && sql.includes('FOR UPDATE'),
    ),
  ).toBe(true);
});
it('rejects a live account downgrade and lost management membership', async () => {
  h.actorRole = 'view-only';
  await expect(
    mutateTeamMember(actor, team, target, 'edit', 'team-view-only'),
  ).rejects.toMatchObject({ status: 403 });
  h.actorRole = 'user';
  h.teamRole = 'team-member';
  await expect(
    mutateTeamMember(actor, team, target, 'edit', 'team-view-only'),
  ).rejects.toMatchObject({ status: 403 });
  expect(h.tx.teamUser.update).not.toHaveBeenCalled();
});
it('preserves owner identity even for platform administrators', async () => {
  h.actorRole = 'admin';
  h.tx.teamUser.findFirst.mockResolvedValue({ role: 'team-owner' });
  await expect(mutateTeamMember(actor, team, target, 'remove')).rejects.toMatchObject({
    status: 400,
  });
  expect(h.tx.teamUser.deleteMany).not.toHaveBeenCalled();
});
it.each(['add', 'edit', 'remove'] as const)(
  'preserves uppercase UUID compatibility for %s',
  async mode => {
    if (mode === 'add')
      h.tx.teamUser.findFirst.mockImplementation(async ({ where }) =>
        where.userId === actor ? { role: 'team-manager' } : null,
      );
    await mutateTeamMember(
      actor.toUpperCase(),
      team.toUpperCase(),
      target.toUpperCase(),
      mode,
      'team-member',
    );
    expect(
      h.tx.teamUser[mode === 'add' ? 'create' : mode === 'edit' ? 'update' : 'deleteMany'],
    ).toHaveBeenCalled();
  },
);
