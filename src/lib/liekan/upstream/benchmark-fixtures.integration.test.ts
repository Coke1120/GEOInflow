// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  benchmarkBrowserHeaders,
  benchmarkIdentityVersion,
  benchmarkIpHeader,
  refreshBenchmarkPropertyEvidence,
  seedBenchmarkBrowserEvidence,
  updateBenchmarkBrowser,
} from '../../../../scripts/liekan-benchmark-fixtures';
import { resolveClientIp } from '@/lib/ip';
import { readBrowserPopulation } from './browser-population';

it('supplies trusted synthetic ingress only when its isolated server configures that header', () => {
  try {
    vi.stubEnv('CLIENT_IP_HEADER', benchmarkIpHeader);
    vi.stubEnv('CLOUD_MODE', '');
    const headers = new Headers(benchmarkBrowserHeaders);
    expect(resolveClientIp(headers)).toMatchObject({ trusted: true, source: 'trusted_ingress' });
    vi.stubEnv('CLIENT_IP_HEADER', '');
    expect(resolveClientIp(headers).trusted).toBe(false);
  } finally {
    vi.unstubAllEnvs();
  }
});

describe.skipIf(process.env.LIEKAN_BENCHMARK_FIXTURE_TEST !== '1')(
  'benchmark fixtures in a newly created, labelled PostgreSQL container',
  () => {
    const owner = randomUUID(),
      name = `liekan-benchmark-fixture-${owner}`;
    const label = 'io.liekan.benchmark-fixture';
    const docker = (...args: string[]) =>
      execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    let db: pg.Client,
      prisma: typeof import('@/lib/prisma').default,
      created = false;
    beforeAll(async () => {
      const password = randomBytes(24).toString('hex');
      execFileSync(
        'docker',
        [
          'run',
          '-d',
          '--name',
          name,
          '--label',
          `${label}=${owner}`,
          '-p',
          '127.0.0.1::5432',
          '-e',
          'POSTGRES_PASSWORD',
          '-e',
          'POSTGRES_DB=liekan_benchmark_fixture',
          'postgres:15-alpine',
        ],
        {
          env: { ...process.env, POSTGRES_PASSWORD: password },
          stdio: 'pipe',
        },
      );
      created = true;
      for (let attempt = 0; ; attempt++) {
        try {
          docker('exec', name, 'pg_isready', '-U', 'postgres');
          break;
        } catch {
          if (attempt >= 30) throw new Error('Owned benchmark PostgreSQL readiness timed out');
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      }
      const port = docker('port', name, '5432/tcp').split(':').at(-1);
      const connectionString = `postgresql://postgres:${password}@127.0.0.1:${port}/liekan_benchmark_fixture`;
      const env = { ...process.env, DATABASE_URL: connectionString, CLICKHOUSE_URL: '' };
      execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
        env,
        stdio: 'pipe',
        timeout: 120000,
      });
      execFileSync('node', ['scripts/liekan-migrate.mjs'], { env, stdio: 'pipe', timeout: 120000 });
      vi.stubEnv('DATABASE_URL', connectionString);
      vi.stubEnv('DATABASE_REPLICA_URL', '');
      vi.stubEnv('CLICKHOUSE_URL', '');
      ({ default: prisma } = await import('@/lib/prisma'));
      db = new pg.Client({ connectionString });
      await db.connect();
      await db.query('CREATE TEMP TABLE benchmark_sessions(session_id uuid,website_id uuid)');
      await db.query('INSERT INTO "user"(user_id,username,password,role) VALUES($1,$2,$3,$4)', [
        owner,
        `synthetic-${owner}`,
        'synthetic-no-login',
        'user',
      ]);
    }, 180000);
    afterAll(async () => {
      try {
        await db?.end();
      } finally {
        try {
          await prisma?.client.$disconnect();
        } finally {
          vi.unstubAllEnvs();
          if (
            created &&
            docker('inspect', '--format', `{{index .Config.Labels "${label}"}}`, name) === owner
          )
            docker('rm', '-f', '--volumes', name);
        }
      }
    }, 30000);
    async function fixture(registered = true, demo = true) {
      const site = randomUUID(),
        session = randomUUID();
      await db.query('INSERT INTO website(website_id,name,domain,user_id) VALUES($1,$2,$3,$4)', [
        site,
        'Synthetic benchmark fixture',
        'analytics-benchmark.invalid',
        owner,
      ]);
      await db.query('INSERT INTO liekan_setting(website_id,is_demo) VALUES($1,$2)', [site, demo]);
      await db.query(
        "INSERT INTO session(session_id,website_id,browser,os,device) VALUES($1,$2,'chrome','mac','desktop')",
        [session, site],
      );
      if (registered)
        await db.query('INSERT INTO benchmark_sessions VALUES($1,$2)', [session, site]);
      await db.query(
        "INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,url_path,event_type,hostname) SELECT gen_random_uuid(),$1,$2,$2,now()-interval '1 day','/synthetic/fixture',kind,'analytics-benchmark.invalid' FROM (VALUES(1),(1),(2),(5)) kinds(kind)",
        [site, session],
      );
      await db.query(
        "INSERT INTO session_data(session_data_id,website_id,session_id,data_key,string_value,data_type) VALUES(gen_random_uuid(),$1,$2,'plan','synthetic-plan',1)",
        [site, session],
      );
      return { site, session };
    }
    it('keeps synthetic PV, full-window deduplicated UV and sourced properties available', async () => {
      const { site } = await fixture();
      await seedBenchmarkBrowserEvidence(db, [site]);
      const population = await readBrowserPopulation(
        site,
        new Date(Date.now() - 2 * 86400000),
        new Date(),
        'UTC',
        {
          $queryRawUnsafe: async (sql: string, ...params: unknown[]) =>
            (await db.query(sql, params)).rows,
        },
      );
      expect(population.identity).toMatchObject({
        status: 'complete',
        eligiblePV: 2,
        qualifiedPV: 2,
        qualifiedVisitors: 1,
        coverage: 1,
        versions: [benchmarkIdentityVersion],
      });
      expect(
        (
          await db.query(
            'SELECT string_value FROM liekan_effective_session_data WHERE website_id=$1',
            [site],
          )
        ).rows,
      ).toEqual([{ string_value: 'synthetic-plan' }]);
    });
    it.each([
      [false, true],
      [true, false],
    ])(
      'rejects unowned or non-demo sites (%s/%s) before sidecar writes',
      async (registered, demo) => {
        const { site } = await fixture(registered, demo);
        await expect(seedBenchmarkBrowserEvidence(db, [site])).rejects.toThrow(
          'ownership mismatch',
        );
        expect(
          (
            await db.query(
              'SELECT count(*)::int AS count FROM liekan_event_quality WHERE website_id=$1',
              [site],
            )
          ).rows[0].count,
        ).toBe(0);
      },
    );
    it('does not promote historical rows outside its explicit synthetic paths', async () => {
      const { site, session } = await fixture();
      const event = randomUUID();
      await db.query(
        "INSERT INTO website_event(event_id,website_id,session_id,visit_id,event_type,url_path) VALUES($1,$2,$3,$3,1,'/historical-unknown')",
        [event, site, session],
      );
      await seedBenchmarkBrowserEvidence(db, [site]);
      expect(
        (
          await db.query(
            'SELECT count(*)::int AS count FROM liekan_event_environment WHERE event_id=$1',
            [event],
          )
        ).rows[0].count,
      ).toBe(0);
    });
    it('keeps incremental events, event-owned browser dimensions and changed property proof readable', async () => {
      const { site, session } = await fixture();
      await seedBenchmarkBrowserEvidence(db, [site]);
      const event = randomUUID();
      await db.query(
        "INSERT INTO website_event(event_id,website_id,session_id,visit_id,event_type,url_path) VALUES($1,$2,$3,$3,1,'/synthetic/manual-refresh')",
        [event, site, session],
      );
      const count = async () =>
        (
          await db.query(
            'SELECT count(*)::int AS count FROM liekan_geographic_website_event WHERE website_id=$1',
            [site],
          )
        ).rows[0].count;
      expect(await count()).toBe(4);
      await seedBenchmarkBrowserEvidence(db, [site], [event]);
      expect(await count()).toBe(5);
      await updateBenchmarkBrowser(db, site, session, 'synthetic-fresh');
      expect(
        (
          await db.query('SELECT browser FROM liekan_effective_session WHERE session_id=$1', [
            session,
          ])
        ).rows,
      ).toEqual([{ browser: 'synthetic-fresh' }]);
      expect(
        (await db.query('SELECT browser FROM session WHERE session_id=$1', [session])).rows,
      ).toEqual([{ browser: 'chrome' }]);
      await db.query("UPDATE session_data SET string_value='synthetic-new' WHERE website_id=$1", [
        site,
      ]);
      expect(
        (await db.query('SELECT * FROM liekan_effective_session_data WHERE website_id=$1', [site]))
          .rows,
      ).toHaveLength(0);
      await refreshBenchmarkPropertyEvidence(db, [site]);
      expect(
        (
          await db.query(
            'SELECT string_value FROM liekan_effective_session_data WHERE website_id=$1',
            [site],
          )
        ).rows,
      ).toEqual([{ string_value: 'synthetic-new' }]);
    });
  },
);
