// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  pool: null as Pool | null,
  schema: '',
  beforeLock: null as (() => void) | null,
}));
vi.mock('@/lib/auth', () => ({
  checkAuth: async (request: Request, loadUser?: (id: string) => Promise<any>) => {
    const id = request.headers.get('x-test-user');
    const user = loadUser ? await loadUser(id) : { id, role: 'user' };
    return user ? { authType: 'session', user } : null;
  },
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    transaction: async (work: any) => {
      const client = await h.pool.connect();
      try {
        await client.query('BEGIN');
        const tx = {
          $executeRawUnsafe: async (sql: string, ...params: any[]) =>
            (await client.query(sql, params)).rowCount,
          $queryRawUnsafe: async (sql: string, ...params: any[]) => {
            if (sql.includes('FOR SHARE')) h.beforeLock?.();
            return (await client.query(sql, params)).rows;
          },
          user: {
            findFirst: async ({ where }: any) =>
              (
                await client.query(
                  'SELECT user_id AS id, role FROM "user" WHERE user_id=$1::uuid AND deleted_at IS NULL',
                  [where.id],
                )
              ).rows[0],
          },
        };
        const value = await work(tx);
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  },
}));

import {
  initializeAccountPreferences,
  readAccountPreferences,
  saveAccountPreferences,
} from './account-preferences';

const url = process.env.LIEKAN_ACCOUNT_PREFERENCES_TEST_URL;
const actorId = randomUUID(),
  otherId = randomUUID();
const request = (id = actorId) =>
  new Request('http://localhost/api/liekan/account/preferences', {
    headers: { 'x-test-user': id },
  });
const table = () => `"${h.schema}".liekan_account_preferences`;

describe.skipIf(!url)('account preferences in an owned PostgreSQL schema', () => {
  beforeAll(async () => {
    const connection = new URL(url);
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) ||
      !connection.pathname.endsWith('_test')
    )
      throw new Error('Only a loopback test database is allowed');
    h.pool = new Pool({ connectionString: connection.toString(), max: 12 });
    h.schema = `account_preferences_${randomUUID().replaceAll('-', '')}`;
    connection.searchParams.set('schema', h.schema);
    vi.stubEnv('DATABASE_URL', connection.toString());
    const client = await h.pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${h.schema}"`);
      await client.query(`SET search_path TO "${h.schema}"`);
      await client.query(
        'CREATE TABLE "user"(user_id uuid PRIMARY KEY, role text NOT NULL, deleted_at timestamptz)',
      );
      await client.query(
        await readFile('db/liekan/migrations/055_account_preferences.sql', 'utf8'),
      );
      await client.query("INSERT INTO \"user\"(user_id,role) VALUES($1,'user'),($2,'user')", [
        actorId,
        otherId,
      ]);
    } finally {
      await client.query('RESET search_path');
      client.release();
    }
  });

  beforeEach(async () => {
    h.beforeLock = null;
    await h.pool.query(`TRUNCATE ${table()}`);
    await h.pool.query(`UPDATE "${h.schema}"."user" SET deleted_at=NULL`);
  });

  afterAll(async () => {
    h.beforeLock = null;
    if (h.pool) {
      if (h.schema) await h.pool.query(`DROP SCHEMA "${h.schema}" CASCADE`);
      await h.pool.end();
    }
    vi.unstubAllEnvs();
  });

  it('leaves GET read-only and initializes exactly once across concurrent browsers', async () => {
    expect(await readAccountPreferences(request())).toMatchObject({
      configured: false,
      updatedAt: null,
    });
    expect((await h.pool.query(`SELECT * FROM ${table()}`)).rowCount).toBe(0);
    const choices = [
      { timezone: 'Asia/Calcutta', range: '1month' },
      { timezone: 'Asia/Tokyo', range: '7day' },
    ];
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        initializeAccountPreferences(request(), choices[index % 2]),
      ),
    );
    expect(results.every(result => JSON.stringify(result) === JSON.stringify(results[0]))).toBe(
      true,
    );
    expect(results[0]).toMatchObject({ countryCode: null, configured: false });
    expect(choices).toContainEqual({ timezone: results[0].timezone, range: results[0].range });
    expect((await h.pool.query(`SELECT * FROM ${table()}`)).rowCount).toBe(1);
  });

  it('preserves saved range during a timezone-only update', async () => {
    await saveAccountPreferences(request(), {countryCode:'JP',timezone:'Asia/Tokyo',range:'1month'});
    expect(await saveAccountPreferences(request(), {countryCode:'US',timezone:'America/New_York'})).toMatchObject({range:'1month', timezone:'America/New_York'});
  });

  it('persists explicit confirmation and isolates another user and later initializations', async () => {
    const saved = await saveAccountPreferences(request(), {
      countryCode: 'US',
      timezone: 'US/Eastern',
      range: '30day',
    });
    expect(saved).toMatchObject({
      countryCode: 'US',
      timezone: 'America/New_York',
      range: '30day',
      configured: true,
    });
    expect(
      await initializeAccountPreferences(request(), { timezone: 'Asia/Shanghai', range: '24hour' }),
    ).toEqual(saved);
    expect(await readAccountPreferences(request(otherId))).toMatchObject({
      configured: false,
      timezone: 'Asia/Shanghai',
    });
    await initializeAccountPreferences(request(otherId), {
      timezone: 'Asia/Shanghai',
      range: '24hour',
    });
    expect(await readAccountPreferences(request(otherId))).toMatchObject({
      countryCode: 'CN',
      range: '0day',
      configured: false,
    });
    expect(await readAccountPreferences(request())).toEqual(saved);
  });

  it('rejects a deletion committed while the writer waits for the account lock', async () => {
    const remover = await h.pool.connect();
    let signal: () => void;
    const entered = new Promise<void>(resolve => {
      signal = resolve;
    });
    let pending: Promise<unknown>;
    try {
      await remover.query('BEGIN');
      await remover.query(
        `UPDATE "${h.schema}"."user" SET deleted_at=now() WHERE user_id=$1::uuid`,
        [actorId],
      );
      h.beforeLock = signal;
      pending = saveAccountPreferences(request(), { countryCode: 'JP', timezone: 'Asia/Tokyo' });
      const rejected = expect(pending).rejects.toMatchObject({ status: 401 });
      await entered;
      await remover.query('COMMIT');
      await rejected;
      expect((await h.pool.query(`SELECT * FROM ${table()}`)).rowCount).toBe(0);
    } finally {
      await remover.query('ROLLBACK');
      remover.release();
      h.beforeLock = null;
    }
  });
});
