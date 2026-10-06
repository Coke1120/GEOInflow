import { beforeEach, describe, expect, test, vi } from 'vitest';
import { deleteTeam } from './team';
import { deleteUser } from './user';

const state = vi.hoisted(() => ({
  tx: undefined as any,
  transaction: vi.fn(),
  bump: vi.fn(),
  invalidate: vi.fn(),
  invalidateTag: vi.fn(),
  redisDelete: vi.fn(),
  clearAiUser: vi.fn(),
  clearAiTeam: vi.fn(),
}));
vi.mock('@/lib/liekan/upstream/ai-lifecycle', () => ({
  clearAiUserInTransaction: state.clearAiUser,
  clearAiTeamInTransaction: state.clearAiTeam,
  invalidateAiActorRunsInTransaction: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  getRawQueryClient: (client: unknown) => client,
  default: {
    client: {
      website: {
        findMany: () => {
          throw new Error('Replica read is forbidden');
        },
      },
    },
    transaction: state.transaction,
  },
}));
vi.mock('@/lib/liekan/upstream/analytics-revision', () => ({ bumpAnalyticsRevision: state.bump }));
vi.mock('@/lib/liekan/upstream/query-cache', () => ({
  invalidateWebsiteAnalytics: state.invalidate,
  analyticsCache: { invalidate: state.invalidateTag },
}));
vi.mock('@/lib/redis', () => ({ default: { enabled: true, client: { del: state.redisDelete } } }));

const userId = '11111111-1111-4111-8111-111111111111',
  teamId = '22222222-2222-4222-8222-222222222222';
const owned = '33333333-3333-4333-8333-333333333333',
  teamWebsite = '44444444-4444-4444-8444-444444444444';
const reportWebsite = '55555555-5555-4555-8555-555555555555',
  linkId = '66666666-6666-4666-8666-666666666666';
const oldLinkId = '77777777-7777-4777-8777-777777777777',
  pixelId = '88888888-8888-4888-8888-888888888888';

function model(name: string) {
  return Object.fromEntries(
    ['deleteMany', 'delete', 'updateMany', 'update'].map(operation => [
      operation,
      vi.fn(async () => `${name}.${operation}`),
    ]),
  ) as any;
}

