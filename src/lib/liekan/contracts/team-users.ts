import { z } from 'zod';

export const teamUserRoles = ['team-manager', 'team-member', 'team-view-only'] as const;
export const teamUserRoleSchema = z.enum(teamUserRoles);
export const teamUserRoleChoices: [string, string][] = [
  ['team-manager', '团队管理员'],
  ['team-member', '团队成员'],
  ['team-view-only', '团队只读'],
];
export function canAssignTeamUserRole(isAdmin: boolean, actorRole: string, nextRole: string) {
  return (
    teamUserRoles.includes(nextRole as any) &&
    (isAdmin ||
      actorRole === 'team-owner' ||
      (actorRole === 'team-manager' && nextRole !== 'team-manager'))
  );
}
export const teamUserCreateSchema = z
  .object({
    userId: z.uuid().toLowerCase(),
    username: z.string().trim().min(1).max(255).toLowerCase(),
    password: z
      .string()
      .min(8)
      .refine(value => new TextEncoder().encode(value).length <= 72, {
        message: '密码按 UTF-8 编码最多 72 字节，中文及表情会占用多个字节',
      }),
    teamRole: teamUserRoleSchema.default('team-view-only'),
  })
  .strict();
export const teamUserReadQuery = z.object({ userId: z.uuid().toLowerCase() });
const user = z.object({ id: z.uuid(), username: z.string(), role: z.string() });
const member = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  teamId: z.uuid(),
  role: teamUserRoleSchema,
  createdAt: z.string(),
});
export const teamUserResultSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('created'), user, member, page: z.number().int().min(1) }),
  z.object({ state: z.literal('unconfirmed') }),
  z.object({ state: z.literal('changed'), user }),
]);
export type TeamUserCreate = z.infer<typeof teamUserCreateSchema>;
export type TeamUserResult = z.infer<typeof teamUserResultSchema>;
export type TeamUserCreated = Extract<TeamUserResult, { state: 'created' }>;
export function matchesTeamUserAttempt(
  result: TeamUserResult,
  teamId: string,
  attempt: TeamUserCreate,
): result is TeamUserCreated {
  return (
    result.state === 'created' &&
    result.user.id === attempt.userId &&
    result.user.username === attempt.username &&
    result.user.role === 'user' &&
    result.member.userId === attempt.userId &&
    result.member.teamId === teamId &&
    result.member.role === attempt.teamRole
  );
}
