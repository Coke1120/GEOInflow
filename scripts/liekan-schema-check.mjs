import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export const requiredColumns = {
  website: {
    website_id: 'uuid',
    name: 'character varying',
    domain: 'character varying',
    deleted_at: 'timestamp with time zone',
    user_id: 'uuid',
    team_id: 'uuid',
  },
  user: { user_id: 'uuid', role: 'character varying', deleted_at: 'timestamp with time zone' },
  team: { team_id: 'uuid', deleted_at: 'timestamp with time zone' },
  team_user: { team_id: 'uuid', user_id: 'uuid', role: 'character varying' },
  session: {
    session_id: 'uuid',
    website_id: 'uuid',
    created_at: 'timestamp with time zone',
    country: 'character',
    region: 'character varying',
    city: 'character varying',
    device: 'character varying',
    browser: 'character varying',
    os: 'character varying',
  },
  website_event: {
    event_id: 'uuid',
    website_id: 'uuid',
    session_id: 'uuid',
    visit_id: 'uuid',
    created_at: 'timestamp with time zone',
    event_type: 'integer',
    url_path: 'character varying',
    event_name: 'character varying',
    referrer_domain: 'character varying',
    utm_source: 'character varying',
    utm_medium: 'character varying',
    utm_campaign: 'character varying',
  },
  report: {
    report_id: 'uuid',
    website_id: 'uuid',
    name: 'character varying',
    type: 'character varying',
    parameters: 'jsonb',
    created_at: 'timestamp with time zone',
  },
};
export async function assertUpstreamSchema(client) {
  const columns = await client.$queryRawUnsafe(
    'SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema=$1',
    new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public',
  );
  const mismatches = [];
  for (const [table, fields] of Object.entries(requiredColumns))
    for (const [field, type] of Object.entries(fields)) {
      if (
        !columns.some(
          row => row.table_name === table && row.column_name === field && row.data_type === type,
        )
      )
        mismatches.push(`${table}.${field}: expected ${type}`);
    }
  if (mismatches.length)
    throw new Error(`Upstream storage contract changed: ${mismatches.join('; ')}`);
}
export async function assertUpstreamMigrations(client, options = {}) {
  const schema =
    options.schema || new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('Invalid PostgreSQL schema');
  const directory = options.migrationDirectory || resolve('prisma/migrations');
  const declared =
    options.declaredMigration ||
    JSON.parse(await readFile(resolve('config/liekan/upstream.json'), 'utf8')).upstreamMigration;
  const names = (await readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  if (!names.length || names.at(-1) !== declared)
    throw new Error('Candidate official history differs from the declared final migration');
  const checksums = new Map(
    await Promise.all(
      names.map(async name => [
        name,
        createHash('sha256')
          .update(await readFile(resolve(directory, name, 'migration.sql')))
          .digest('hex'),
      ]),
    ),
  );
  const existence = await client.$queryRawUnsafe(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='${schema}' AND table_name='_prisma_migrations') AS exists`,
  );
  if (!existence[0]?.exists) {
    if (!options.allowPending) throw new Error('Official migration ledger is missing');
    return { declaredMigration: declared, applied: 0, pending: names };
  }
  const rows = await client.$queryRawUnsafe(
    `SELECT migration_name,checksum,finished_at,rolled_back_at FROM "${schema}"."_prisma_migrations" ORDER BY migration_name`,
  );
  const applied = new Set();
  for (const row of rows) {
    if (row.rolled_back_at != null) continue;
    const name = row.migration_name;
    if (!checksums.has(name)) throw new Error(`Official migration missing from candidate: ${name}`);
    if (!row.finished_at) throw new Error(`Official migration is not successful: ${name}`);
    if (applied.has(name)) throw new Error(`Duplicate active official migration: ${name}`);
    if (row.checksum !== checksums.get(name))
      throw new Error(`Official migration checksum changed: ${name}`);
    applied.add(name);
  }
  const pending = names.filter(name => !applied.has(name));
  if (pending.length && !options.allowPending)
    throw new Error(`Official migrations pending: ${pending.join(', ')}`);
  return { declaredMigration: declared, applied: applied.size, pending };
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    await assertUpstreamMigrations(client, {
      allowPending: process.argv.includes('--allow-pending'),
    });
    if (!process.argv.includes('--migrations-only')) await assertUpstreamSchema(client);
    console.log('Upstream storage contract passed.');
  } finally {
    await client.$disconnect();
  }
}