describe('batch deletion analytics revision transaction', () => {
  beforeEach(() => {
    vi.stubEnv('CLOUD_MODE', '');
    state.bump.mockReset();
    state.invalidate.mockReset();
    state.invalidateTag.mockReset();
    state.redisDelete.mockReset();
    state.clearAiUser.mockReset();
    state.clearAiTeam.mockReset();
    state.tx = Object.fromEntries(
      [
        'website',
        'user',
        'team',
        'teamUser',
        'link',
        'pixel',
        'board',
        'share',
        'report',
        'eventData',
        'sessionData',
        'websiteEvent',
        'session',
      ].map(name => [name, model(name)]),
    );
    state.tx.website.findMany = vi.fn(async ({ where }) =>
      where.userId ? [{ id: owned }] : [{ id: teamWebsite }],
    );
    state.tx.team.findMany = vi.fn(async () => [{ id: teamId }]);
    state.tx.link.findMany = vi.fn(async () => [
      { id: linkId, slug: 'live', deletedAt: null },
      { id: oldLinkId, slug: 'old', deletedAt: new Date(0) },
    ]);
    state.tx.pixel.findMany = vi.fn(async () => [{ id: pixelId, slug: 'pixel', deletedAt: null }]);
    state.tx.board.findMany = vi.fn(async () => [{ id: 'board-id' }]);
    state.tx.report.findMany = vi.fn(async () => [
      { websiteId: reportWebsite },
      { websiteId: owned },
    ]);
    state.transaction.mockReset();
    state.transaction.mockImplementation(async work => {
      const result = await work(state.tx);
      expect(state.invalidate).not.toHaveBeenCalled();
      expect(state.redisDelete).not.toHaveBeenCalled();
      return result;
    });
  });

  test('hard user deletion versions surviving report and team websites with resource tombstones', async () => {
    const result = await deleteUser(userId);
    expect(state.clearAiUser).toHaveBeenCalledWith(state.tx, userId, true);
    expect(state.clearAiUser.mock.invocationCallOrder[0]).toBeLessThan(
      state.tx.user.delete.mock.invocationCallOrder[0],
    );
    expect(state.tx.report.findMany).toHaveBeenCalledWith({
      where: { OR: [{ websiteId: { in: [owned] } }, { userId }] },
      select: { websiteId: true },
    });
    expect(state.bump.mock.calls).toEqual([
      [state.tx, 'website', owned, teamWebsite, reportWebsite],
      [state.tx, 'link', linkId, oldLinkId],
      [state.tx, 'pixel', pixelId],
    ]);
    expect(result).toEqual([
      'eventData.deleteMany',
      'sessionData.deleteMany',
      'websiteEvent.deleteMany',
      'session.deleteMany',
      'teamUser.deleteMany',
      'team.deleteMany',
      'report.deleteMany',
      'share.deleteMany',
      'link.deleteMany',
      'pixel.deleteMany',
      'board.deleteMany',
      'website.deleteMany',
      'user.delete',
    ]);
    expect(state.invalidate).toHaveBeenCalledWith(
      owned,
      teamWebsite,
      reportWebsite,
      linkId,
      oldLinkId,
      pixelId,
    );
    expect(state.redisDelete.mock.calls).toEqual([['link:live'], ['pixel:pixel']]);
  });

  test('soft user deletion keeps result ordering and only restamps live resources', async () => {
    vi.stubEnv('CLOUD_MODE', '1');
    const result = await deleteUser(userId);
    expect(state.clearAiUser).toHaveBeenCalledWith(state.tx, userId, false);
    expect(result).toEqual([
      'website.updateMany',
      'user.update',
      'share.deleteMany',
      'link.updateMany',
      'pixel.updateMany',
      'board.deleteMany',
    ]);
    expect(state.tx.link.updateMany).toHaveBeenCalledWith({
      where: { userId, deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
    expect(state.tx.report.findMany).not.toHaveBeenCalled();
    expect(state.tx.report.deleteMany).not.toHaveBeenCalled();
    expect(state.bump).toHaveBeenCalledWith(state.tx, 'website', owned);
    expect(state.bump).toHaveBeenCalledWith(state.tx, 'link', linkId, oldLinkId);
  });

  test.each(['', '1'])(
    'team deletion leaves revisions for websites and soft/hard resource deletion (cloud=%s)',
    async cloud => {
      vi.stubEnv('CLOUD_MODE', cloud);
      const result = await deleteTeam(teamId);
      expect(state.clearAiTeam).toHaveBeenCalledWith(state.tx, teamId);
      expect(state.clearAiTeam.mock.invocationCallOrder[0]).toBeLessThan(
        state.bump.mock.invocationCallOrder[0],
      );
      expect(result).toEqual(
        cloud
          ? [
              'team.update',
              'share.deleteMany',
              'link.updateMany',
              'pixel.updateMany',
              'board.deleteMany',
            ]
          : [
              'teamUser.deleteMany',
              'share.deleteMany',
              'link.deleteMany',
              'pixel.deleteMany',
              'board.deleteMany',
              'team.delete',
            ],
      );
      expect(state.bump.mock.calls).toEqual([
        [state.tx, 'website', teamWebsite],
        [state.tx, 'link', linkId, oldLinkId],
        [state.tx, 'pixel', pixelId],
      ]);
      expect(state.redisDelete.mock.calls).toEqual([['link:live'], ['pixel:pixel']]);
    },
  );

  test('revision failure aborts the transaction before cache or slug side effects', async () => {
    state.bump.mockRejectedValueOnce(new Error('revision write failed'));
    await expect(deleteUser(userId)).rejects.toThrow('revision write failed');
    expect(state.invalidate).not.toHaveBeenCalled();
    expect(state.redisDelete).not.toHaveBeenCalled();
  });
  test('AI lifecycle failure aborts the transaction before resource deletion and revision changes', async () => {
    state.clearAiUser.mockRejectedValueOnce(new Error('AI cleanup failed'));
    await expect(deleteUser(userId)).rejects.toThrow('AI cleanup failed');
    expect(state.tx.user.delete).not.toHaveBeenCalled();
    expect(state.bump).not.toHaveBeenCalled();
    expect(state.invalidate).not.toHaveBeenCalled();
    expect(state.redisDelete).not.toHaveBeenCalled();
  });
});
