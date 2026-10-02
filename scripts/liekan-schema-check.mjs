import 'dotenv/config';
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
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    await assertUpstreamSchema(client);
    console.log('Upstream storage contract passed.');
  } finally {
    await client.$disconnect();
  }
}
