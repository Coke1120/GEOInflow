import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  assertUpstreamMigrations,
  assertUpstreamSchema,
  requiredColumns,
} from '../../../scripts/liekan-schema-check.mjs';

describe('upstream storage compatibility', () => {
  const columns = () =>
    Object.entries(requiredColumns).flatMap(([table, fields]) =>
      Object.entries(fields).map(([column, type]) => ({
        table_name: table,
        column_name: column,
        data_type: type,
      })),
    );
  it('accepts the declared baseline and rejects a missing or changed upstream column', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://dummy:dummy@localhost/dummy');
    const client = { $queryRawUnsafe: vi.fn().mockResolvedValue(columns()) };
    await expect(assertUpstreamSchema(client)).resolves.toBeUndefined();
    client.$queryRawUnsafe.mockResolvedValue(
      columns().filter(row => row.column_name !== 'visit_id'),
    );
    await expect(assertUpstreamSchema(client)).rejects.toThrow('website_event.visit_id');
    client.$queryRawUnsafe.mockResolvedValue(
      columns().filter(row => row.table_name !== 'team_user'),
    );
    await expect(assertUpstreamSchema(client)).rejects.toThrow('team_user.role');
    client.$queryRawUnsafe.mockResolvedValue(
      columns().filter(row => !(row.table_name === 'website' && row.column_name === 'user_id')),
    );
    await expect(assertUpstreamSchema(client)).rejects.toThrow('website.user_id');
    client.$queryRawUnsafe.mockResolvedValue(
      columns().filter(row => row.column_name !== 'utm_source'),
    );
    await expect(assertUpstreamSchema(client)).rejects.toThrow('website_event.utm_source');
    client.$queryRawUnsafe.mockResolvedValue(
      columns().map(row =>
        row.column_name === 'visit_id' ? { ...row, data_type: 'integer' } : row,
      ),
    );
    await expect(assertUpstreamSchema(client)).rejects.toThrow('website_event.visit_id');
    vi.unstubAllEnvs();
  });
});

describe('official migration history', () => {
  async function withHistory(run: (setup: any) => Promise<void>) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'liekan-migration-test-'));
    const definitions = { '01_init': 'SELECT 1;\n', '26_add_api_key': 'SELECT 26;\n' };
    for (const [name, sql] of Object.entries(definitions)) {
      fs.mkdirSync(path.join(directory, name));
      fs.writeFileSync(path.join(directory, name, 'migration.sql'), sql);
    }
    const rows = Object.entries(definitions).map(([migration_name, sql]) => ({
      migration_name,
      checksum: createHash('sha256').update(sql).digest('hex'),
      finished_at: '2026-01-01T00:00:00.000Z',
      rolled_back_at: null,
    }));
    const client = {
      $queryRawUnsafe: vi.fn(async (sql: string) =>
        sql.includes('information_schema') ? [{ exists: true }] : rows,
      ),
    };
    const options = {
      migrationDirectory: directory,
      declaredMigration: '26_add_api_key',
      schema: 'public',
    };
    try {
      await run({ directory, rows, client, options });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  it('requires successful applied migrations and their exact published SQL bytes', async () => {
    await withHistory(async ({ rows, client, options, directory }) => {
      await expect(assertUpstreamMigrations(client, options)).resolves.toMatchObject({
        applied: 2,
        pending: [],
      });
      fs.appendFileSync(path.join(directory, '01_init/migration.sql'), '-- changed\n');
      await expect(assertUpstreamMigrations(client, options)).rejects.toThrow(
        'checksum changed: 01_init',
      );
      fs.writeFileSync(path.join(directory, '01_init/migration.sql'), 'SELECT 1;\n');
      rows[0].finished_at = null;
      await expect(assertUpstreamMigrations(client, options)).rejects.toThrow(
        'not successful: 01_init',
      );
      rows[0].finished_at = '2026-01-01';
      rows[0].migration_name = 'deleted_published_migration';
      await expect(assertUpstreamMigrations(client, options)).rejects.toThrow(
        'missing from candidate: deleted_published_migration',
      );
    });
  });

  it('allows pending upgrades only before migration and ignores rolled-back attempts', async () => {
    await withHistory(async ({ rows, client, options }) => {
      const latest = rows.pop();
      rows.push({
        ...latest,
        checksum: 'failed-attempt',
        finished_at: null,
        rolled_back_at: '2026-01-02',
      });
      await expect(
        assertUpstreamMigrations(client, { ...options, allowPending: true }),
      ).resolves.toMatchObject({ applied: 1, pending: ['26_add_api_key'] });
      await expect(assertUpstreamMigrations(client, options)).rejects.toThrow(
        'pending: 26_add_api_key',
      );
      rows.push(latest);
      await expect(assertUpstreamMigrations(client, options)).resolves.toMatchObject({
        applied: 2,
        pending: [],
      });
      rows.push({ ...latest });
      await expect(assertUpstreamMigrations(client, options)).rejects.toThrow(
        'Duplicate active official migration: 26_add_api_key',
      );
    });
  });

  it('permits a new official migration when its declaration advances', async () => {
    await withHistory(async ({ rows, client, options, directory }) => {
      const sql = 'SELECT 27;\n';
      fs.mkdirSync(path.join(directory, '27_official_upgrade'));
      fs.writeFileSync(path.join(directory, '27_official_upgrade/migration.sql'), sql);
      await expect(
        assertUpstreamMigrations(client, { ...options, allowPending: true }),
      ).rejects.toThrow('declared final migration');
      const advanced = { ...options, declaredMigration: '27_official_upgrade' };
      await expect(
        assertUpstreamMigrations(client, { ...advanced, allowPending: true }),
      ).resolves.toMatchObject({ pending: ['27_official_upgrade'] });
      rows.push({
        migration_name: '27_official_upgrade',
        checksum: createHash('sha256').update(sql).digest('hex'),
        finished_at: '2026-01-02',
        rolled_back_at: null,
      });
      await expect(assertUpstreamMigrations(client, advanced)).resolves.toMatchObject({
        applied: 3,
        pending: [],
      });
    });
  });

  it('allows an absent ledger for a fresh preflight and requires it after bootstrap', async () => {
    await withHistory(async ({ client, options }) => {
      client.$queryRawUnsafe.mockResolvedValue([{ exists: false }]);
      await expect(
        assertUpstreamMigrations(client, { ...options, allowPending: true }),
      ).resolves.toMatchObject({ applied: 0, pending: ['01_init', '26_add_api_key'] });
      await expect(assertUpstreamMigrations(client, options)).rejects.toThrow('ledger is missing');
    });
  });
});
