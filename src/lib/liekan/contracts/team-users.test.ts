import { expect, it } from 'vitest';
import { canAssignTeamUserRole, matchesTeamUserAttempt, teamUserCreateSchema } from './team-users';
const body = {
  userId: '11111111-1111-4111-8111-111111111111',
  username: '  Alice  ',
  password: 'test-pass-1',
};
it('normalizes the name, preserves the password and defaults to team read only', () => {
  expect(teamUserCreateSchema.parse(body)).toEqual({
    ...body,
    username: 'alice',
    teamRole: 'team-view-only',
  });
});
it.each([
  { username: '   ' },
  { password: 'short' },
  { password: '中'.repeat(25) },
  { password: 'a'.repeat(73) },
  { role: 'admin' },
  { teamRole: 'team-owner' },
])('rejects invalid or elevated account input %j', patch => {
  expect(teamUserCreateSchema.safeParse({ ...body, ...patch }).success).toBe(false);
});
it('accepts the exact multibyte password boundary', () => {
  expect(teamUserCreateSchema.safeParse({ ...body, password: '中'.repeat(24) }).success).toBe(true);
});
it.each(['team-manager', 'team-member', 'team-view-only'])(
  'keeps role assignment hierarchy for %s',
  role => {
    expect(canAssignTeamUserRole(true, '', role)).toBe(true);
    expect(canAssignTeamUserRole(false, 'team-owner', role)).toBe(true);
    expect(canAssignTeamUserRole(false, 'team-manager', role)).toBe(role !== 'team-manager');
    expect(canAssignTeamUserRole(false, 'team-member', role)).toBe(false);
  },
);
it('does not reconcile an account from another team or with changed permissions', () => {
  const attempt = teamUserCreateSchema.parse(body);
  const result: any = {
    state: 'created',
    user: { id: body.userId, username: 'alice', role: 'user' },
    member: { userId: body.userId, teamId: 'team', role: 'team-view-only' },
    page: 1,
  };
  expect(matchesTeamUserAttempt(result, 'team', attempt)).toBe(true);
  expect(matchesTeamUserAttempt(result, 'other', attempt)).toBe(false);
  expect(
    matchesTeamUserAttempt({ ...result, user: { ...result.user, role: 'admin' } }, 'team', attempt),
  ).toBe(false);
});
