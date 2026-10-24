import { sqlStatements } from './liekan-sql-statements.mjs';
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { assertUpstreamMigrations, assertUpstreamSchema } from './liekan-schema-check.mjs';

const lockTimeoutSql = "SET LOCAL lock_timeout TO '2s'";

const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
try {
  await assertUpstreamMigrations(client);
  await assertUpstreamSchema(client);
  const schema = new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('Invalid PostgreSQL schema');
  const migrations = (await readdir(resolve('db/liekan/migrations')))
    .filter(file => file.endsWith('.sql'))
    .sort();
  await client.$transaction(
    async tx => {
      await tx.$executeRawUnsafe(lockTimeoutSql);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(12800001)');
      await tx.$executeRawUnsafe(
        'CREATE TABLE IF NOT EXISTS liekan_migration (name text PRIMARY KEY, checksum varchar(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
      );
      for (const name of migrations) {
        const sql = await readFile(resolve('db/liekan/migrations', name), 'utf8');
        const checksum = createHash('sha256').update(sql).digest('hex');
        const applied = await tx.$queryRawUnsafe(
          'SELECT checksum FROM liekan_migration WHERE name=$1',
          name,
        );
        if (applied.length) {
          if (applied[0].checksum !== checksum)
            throw new Error(`Immutable migration checksum changed: ${name}`);
          continue;
        }
        for (const statement of sqlStatements(sql)) {
          await tx.$executeRawUnsafe(lockTimeoutSql);
          await tx.$executeRawUnsafe(statement);
        }
        await tx.$executeRawUnsafe(
          'INSERT INTO liekan_migration (name,checksum) VALUES ($1,$2)',
          name,
          checksum,
        );
        console.log(`Liekan migration applied: ${name}`);
      }
    },
    { timeout: 60000 },
  );
} finally {
  await client.$disconnect();
}
