import { recomputeCrawlerRisks } from '../crawlers/worker';
import { completeHourWindow } from '../crawlers/risks';
// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { aiTransaction } from '../upstream/ai-db';
import { getSettings, importLogs, saveSettings } from '../store';
import { BOT_RULES, LEGACY_BOT_RULES } from './bots';

const enabled = process.env.LIEKAN_CRAWLER_TEST === '1';
describe.skipIf(!enabled)('crawler configuration on isolated PostgreSQL', () => {
  beforeAll(() => {
    const target = new URL(process.env.DATABASE_URL || 'http://invalid');
    if (
      target.hostname !== '127.0.0.1' ||
      target.port !== '15440' ||
      target.pathname !== '/liekan_crawler_acceptance'
    )
      throw new Error('Only isolated crawler DB15440 is allowed');
  });
  const q = (sql: string, ...args: unknown[]) => aiTransaction(tx => tx.query(sql, ...args));
  it('migrates every historical mode without changing its saved snapshot and rolls back interrupted work', async () => {
    const rollback = new Error('rollback fixture');
    const schema = 'crawler_fixture_' + randomUUID().replaceAll('-', '');
    await expect(
      aiTransaction(async tx => {
        await tx.execute(`CREATE SCHEMA "${schema}"`);
        await tx.execute(`SET LOCAL search_path TO "${schema}"`);
        await tx.execute('CREATE TABLE liekan_setting(website_id uuid PRIMARY KEY,rules jsonb)');
        await tx.execute(
          'CREATE TABLE liekan_log(website_id uuid,source_id uuid,created_at timestamptz)',
        );
        await tx.execute(
          'CREATE TABLE liekan_log_interval(website_id uuid,source_id uuid,starts_at timestamptz,ends_at timestamptz)',
        );
        const cases = [
          null,
          LEGACY_BOT_RULES,
          [],
          LEGACY_BOT_RULES.slice(1),
          [...LEGACY_BOT_RULES].reverse(),
          [{ ...LEGACY_BOT_RULES[0], name: 'Custom' }],
        ];
        const ids = cases.map(() => randomUUID());
        for (let i = 0; i < cases.length; i++)
          await tx.execute(
            'INSERT INTO liekan_setting VALUES($1::uuid,$2::jsonb)',
            ids[i],
            cases[i] === null ? null : JSON.stringify(cases[i]),
          );
        const migration = readFileSync('db/liekan/migrations/021_crawler_recognition.sql', 'utf8');
        for (const statement of migration.split(';').filter(value => value.trim()))
          await tx.execute(statement);
        for (let i = 0; i < cases.length; i++) {
          const [row] = await tx.query(
            'SELECT * FROM liekan_setting WHERE website_id=$1::uuid',
            ids[i],
          );
          expect(row.crawler_rules.mode).toBe(i < 2 ? 'official' : i === 2 ? 'disabled' : 'legacy');
          expect(row.rules_migration_snapshot).toEqual({ rules: cases[i] });
          expect(row.rules_revision).toBe(0);
        }
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(
      await q('SELECT schema_name FROM information_schema.schemata WHERE schema_name=$1', schema),
    ).toEqual([]);
  });
  it('serializes competing edits, preserves imported event identities and archives classification evidence', async () => {
    const owner = randomUUID(),
      site = randomUUID();
    try {
      await q(
        "INSERT INTO \"user\"(user_id,username,password,role) VALUES($1::uuid,$2,'test-no-login','user')",
        owner,
        'crawler-config-' + owner,
      );
      await q(
        "INSERT INTO website(website_id,name,domain,user_id) VALUES($1::uuid,'test-crawler-config','example.com',$2::uuid)",
        site,
        owner,
      );
      expect((await getSettings(site)).rules).toEqual(BOT_RULES);
      await saveSettings(site, { robots: 'User-agent: *\nAllow: /' });
      expect(
        (await q('SELECT rules FROM liekan_setting WHERE website_id=$1::uuid', site))[0].rules,
      ).toBeNull();
      const window = completeHourWindow(Date.now());
      const futureFacts = { botId: 'future-fixture-bot', type: 'access', windowEnd: window.endAt };
      await q(
        "INSERT INTO liekan_crawler_finding(website_id,key,bot_id,type,grade,confidence,facts,window_end) VALUES($1::uuid,'future-fixture','future-fixture-bot','access','high','possible',$2::jsonb,$3)",
        site,
        JSON.stringify(futureFacts),
        new Date(window.endAt),
      );
      await q(
        "INSERT INTO liekan_crawler_finding_window(website_id,key,facts,window_end) VALUES($1::uuid,'future-fixture',$2::jsonb,$3)",
        site,
        JSON.stringify(futureFacts),
        new Date(window.endAt),
      );
      await recomputeCrawlerRisks(site);
      expect(
        (
          await q(
            "SELECT state,facts FROM liekan_crawler_finding WHERE website_id=$1::uuid AND key='future-fixture'",
            site,
          )
        )[0],
      ).toEqual({ state: 'active', facts: futureFacts });
      expect(
        await q(
          "SELECT key FROM liekan_crawler_finding_window WHERE website_id=$1::uuid AND key='future-fixture'",
          site,
        ),
      ).toHaveLength(1);
      const input = {
        format: 'json',
        records: [
          {
            time: new Date().toISOString(),
            ip: '203.0.113.1',
            userAgent: 'GPTBot/1.0',
            path: '/fixture',
            status: 200,
          },
        ],
      };
      await importLogs(site, 'example.com', input);
      const original = await q(
        'SELECT l.id,e.classification_version,l.verification_version,l.ai_eligible FROM liekan_log l LEFT JOIN liekan_crawler_evidence e ON e.website_id=l.website_id AND e.log_id=l.id WHERE l.website_id=$1::uuid',
        site,
      );
      expect(original[0]).toMatchObject({
        ai_eligible: true,
        verification_version: expect.any(String),
        classification_version: expect.any(String),
      });
      const attempts = await Promise.allSettled([
        saveSettings(site, { crawlerRules: { mode: 'disabled' }, expectedRulesRevision: 0 }),
        saveSettings(site, {
          crawlerRules: { mode: 'official', disabledIds: ['gptbot'] },
          expectedRulesRevision: 0,
        }),
      ]);
      expect(attempts.filter(value => value.status === 'fulfilled')).toHaveLength(1);
      expect(attempts.filter(value => value.status === 'rejected')).toHaveLength(1);
      await importLogs(site, 'example.com', input);
      expect(
        await q(
          'SELECT l.id,e.classification_version,l.verification_version,l.ai_eligible FROM liekan_log l LEFT JOIN liekan_crawler_evidence e ON e.website_id=l.website_id AND e.log_id=l.id WHERE l.website_id=$1::uuid',
          site,
        ),
      ).toEqual(original);
      expect(
        (await q('SELECT * FROM liekan_crawler_rule_version WHERE website_id=$1::uuid', site))
          .length,
      ).toBeGreaterThanOrEqual(2);
    } finally {
      for (const table of [
        'liekan_crawler_finding_window',
        'liekan_crawler_finding',
        'liekan_crawler_catalog_snapshot',
        'liekan_crawler_analysis_state',
        'liekan_log_geography',
        'liekan_log',
        'liekan_import',
        'liekan_crawler_rule_version',
        'liekan_log_state',
        'liekan_setting',
      ])
        await q(`DELETE FROM ${table} WHERE website_id=$1::uuid`, site);
      await q('DELETE FROM website WHERE website_id=$1::uuid', site);
      await q('DELETE FROM "user" WHERE user_id=$1::uuid', owner);
    }
  });
});
