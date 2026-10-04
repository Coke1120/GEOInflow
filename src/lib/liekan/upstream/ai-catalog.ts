import { aiTransaction } from './ai-db';
import { aiSpaceCapabilities, authorizeAiSpace, type AiActor } from './ai-access';
export async function getAiAccessCatalog(
  actor: AiActor,
  options: { offset?: number; websiteId?: string } = {},
) {
  const offset = options.offset ?? 0;
  return aiTransaction(async tx => {
    const personal = await authorizeAiSpace(tx, actor, { kind: 'personal', id: actor.id });
    const teams = await tx.query<{ id: string; name: string; role: string }>(
      'SELECT t.team_id AS id,t.name,tu.role FROM team_user tu JOIN team t ON t.team_id=tu.team_id AND t.deleted_at IS NULL WHERE tu.user_id=$1::uuid ORDER BY t.name,t.team_id LIMIT 101 OFFSET $2',
      actor.id,
      offset,
    );
    const spaces = [
      {
        kind: 'personal' as const,
        id: actor.id,
        name: '个人空间',
        canManage: personal.canManage,
        canUse: personal.canUse,
      },
      ...teams.slice(0, 100).map(t => ({
        kind: 'team' as const,
        id: t.id,
        name: t.name,
        ...aiSpaceCapabilities(personal.role, 'team', false, t.role),
      })),
    ];
    type Website = {
      id: string;
      name: string;
      domain: string;
      ownerUserId: string | null;
      teamId: string | null;
    };
    const selectWebsites =
      'SELECT w.website_id AS id,w.name,w.domain,w.user_id AS "ownerUserId",w.team_id AS "teamId" FROM website w LEFT JOIN "user" u ON u.user_id=w.user_id LEFT JOIN team t ON t.team_id=w.team_id WHERE w.deleted_at IS NULL AND ((w.user_id IS NOT NULL)::int+(w.team_id IS NOT NULL)::int)=1 AND ((w.user_id IS NOT NULL AND u.user_id IS NOT NULL AND u.deleted_at IS NULL) OR (w.team_id IS NOT NULL AND t.team_id IS NOT NULL AND t.deleted_at IS NULL)) AND ($2 OR w.user_id=$1::uuid OR EXISTS(SELECT 1 FROM team_user tu WHERE tu.team_id=w.team_id AND tu.user_id=$1::uuid)) ';
    const page = await tx.query<Website>(
      selectWebsites + ' ORDER BY w.name,w.website_id LIMIT 101 OFFSET $3',
      actor.id,
      personal.role === 'admin',
      offset,
    );
    const websites = page.slice(0, 100);
    if (options.websiteId && !websites.some(site => site.id === options.websiteId)) {
      const selected = await tx.query<Website>(
        selectWebsites + ' AND w.website_id=$3::uuid',
        actor.id,
        personal.role === 'admin',
        options.websiteId,
      );
      websites.push(...selected);
    }
    {
      const personalIds = [...new Set(websites.map(site => site.ownerUserId).filter(Boolean))];
      const teamIds = [...new Set(websites.map(site => site.teamId).filter(Boolean))];
      const extra = await tx.query<{
        kind: 'personal' | 'team';
        id: string;
        name: string;
        teamRole: string | null;
      }>(
        'SELECT \'personal\' AS kind,user_id AS id,username AS name,NULL::text AS "teamRole" FROM "user" WHERE user_id=ANY($1::uuid[]) AND deleted_at IS NULL AND ($4 OR user_id=$3::uuid) UNION ALL SELECT \'team\' AS kind,t.team_id AS id,t.name,tu.role AS "teamRole" FROM team t LEFT JOIN team_user tu ON tu.team_id=t.team_id AND tu.user_id=$3::uuid WHERE t.team_id=ANY($2::uuid[]) AND t.deleted_at IS NULL AND ($4 OR tu.user_id IS NOT NULL)',
        personalIds,
        teamIds,
        actor.id,
        personal.role === 'admin',
      );
      for (const space of extra)
        if (!spaces.some(existing => existing.kind === space.kind && existing.id === space.id))
          spaces.push({
            kind: space.kind,
            id: space.id,
            name: space.name,
            ...aiSpaceCapabilities(
              personal.role,
              space.kind,
              space.id === actor.id,
              space.teamRole,
            ),
          });
    }
    return {
      spaces,
      websites: websites.map(w => ({
        ...w,
        space: w.teamId ? { kind: 'team', id: w.teamId } : { kind: 'personal', id: w.ownerUserId },
      })),
      websiteLimit: 100,
      nextOffset: teams.length > 100 || page.length > 100 ? offset + 100 : null,
    };
  });
}
