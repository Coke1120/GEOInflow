// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { aiTransaction } from '../upstream/ai-db';
import { importLogs, saveSettings } from '../store';
import { BOT_RULES } from '../rules/bots';
import { persistCrawlerEvidence } from '../log-ingestion/crawler-evidence';
import { crawlerAnalysis, saveCrawlerCriticalPaths, changeCrawlerFinding } from './analysis';
import { recomputeCrawlerRisks } from './worker';
import { completeHourWindow } from './risks';
import { analyticsCache } from '../upstream/query-cache';
import { GET as analysisGET } from '@/app/api/liekan/websites/[websiteId]/crawler-analysis/route';
const auth = vi.hoisted(() => ({ value: null as any }));
vi.mock('@/lib/auth', () => ({ checkAuth: vi.fn(async () => auth.value) }));
const enabled = process.env.LIEKAN_CRAWLER_TEST === '1';
describe.skipIf(!enabled)(
  'crawler analytics on the isolated PostgreSQL acceptance database',
  () => {
    const owner = randomUUID(),
      other = randomUUID(),
      websiteId = randomUUID(),
      secondSite = randomUUID();
    const actor = { id: owner, role: 'user' },
      window = completeHourWindow(Date.now());
    const range = { startAt: window.endAt - 7 * 86400000, endAt: window.endAt, timezone: 'UTC' };
    const q = <T = any>(sql: string, ...params: unknown[]) =>
      aiTransaction(tx => tx.query<T>(sql, ...params));
    let imported: any;
    beforeAll(async () => {
      const target = new URL(process.env.DATABASE_URL || 'http://invalid');
      if (
        target.hostname !== '127.0.0.1' ||
        target.port !== '15440' ||
        target.pathname !== '/liekan_crawler_acceptance'
      )
        throw new Error('Only the named isolated crawler acceptance database is permitted');
      process.env.APP_SECRET = 'crawler-isolated-test-secret';
      for (const id of [owner, other])
        await q(
          'INSERT INTO "user"(user_id,username,password,role) VALUES($1::uuid,$2,$3,$4)',
          id,
          `test-demo-crawler-${id}`,
          'test-demo-no-login',
          'user',
        );
      await q(
        'INSERT INTO website(website_id,name,domain,user_id) VALUES($1::uuid,$2,$3,$4::uuid),($5::uuid,$2,$3,$6::uuid)',
        websiteId,
        'test-demo-crawler',
        'example.com',
        owner,
        secondSite,
        other,
      );
      await q(
        'INSERT INTO liekan_setting(website_id,is_demo,rules) VALUES($1::uuid,true,$2::jsonb)',
        websiteId,
        JSON.stringify(BOT_RULES),
      );
      for (const path of ['/docs', '/head', '/cached'])
        await q(
          'INSERT INTO liekan_catalog(website_id,path,title,content_type) VALUES($1::uuid,$2,$3,$4)',
          websiteId,
          path,
          'test-demo-crawler',
          '文章',
        );
      const records = [
        { path: '/docs', method: 'GET', status: 200 },
        { path: '/docs', method: 'GET', status: 201 },
        { path: '/head', method: 'HEAD', status: 200 },
        { path: '/cached', method: 'GET', status: 304 },
        { path: '/error', method: 'GET', status: 302 },
        { path: '/error', method: 'GET', status: 403 },
        { path: '/error', method: 'GET', status: 429 },
        { path: '/error', method: 'GET', status: 500 },
        { path: '/error', method: 'GET', status: 101 },
      ];
      imported = await importLogs(websiteId, 'example.com', {
        format: 'json',
        records: records.map((record, index) => ({
          ...record,
          ip: '203.0.113.14',
          userAgent: 'GPTBot',
          bytes: 123,
          time: new Date(window.startAt + index * 1000).toISOString(),
        })),
      });
      const session = randomUUID(),
        visit = randomUUID();
      await q(
        'INSERT INTO session(session_id,website_id) VALUES($1::uuid,$2::uuid)',
        session,
        websiteId,
      );
      await q(
        'INSERT INTO report(report_id,user_id,website_id,type,name,description,parameters) VALUES($1::uuid,$2::uuid,$3::uuid,\'goal\',\'test-demo-crawler-goal\',\'test-demo\',\'{"type":"event","value":"signup"}\')',
        randomUUID(),
        owner,
        websiteId,
      );
      for (let index = 0; index < 3; index++)
        await q(
          'INSERT INTO website_event(event_id,website_id,session_id,visit_id,created_at,url_path,event_type,utm_source,event_name) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9)',
          randomUUID(),
          websiteId,
          session,
          visit,
          new Date(window.startAt + index * 1000),
          '/docs',
          index ? 2 : 1,
          index ? '' : 'chatgpt',
          index ? 'signup' : '',
        );
      await q(
        "INSERT INTO liekan_event_quality(event_id,website_id,classification,source,reasons,rule_version,range_status) SELECT event_id,website_id,'browser','browser','{}','fixture-browser','missing' FROM website_event WHERE website_id=$1::uuid ON CONFLICT DO NOTHING",
        websiteId,
      );
    });
    afterAll(async () => {
      if (!enabled) return;
      for (const site of [websiteId, secondSite]) {
        for (const table of [
          'liekan_crawler_finding_window',
          'liekan_crawler_finding',
          'liekan_crawler_quality',
          'liekan_crawler_catalog_snapshot',
          'liekan_crawler_analysis_state',
          'liekan_crawler_check',
          'liekan_crawler_state',
          'liekan_log_state',
          'liekan_crawler_evidence',
          'liekan_log',
          'liekan_import',
          'liekan_catalog',
          'liekan_setting',
          'website_event',
          'session',
          'report',
        ])
          await q(`DELETE FROM ${table} WHERE website_id=$1::uuid`, site);
        await q('DELETE FROM website WHERE website_id=$1::uuid', site);
      }
      for (const id of [owner, other]) await q('DELETE FROM "user" WHERE user_id=$1::uuid', id);
      await prisma.client.$disconnect();
    });
    it('separates 304, HEAD, successful GET coverage and single-count platform conversions', async () => {
      const report = await crawlerAnalysis(actor, websiteId, range);
      const bot = report.bots.find(row => row.botId === 'gptbot');
      expect(bot).toMatchObject({
        requests: 9,
        status1xx: 1,
        status2xx: 3,
        status3xx: 1,
        status304: 1,
        status4xx: 2,
        status5xx: 1,
        head: 1,
        successfulGets: 2,
        successfulCatalogPages: 1,
        bytes: 1107,
      });
      expect(report.quality.state).toBe('unknown');
      expect(report.platforms.filter(row => row.platformId === 'openai')).toHaveLength(1);
      expect(report.platforms.find(row => row.platformId === 'openai')).toMatchObject({
        visits: 1,
        conversions: 1,
        goalEvents: 2,
        landingPages: [{ path: '/docs', visits: 1, conversions: 1, goalEvents: 2 }],
      });
      expect(report.directory.find(row => row.id === 'google-extended')).toMatchObject({
        kind: 'robots_purpose',
      });
    });
    it('reauthorizes the caller after a cached result waits for delivery', async () => {
      const original = analyticsCache.read.bind(analyticsCache);
      const spy = vi
        .spyOn(analyticsCache, 'read')
        .mockImplementationOnce(async (...args: any[]) => {
          const result = await (original as any)(...args);
          await q(
            'UPDATE website SET user_id=$2::uuid WHERE website_id=$1::uuid',
            websiteId,
            other,
          );
          return result;
        });
      try {
        await expect(crawlerAnalysis(actor, websiteId, range)).rejects.toMatchObject({
          status: 404,
        });
      } finally {
        spy.mockRestore();
        await q('UPDATE website SET user_id=$2::uuid WHERE website_id=$1::uuid', websiteId, owner);
      }
    });
    it('keeps first evidence immutable and cannot backfill another import’s historical classification', async () => {
      const [log] = await q(
        'SELECT id,import_id FROM liekan_log WHERE website_id=$1::uuid LIMIT 1',
        websiteId,
      );
      const before = (
        await q(
          'SELECT * FROM liekan_crawler_evidence WHERE website_id=$1::uuid AND log_id=$2',
          websiteId,
          log.id,
        )
      )[0];
      await (prisma.client as any).$transaction(async (raw: any) => {
        await persistCrawlerEvidence(raw, websiteId, log.import_id, [
          {
            id: log.id,
            classificationVersion: 'b'.repeat(64),
            crawlerId: 'bingbot',
            crawlerEvidence: {
              securityAction: 'block',
              terminatingRuleId: 'c'.repeat(32),
              matchedRuleIds: [],
              cacheStatus: null,
              durationMs: null,
            },
          },
        ]);
      });
      expect(
        (
          await q(
            'SELECT * FROM liekan_crawler_evidence WHERE website_id=$1::uuid AND log_id=$2',
            websiteId,
            log.id,
          )
        )[0],
      ).toEqual(before);
      await q(
        'DELETE FROM liekan_crawler_evidence WHERE website_id=$1::uuid AND log_id=$2',
        websiteId,
        log.id,
      );
      await (prisma.client as any).$transaction(async (raw: any) => {
        await persistCrawlerEvidence(raw, websiteId, randomUUID(), [
          { id: log.id, classificationVersion: 'b'.repeat(64) },
        ]);
      });
      expect(
        await q(
          'SELECT * FROM liekan_crawler_evidence WHERE website_id=$1::uuid AND log_id=$2',
          websiteId,
          log.id,
        ),
      ).toHaveLength(0);
      await (prisma.client as any).$transaction(async (raw: any) => {
        await persistCrawlerEvidence(raw, websiteId, log.import_id, [
          {
            id: log.id,
            classificationVersion: before.classification_version,
            crawlerId: before.crawler_id,
          },
        ]);
      });
    });
    it('authorizes real website ownership and rejects API-key/share/partial sessions at the route', async () => {
      await expect(
        crawlerAnalysis({ id: other, role: 'admin' }, websiteId, range),
      ).rejects.toMatchObject({ status: 404 });
      const request = new Request(
        'http://localhost/api/liekan/websites/' + websiteId + '/crawler-analysis',
      );
      for (const value of [
        { authType: 'api-key', user: { id: owner, role: 'user' } },
        { authType: 'session', shareToken: {}, user: { id: owner, role: 'user' } },
        { authType: 'partial' },
      ]) {
        auth.value = value;
        expect(
          (await analysisGET(request, { params: Promise.resolve({ websiteId }) })).status,
        ).toBe(401);
      }
      auth.value = { authType: 'session', user: { id: owner, role: 'user' } };
      expect((await analysisGET(request, { params: Promise.resolve({ websiteId }) })).status).toBe(
        200,
      );
    });
    it('finds low-volume verified search failures with unknown coverage and deduplicates reruns', async () => {
      await saveCrawlerCriticalPaths(actor, websiteId, ['/important']);
      await importLogs(websiteId, 'example.com', {
        format: 'json',
        records: [0, 1, 2].map(index => ({
          ip: '203.0.113.14',
          userAgent: 'OAI-SearchBot',
          method: 'GET',
          status: 403,
          bytes: 0,
          path: '/important',
          time: new Date(window.startAt + 10000 + index * 1000).toISOString(),
        })),
      });
      await q(
        "UPDATE liekan_log SET verification='verified_range' WHERE website_id=$1::uuid AND path='/important'",
        websiteId,
      );
      expect(
        await q(
          `SELECT e.crawler_id AS "botId",l.verification,count(*)::int AS requests
        FROM liekan_effective_log l LEFT JOIN liekan_crawler_evidence e ON e.website_id=l.website_id AND e.log_id=l.id
        WHERE l.website_id=$1::uuid AND l.path='/important' GROUP BY 1,2`,
          websiteId,
        ),
      ).toEqual([{ botId: 'oai-searchbot', verification: 'verified_range', requests: 3 }]);
      await recomputeCrawlerRisks(websiteId, window.endAt + 15 * 60000);
      const computed = await q(
        `SELECT a.epoch,a.data_revision::text AS revision,a.quality->>'catalogVersion' AS "catalogVersion",r.version AS "currentCatalogVersion"
        FROM liekan_crawler_analysis_state a CROSS JOIN liekan_crawler_registry_current r WHERE a.website_id=$1::uuid AND r.id=1`,
        websiteId,
      );
      expect(computed).toHaveLength(1);
      expect(computed[0].catalogVersion).toBe(computed[0].currentCatalogVersion);
      const report = await crawlerAnalysis(actor, websiteId, range);
      const risk = report.findings.find(
        row => row.botId === 'oai-searchbot' && row.type === 'expected_access',
      );
      expect(risk).toMatchObject({
        grade: 'medium',
        confidence: 'confirmed',
        pathGroup: '/important',
      });
      const windows = await q(
        'SELECT * FROM liekan_crawler_finding_window WHERE website_id=$1::uuid',
        websiteId,
      );
      await changeCrawlerFinding(actor, websiteId, risk.key, true);
      await recomputeCrawlerRisks(websiteId, window.endAt + 15 * 60000);
      expect(
        await q('SELECT * FROM liekan_crawler_finding_window WHERE website_id=$1::uuid', websiteId),
      ).toHaveLength(windows.length);
      expect(
        (
          await q(
            'SELECT state FROM liekan_crawler_finding WHERE website_id=$1::uuid AND key=$2',
            websiteId,
            risk.key,
          )
        )[0].state,
      ).toBe('ignored');
    });
    it('preserves unrecognized custom mappings and excludes its own probes only from new analytics', async () => {
      await saveSettings(websiteId, {
        rules: [{ name: 'GPTBot', vendor: 'Custom', type: '训练', pattern: 'CustomSpider' }],
      });
      await importLogs(websiteId, 'example.com', {
        format: 'json',
        records: [
          {
            ip: '203.0.113.14',
            userAgent: 'CustomSpider',
            method: 'GET',
            status: 200,
            bytes: 0,
            path: '/custom',
            time: new Date(window.startAt + 20000).toISOString(),
          },
          {
            ip: '203.0.113.14',
            userAgent: 'Liekan-Crawler-Check/test GPTBot',
            method: 'GET',
            status: 200,
            bytes: 0,
            path: '/self',
            time: new Date(window.startAt + 21000).toISOString(),
          },
        ],
      });
      const report = await crawlerAnalysis(actor, websiteId, range);
      expect(report.bots.find(row => row.name === 'GPTBot' && row.botId === null)).toMatchObject({
        requests: 1,
      });
      expect(report.pages.some(row => row.path === '/self')).toBe(false);
      expect(
        (
          await q(
            "SELECT count(*)::int AS count FROM liekan_log WHERE website_id=$1::uuid AND path='/self'",
            websiteId,
          )
        )[0].count,
      ).toBe(1);
    });
  },
);
