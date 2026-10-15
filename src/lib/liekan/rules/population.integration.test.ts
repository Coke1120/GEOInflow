import { crawlerAnalysis } from '../crawlers/analysis';
import { buildAiFactsContext } from '../upstream/ai-facts';
import { disconnectAiFactsClient } from '../upstream/ai-facts-db';
// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aiTransaction } from '../upstream/ai-db';
import { getLogFacts, getPlotLogs, getMonthlyAiShare, getContentImpact } from '../upstream/logs';
import { getInstallation } from '../installation';
import { buildReport } from '../report';
import { getSettings, importLogs, saveSettings } from '../store';

const enabled = process.env.LIEKAN_CRAWLER_TEST === '1';
describe.skipIf(!enabled)('crawler qualification across real statistics queries', () => {
  beforeAll(() => {
    const url = new URL(process.env.DATABASE_URL || 'http://invalid');
    if (
      url.hostname !== '127.0.0.1' ||
      url.port !== '15440' ||
      url.pathname !== '/liekan_crawler_acceptance'
    )
      throw new Error('Only isolated crawler DB15440 is allowed');
  });
  afterAll(() => disconnectAiFactsClient());
  const q = (sql: string, ...args: unknown[]) => aiTransaction(tx => tx.query(sql, ...args));
  it('conserves counts, separates same-name identities and preserves historical AI qualification', async () => {
    const owner = randomUUID(),
      site = randomUUID(),
      time = Date.now() - 10 * 86400000;
    const start = new Date(time - 3600000),
      end = new Date(time + 3600000);
    const record = (ua: string, index: number, path = '/article') => ({
      time: new Date(time + index * 1000).toISOString(),
      ip: '203.0.113.1',
      path,
      userAgent: ua,
      status: 200,
    });
    try {
      await q(
        "INSERT INTO \"user\"(user_id,username,password,role) VALUES($1::uuid,$2,'test-no-login','user')",
        owner,
        'crawler-population-' + owner,
      );
      await q(
        "INSERT INTO website(website_id,name,domain,user_id) VALUES($1::uuid,'test-crawler-population','example.com',$2::uuid)",
        site,
        owner,
      );
      expect((await getSettings(site)).rules).toHaveLength(53);
      await importLogs(site, 'example.com', {
        format: 'json',
        records: [
          'GPTBot/1.0',
          'OAI-SearchBot/1.0',
          'ChatGPT-User/1.0',
          'Google-InspectionTool/1.0',
          'CCBot/1.0',
          'Googlebot-Image/1.0',
          'Mozilla/5.0',
          'GPTBot/1.0 ClaudeBot/1.0',
          'Google-Extended/1.0',
        ].map((ua, i) => record(ua, i)),
      });
      await saveSettings(site, {
        crawlerRules: {
          mode: 'official',
          overrides: { gptbot: { type: '其他' } },
          customRules: [
            {
              name: 'GPTBot',
              vendor: 'OpenAI',
              type: '训练',
              pattern: 'MyAiBot',
              matchMode: 'token',
            },
            {
              name: 'GPTBot',
              vendor: 'OpenAI',
              type: '其他',
              pattern: 'MyBot',
              matchMode: 'token',
            },
            {
              name: '其他',
              vendor: 'Fixture',
              type: '其他',
              pattern: 'OtherBot',
              matchMode: 'token',
            },
          ],
        },
        expectedRulesRevision: 0,
      });
      await importLogs(site, 'example.com', {
        format: 'json',
        records: [
          record('Google-InspectionTool/1.0', 10, '/legacy'),
          record('GPTBot/1.0', 11),
          record('MyBot/1.0', 12),
          record('OtherBot/1.0', 13),
          record('MyAiBot/1.0', 14),
        ],
      });
      await q(
        "UPDATE liekan_log SET ai_eligible=NULL,recognition_state=NULL WHERE website_id=$1::uuid AND path='/legacy'",
        site,
      );
      await q(
        "DELETE FROM liekan_crawler_evidence WHERE website_id=$1::uuid AND log_id IN(SELECT id FROM liekan_log WHERE website_id=$1::uuid AND path='/legacy')",
        site,
      );
      const facts = await getLogFacts(site, start, end, 'UTC');
      expect(facts.summary).toMatchObject({
        requests: 14,
        ai: 6,
        pages: 2,
        unclassifiedRequests: 3,
        legacyRequests: 1,
        classificationVersions: 3,
      });
      expect(facts.bots.reduce((sum, row) => sum + row.requests, 0)).toBe(11);
      expect(facts.bots.reduce((sum, row) => sum + row.aiRequests, 0)).toBe(6);
      expect(facts.bots.filter(row => row.name === 'GPTBot' && row.type === '其他')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ botId: 'gptbot', requests: 1, aiRequests: 1 }),
          expect.objectContaining({ botId: null, requests: 1, aiRequests: 0 }),
        ]),
      );
      expect(facts.bots.find(row => row.name === '其他')).toMatchObject({
        botId: null,
        requests: 1,
      });
      expect((await getLogFacts(site, start, end, 'UTC', 1, 'ai')).totalLogs).toBe(6);
      expect((await getLogFacts(site, start, end, 'UTC', 1, 'other')).totalLogs).toBe(3);
      expect(
        (await getPlotLogs(site, start, end, 'UTC')).reduce((sum, row) => sum + row.aiRequests, 0),
      ).toBe(6);
      expect(
        (await getMonthlyAiShare(site, end, 'UTC')).reduce((sum, row) => sum + row.ai, 0),
      ).toBe(6);
      expect((await getInstallation(site, true)).logs.ai).toBe(6);
      await q(
        "INSERT INTO liekan_catalog(website_id,path,title,content_type,published_at) VALUES($1::uuid,'/article','Fixture','article',$2)",
        site,
        new Date(time - 1800000),
      );
      expect((await getContentImpact(site, start, end))[0].increment).toBe(5);
      const conversationId = randomUUID(),
        epoch = randomUUID();
      await q(
        'INSERT INTO liekan_ai_website_state(website_id,epoch,owner_user_id) VALUES($1::uuid,$2::uuid,$3::uuid)',
        site,
        epoch,
        owner,
      );
      await q(
        'INSERT INTO liekan_ai_conversation(id,creator_id,owner_user_id,website_id,website_epoch) VALUES($1::uuid,$2::uuid,$2::uuid,$3::uuid,$4::uuid)',
        conversationId,
        owner,
        site,
        epoch,
      );
      const aiFacts = await buildAiFactsContext({
        actor: { id: owner, role: 'user' },
        conversationId,
        input: {
          clientRequestId: randomUUID(),
          expectedConfigVersion: 1,
          question: 'Fixture',
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          timezone: 'UTC',
        },
        signal: new AbortController().signal,
      });
      expect(aiFacts.facts.find(fact => fact.id === 'summary')?.data).toMatchObject({
        logs: { requests: 14, aiRequests: 6 },
      });
      const botFact = aiFacts.facts.find(fact => fact.id === 'bots');
      if (botFact?.id !== 'bots') throw new Error('Missing bot fact');
      expect(
        botFact.data.rows
          .filter(row => row.name === 'GPTBot' && row.class === '训练')
          .map(row => row.botId)
          .sort(),
      ).toEqual(['gptbot', null].sort());
      const analysis = await crawlerAnalysis({ id: owner, role: 'user' }, site, {
        startAt: +start,
        endAt: +end,
        timezone: 'UTC',
      });
      expect(analysis.bots.find(row => row.name === '其他')).toMatchObject({
        requests: 1,
        botId: null,
      });
      expect(analysis.pages.find(row => row.name === '其他')).toMatchObject({
        requests: 1,
        botId: null,
      });
      const report = await buildReport(
        { id: site, name: 'Fixture', domain: 'example.com' },
        true,
        { resource: 'overview', startAt: +start, endAt: +end, timezone: 'UTC' },
        false,
      );
      expect(report.cards.find(card => card.key === '识别 AI 蜘蛛')?.value).toBe(5);
      expect(
        report.charts.a1.series
          .filter(row => row.name === 'GPTBot')
          .map(row => row.values.reduce((sum: number, value) => sum + (value || 0), 0))
          .sort(),
      ).toEqual([1, 2]);
      expect(report.meta.crawlerClassification).toEqual({
        mode: 'mixed',
        versions: 3,
        legacyRequests: 1,
        unclassifiedRequests: 3,
      });
      expect(report.tables.botBody.reduce((sum, row) => sum + Number(row.requests), 0)).toBe(11);
      expect(
        report.tables.botBody
          .filter(row => row.name === 'GPTBot' && row.type === '其他')
          .map(row => row.botId)
          .sort(),
      ).toEqual(['gptbot', null].sort());
    } finally {
      for (const table of [
        'liekan_ai_conversation',
        'liekan_ai_website_state',
        'liekan_log_geography',
        'liekan_crawler_evidence',
        'liekan_log',
        'liekan_import',
        'liekan_catalog',
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
