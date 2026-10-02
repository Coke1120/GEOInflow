import { PrismaPg } from '@prisma/adapter-pg';
import { decryptSecret } from '../checks/two-factor.ts';
import { PrismaClient } from '../generated/prisma/client.js';

// Read-only check in the restored candidate container; secrets never enter diagnostics.
const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
try {
  const secrets = await client.$queryRawUnsafe(
    'SELECT a.secret FROM two_factor_auth a JOIN "user" u USING(user_id) WHERE a.is_enabled AND u.deleted_at IS NULL',
  );
  for (const row of secrets)
    if (!decryptSecret(row.secret)) throw new Error('Invalid restored 2FA record');
  const [roles, teams, definitions] = await Promise.all([
    client.$queryRawUnsafe(
      'SELECT role,count(*)::int AS count FROM "user" WHERE deleted_at IS NULL GROUP BY role',
    ),
    client.$queryRawUnsafe('SELECT role,count(*)::int AS count FROM team_user GROUP BY role'),
    client.$queryRawUnsafe(
      "SELECT type,count(*)::int AS count FROM report WHERE type IN('goal','funnel') GROUP BY type",
    ),
  ]);
  if (
    roles.some(row => !['admin', 'user', 'view-only'].includes(row.role)) ||
    teams.some(
      row => !['team-owner', 'team-manager', 'team-member', 'team-view-only'].includes(row.role),
    )
  )
    throw new Error('Restored roles require compatibility review');
  console.log(
    JSON.stringify({
      passed: true,
      enabledTwoFactorRecords: secrets.length,
      roles,
      teams,
      definitions,
    }),
  );
} catch {
  throw new Error('Restored authentication or role compatibility failed; secrets are withheld');
} finally {
  await client.$disconnect();
}
