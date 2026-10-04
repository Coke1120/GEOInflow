import { beforeEach, expect, test, vi } from 'vitest';
const state = vi.hoisted(() => ({
  role: 'admin',
  teamRole: 'team-view-only' as string | null,
  extra: false,
  tx: { query: vi.fn() },
}));
vi.mock('@/lib/auth', () => ({ checkAuth: vi.fn() }));
vi.mock('./ai-db', () => ({ aiTransaction: (fn: any) => fn(state.tx) }));
import { getAiAccessCatalog } from './ai-catalog';
import { authorizeAiSpace } from './ai-access';
const id = '11111111-1111-4111-8111-111111111111',
  team = '22222222-2222-4222-8222-222222222222';
beforeEach(() => {
  state.extra = false;
  state.tx.query.mockImplementation(async sql => {
    if (sql.startsWith('SELECT t.team_id'))
      return state.extra ? [] : [{ id: team, name: 'Team fixture', role: state.teamRole }];
    if (sql.startsWith('SELECT role FROM "user"')) return [{ role: state.role }];
    if (sql.startsWith('SELECT user_id FROM "user"')) return [{ user_id: id }];
    if (sql.startsWith('SELECT team_id FROM team')) return [{ team_id: team }];
    if (sql.startsWith('SELECT role FROM team_user'))
      return state.teamRole ? [{ role: state.teamRole }] : [];
    if (state.extra && sql.startsWith('SELECT w.website_id'))
      return [
        { id, name: 'Site fixture', domain: 'fixture.example', ownerUserId: null, teamId: team },
      ];
    if (state.extra && sql.startsWith("SELECT 'personal'"))
      return [{ kind: 'team', id: team, name: 'Extra team', teamRole: state.teamRole }];
    return [];
  });
});
test.each(
  ['admin', 'user', 'view-only'].flatMap(role =>
    ['team-owner', 'team-manager', 'team-member', 'team-view-only'].map(teamRole => ({
      role,
      teamRole,
    })),
  ),
)('catalog agrees with live authorization for $role / $teamRole', async ({ role, teamRole }) => {
  state.role = role;
  state.teamRole = teamRole;
  const actor = { id, role },
    space = { kind: 'team' as const, id: team };
  const catalog = await getAiAccessCatalog(actor),
    authorized = await authorizeAiSpace(state.tx as any, actor, space);
  expect(catalog.spaces.find(row => row.id === team)).toMatchObject({
    canManage: authorized.canManage,
    canUse: authorized.canUse,
  });
  if (!authorized.canManage)
    await expect(authorizeAiSpace(state.tx as any, actor, space, 'manage')).rejects.toMatchObject({
      status: 403,
    });
});

test.each([{ teamRole: null }, { teamRole: 'team-member' }, { teamRole: 'team-view-only' }])(
  'admin extra spaces agree with live membership $teamRole',
  async ({ teamRole }) => {
    state.role = 'admin';
    state.teamRole = teamRole;
    state.extra = true;
    const actor = { id, role: 'admin' },
      space = { kind: 'team' as const, id: team };
    const catalog = await getAiAccessCatalog(actor),
      access = await authorizeAiSpace(state.tx as any, actor, space);
    expect(catalog.spaces.find(row => row.id === team)).toMatchObject({
      canManage: access.canManage,
      canUse: access.canUse,
    });
  },
);
