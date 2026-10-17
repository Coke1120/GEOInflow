// @vitest-environment node
import { randomUUID, createHash, webcrypto } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { aiTransaction } from '../upstream/ai-db';
import { importLogs } from '../store';
import {
  queryEvidence,
  readCrawlerEvidence,
  readReconciliation,
  pathMappings,
} from './evidence-read';
import { crawlerAnalysis, changeCrawlerFinding } from './analysis';
import { getLogFacts } from '../upstream/logs';
import { readPerformance } from './performance-read';
import { readOutcomes } from './outcomes-read';
import { readReportEvidence, reportEvidenceCsv } from './report-evidence';
import { readObservations } from './observation-read';
import {
  changeFindingWorkflow,
  findingWorkflow,
  addCrawlerContext,
  voidCrawlerContext,
} from './workflow';
import {
  withCollectionWrite,
  collectionWriteClient,
  recordEventQuality,
} from '../upstream/collection-write';
import { observeCollection } from '../upstream/collection-observation';
import { reconcileFindingWorkflow } from './workflow-lifecycle';
import { cancellableEvidence } from '../upstream/query-cancellation';
import { pruneTrafficObservations } from '../upstream/observation-retention';
import { exportEvidence } from './evidence-export';
import { invalidateCrawlerWorkflowForRollback } from '../upstream/workflow-retention';
import { BOT_RULES } from '../rules/bots';
import { buildReport } from '../report';
import { readPageReport } from '../upstream/page-report';
import { reportEvidenceViewPayload } from '../contracts/report-evidence-view';
const authentication = vi.hoisted(() => ({
  value: null as any,
  before: null as null | (() => Promise<void>),
}));
vi.mock('@/lib/auth', () => ({
  checkAuth: vi.fn(async () => {
    await authentication.before?.();
    return authentication.value;
  }),
}));
const enabled = process.env.LIEKAN_CRAWLER_TEST === '1';
describe.skipIf(!enabled)('traffic evidence PostgreSQL contracts', () => {
  const site = randomUUID(),
    owner = randomUUID(),
    actor = { id: owner, role: 'user' };
  const endAt = Math.floor(Date.now() / 3600000) * 3600000,
    startAt = endAt - 86400000;
  const p = {
    startAt,
    endAt,
    timezone: 'UTC',
    population: 'recognized_crawlers' as const,
    dimension: 'bot' as const,
    view: 'matrix' as const,
    page: 1,
    sort: 'requests' as const,
    direction: 'desc' as const,
    crawlerIdentityScope: 'all' as const,
    crawlerMetricsVersion: 1 as const,
  };
  const q = (sql: string, ...args: unknown[]) => aiTransaction(tx => tx.query(sql, ...args));
  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL);
    if (
      target.hostname !== '127.0.0.1' ||
      target.port !== '15440' ||
      target.pathname !== '/liekan_crawler_acceptance'
    )
      throw new Error('Isolated acceptance database required');
    await q(
      'INSERT INTO "user"(user_id,username,password,role) VALUES($1::uuid,$2,$3,$4)',
      owner,
      `test-demo-evidence-${owner}`,
      'test-no-login',
      'user',
    );
    await q(
      'INSERT INTO website(website_id,name,domain,user_id) VALUES($1::uuid,$2,$3,$4::uuid)',
      site,
      'test-demo-evidence',
      'example.com',
      owner,
    );
    await q(
      'INSERT INTO liekan_setting(website_id,is_demo,rules) VALUES($1::uuid,true,$2::jsonb)',
      site,
      JSON.stringify(BOT_RULES),
    );
    await q(
      'INSERT INTO liekan_catalog(website_id,path,title,content_type) VALUES($1::uuid,$2,$3,$4)',
      site,
      '/article',
      'test-demo',
      'article',
    );
    const statuses = [101, 200, 204, 205, 206, 302, 304, 401, 403, 429, 451, 404, 500];
    await importLogs(site, 'example.com', {
      format: 'json',
      records: statuses.map((status, index) => ({
        time: new Date(startAt + index * 1000).toISOString(),
        ip: '192.0.2.9',
        userAgent: 'GPTBot/1.0',
        path: '/article',
        method: index === 1 ? 'HEAD' : 'GET',
        status,
        ...(index === 0 ? {} : { bytes: 0 }),
      })),
    });
    await q(
      "UPDATE liekan_log SET verification=CASE WHEN status IN(200,204,205,206) THEN 'verified_range' WHEN status IN(403,429) THEN 'range_mismatch' ELSE 'unverified' END WHERE website_id=$1::uuid",
      site,
    );
  });
  afterAll(async () => {
    for (const table of [
      'liekan_crawler_finding_action',
      'liekan_crawler_context',
      'liekan_crawler_finding',
      'liekan_crawler_rule_version',
      'liekan_crawler_evidence',
      'liekan_log',
      'liekan_import',
      'liekan_catalog',
      'liekan_setting',
      'liekan_log_state',
    ])
      await q(`DELETE FROM ${table} WHERE website_id=$1::uuid`, site);
    await q('DELETE FROM website WHERE website_id=$1::uuid', site);
    await q('DELETE FROM "user" WHERE user_id=$1::uuid', owner);
    await prisma.client.$disconnect();
  });
  it('A-01/A-03 counts disjoint matrix cells and preserves GET edge semantics', async () => {
    const all = await queryEvidence(actor, site, p, 'evidence', readCrawlerEvidence, true);
    expect(all.rows.reduce((n, row) => n + row.requests, 0)).toBe(13);
    expect(all.totals).toMatchObject({
      requests: 13,
      get2xx: 3,
      getNoBody: 2,
      getPartial: 1,
      head: 1,
      status401: 1,
      status403: 1,
      status429: 1,
      status451: 1,
    });
    const verified = await queryEvidence(
      actor,
      site,
      { ...p, crawlerIdentityScope: 'verified_range' },
      'evidence',
      readCrawlerEvidence,
      true,
    );
    expect(verified.totals.requests).toBe(4);
    expect(verified.rows.reduce((n, row) => n + row.requests, 0)).toBe(4);
    expect(verified.outsideScope.reduce((n, row) => n + row.requests, 0)).toBe(9);
    expect(verified.coverage.value).toBe(1);
  });
  it('A-01 proves the approved 100/40 population across cards, trends, ranks, paths and exports', async () => {
    const website = randomUUID();
    await q(
      "INSERT INTO website(website_id,name,domain,user_id) VALUES($1::uuid,'test-demo-100-40','example.com',$2::uuid)",
      website,
      owner,
    );
    try {
      await q(
        'INSERT INTO liekan_setting(website_id,is_demo,rules) VALUES($1::uuid,true,$2::jsonb)',
        website,
        JSON.stringify(BOT_RULES),
      );
      await q(
        "INSERT INTO liekan_catalog(website_id,path,title,content_type) SELECT $1::uuid,'/scope-'||n,'test scope','article' FROM generate_series(0,9) n",
        website,
      );
      await importLogs(website, 'example.com', {
        format: 'json',
        records: Array.from({ length: 100 }, (_, n) => ({
          time: new Date(startAt + n * 1000).toISOString(),
          ip: '192.0.2.9',
          userAgent: 'GPTBot/1.0',
          path: '/scope-' + Math.floor(n / 10),
          method: 'GET',
          status: 200,
        })),
      });
      await q(
        "UPDATE liekan_log SET verification=CASE WHEN created_at<$2::timestamptz THEN 'verified_range' ELSE 'unverified' END WHERE website_id=$1::uuid",
        website,
        new Date(startAt + 40000),
      );
      for (const [scope, count, paths] of [
        ['all', 100, 10],
        ['verified_range', 40, 4],
      ] as const) {
        const options = { ...p, crawlerIdentityScope: scope };
        const facts = await getLogFacts(
          website,
          new Date(startAt),
          new Date(endAt),
          'UTC',
          1,
          '',
          '',
          '',
          'after',
          undefined,
          options,
        );
        expect(facts.summary.requests).toBe(count);
        expect(facts.daily.reduce((sum, row) => sum + row.count, 0)).toBe(count);
        expect(facts.bots.reduce((sum, row) => sum + row.requests, 0)).toBe(count);
        expect(facts.pages).toHaveLength(paths);
        expect(facts.previousBots).toEqual([]);
        expect(facts.totalLogs).toBe(count);
        expect(facts.recent).toHaveLength(count);
        const report = await buildReport(
          { id: website, name: 'test-demo-100-40', domain: 'example.com' },
          false,
          {
            startAt,
            endAt,
            timezone: 'UTC',
            resource: 'ai/overview',
            crawlerIdentityScope: scope,
            crawlerMetricsVersion: 1,
          },
          true,
        );
        expect(report.cards.find(row => row.label === 'AI 蜘蛛请求（30天）')?.value).toBe(count);
        expect(report.cards.find(row => row.label === 'AI 抓取页面覆盖率')?.value).toBe(count);
        expect(
          report.charts.a1.series
            .flatMap(row => row.values)
            .reduce((sum: number, n: number) => sum + n, 0),
        ).toBe(count);
        const exported = await queryEvidence(
          actor,
          website,
          { ...options, view: 'summary', reportResource: 'ai/bots' },
          'report-evidence',
          readReportEvidence,
          true,
        );
        expect(exported.rows.reduce((sum, row) => sum + row.requests, 0)).toBe(count);
      }
      const websiteInfo = { id: website, name: 'test-demo-100-40', domain: 'example.com' };
      const pageQuery = {
        startAt,
        endAt,
        timezone: 'UTC',
        resource: 'logs',
        crawlerMetricsVersion: 1,
        crawlerIdentityScope: 'all',
      };
      const page = (await readPageReport(websiteInfo, pageQuery, true)).value;
      const display = { filter: '全部', sort: { label: '', direction: 1 }, search: '' };
      const payload = reportEvidenceViewPayload(page, display);
      const browserHash = Buffer.from(
        await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(payload)),
      ).toString('hex');
      expect(browserHash).toBe(createHash('sha256').update(payload).digest('hex'));
      const exportBody = {
        kind: 'evidence',
        locale: 'en-US',
        query: { ...p, population: 'all_logs', reportResource: 'logs', reportDisplay: display },
        viewReportQuery: page.meta.crawlerEvidenceView.query,
        viewSnapshot: browserHash,
        policySnapshot: page.meta.crawlerEvidenceView.policySnapshot,
      };
      authentication.value = { authType: 'session', user: { id: owner, role: 'user' } };
      const request = () => new Request('https://example.com/api/liekan/test', { method: 'POST' });
      expect(
        (await exportEvidence(actor, website, exportBody, request(), ['evidence'])).headers.get(
          'X-Liekan-Export-Changed',
        ),
      ).toBe('false');
      await importLogs(website, 'example.com', {
        format: 'json',
        records: [
          {
            time: new Date(startAt + 200000).toISOString(),
            ip: '192.0.2.9',
            userAgent: 'GPTBot/1.0',
            path: '/scope-0',
            method: 'GET',
            status: 200,
          },
        ],
      });
      const late = await exportEvidence(actor, website, exportBody, request(), ['evidence']);
      expect(late.headers.get('X-Liekan-Export-Changed')).toBe('true');
      expect(late.headers.get('X-Liekan-Export-Read-At')).toBeTruthy();
      expect((await late.text()).split('\r\n')).toHaveLength(103);
      const first = (await readPageReport(websiteInfo, pageQuery, true)).value;
      const second = (
        await readPageReport(
          websiteInfo,
          { ...pageQuery, page: 2, cursor: first.meta.nextCursor, seek: 'after' },
          true,
        )
      ).value;
      expect(second.tables.logBody).toHaveLength(1);
      const secondBody = {
        ...exportBody,
        viewReportQuery: second.meta.crawlerEvidenceView.query,
        viewSnapshot: createHash('sha256')
          .update(reportEvidenceViewPayload(second, display))
          .digest('hex'),
      };
      await q(
        "UPDATE liekan_crawler_evidence SET classification_version='test-late-version' WHERE website_id=$1::uuid",
        website,
      );
      expect(
        (await exportEvidence(actor, website, secondBody, request(), ['evidence'])).status,
      ).toBe(200);
      // Writes continue while final authorization is pending; the completed CSV keeps its RR snapshot.
      let writes = 0;
      const pending: Promise<unknown>[] = [];
      const timer = setInterval(
        () =>
          pending.push(
            importLogs(website, 'example.com', {
              format: 'json',
              records: [
                {
                  time: new Date(startAt + 300000 + writes++ * 1000).toISOString(),
                  ip: '192.0.2.9',
                  userAgent: 'GPTBot/1.0',
                  path: '/scope-0',
                  method: 'GET',
                  status: 200,
                },
              ],
            }),
          ),
        1000,
      );
      authentication.before = async () => {
        await new Promise(resolve => setTimeout(resolve, 2300));
      };
      try {
        const concurrent = await exportEvidence(actor, website, exportBody, request(), [
          'evidence',
        ]);
        expect((await concurrent.text()).split('\r\n')).toHaveLength(103);
        expect(writes).toBeGreaterThanOrEqual(2);
      } finally {
        clearInterval(timer);
        authentication.before = null;
        await Promise.all(pending);
      }
    } finally {
      await q('DELETE FROM liekan_log WHERE website_id=$1::uuid', website);
      await q('DELETE FROM website WHERE website_id=$1::uuid', website);
    }
  });
  it('A-01/A-07 preserves original main-table columns in full snapshot exports', async () => {
    const bots = await queryEvidence(
      actor,
      site,
      { ...p, view: 'summary' as const, reportResource: 'ai/bots' },
      'report-evidence',
      readReportEvidence,
      true,
    );
    expect(bots.rows[0]).toHaveProperty('vendor');
    expect(bots.rows[0]).toHaveProperty('dailyAverage');
    expect(bots.rows[0]).toHaveProperty('preference');
    expect(bots.rows[0]).toHaveProperty('trend');
    const pages = await queryEvidence(
      actor,
      site,
      { ...p, view: 'summary' as const, reportResource: 'ai/pages' },
      'report-evidence',
      readReportEvidence,
      true,
    );
    expect(pages.rows[0]).toMatchObject({ path: '/article', requests: 13, bots: 1 });
    expect(pages.rows[0]).toHaveProperty('heat');
    expect(pages.rows[0]).toHaveProperty('freshness');
    expect(reportEvidenceCsv(pages, 'zh-CN')).toContain('主力蜘蛛');
    const logs = await queryEvidence(
      actor,
      site,
      { ...p, population: 'all_logs' as const, view: 'requests' as const, reportResource: 'logs' },
      'report-evidence',
      readReportEvidence,
      true,
    );
    expect(logs.rows).toHaveLength(13);
    expect(reportEvidenceCsv(logs, 'en-US')).toContain('User-Agent');
    const preview = await queryEvidence(
      actor,
      site,
      { ...p, view: 'summary' as const, reportResource: 'ai/bots' },
      'report-evidence',
      readReportEvidence,
    );
    expect(preview.meta.snapshot).toBe(bots.meta.snapshot);
  });
  it('A-08 exposes ambiguous requests independently of the recognized matrix', async () => {
    await q(
      "UPDATE liekan_log SET recognition_state='ambiguous' WHERE website_id=$1::uuid AND status=101",
      site,
    );
    await q(
      'UPDATE liekan_crawler_evidence e SET crawler_id=NULL FROM liekan_log l WHERE e.website_id=$1::uuid AND l.website_id=e.website_id AND l.id=e.log_id AND l.status=101',
      site,
    );
    try {
      const result = await queryEvidence(
        actor,
        site,
        { ...p, botId: 'gptbot' },
        'evidence',
        readCrawlerEvidence,
        true,
      );
      expect(result.totals.requests).toBe(12);
      expect(result.ambiguousRequests).toBe(1);
      const details = await queryEvidence(
        actor,
        site,
        { ...p, population: 'all_logs', view: 'requests', recognitionGroup: 'ambiguous' },
        'evidence',
        readCrawlerEvidence,
        true,
      );
      expect(details.rows).toHaveLength(1);
    } finally {
      await q(
        "UPDATE liekan_crawler_evidence e SET crawler_id='gptbot' FROM liekan_log l WHERE e.website_id=$1::uuid AND l.website_id=e.website_id AND l.id=e.log_id AND l.status=101",
        site,
      );
      await q(
        'UPDATE liekan_log SET recognition_state=NULL WHERE website_id=$1::uuid AND status=101',
        site,
      );
    }
  });
  it('A-01 keeps raw log presence independent of the selected identity', async () => {
    const report = await getLogFacts(
      site,
      new Date(startAt),
      new Date(endAt),
      'UTC',
      1,
      '',
      '',
      '',
      'after',
      undefined,
      { crawlerIdentityScope: 'verified_range', crawlerMetricsVersion: 1 },
    );
    expect(report.summary.requests).toBe(4);
    expect(report.connected).toBe(true);
    expect(report.totalLogs).toBe(4);
  });
  it('A-02 keeps cursor identity stable when the complete report query changes pages', async () => {
    const firstParams = { ...p, page: 1, cursor: '', seek: 'after' as const, tablePages: {} };
    const first = await getLogFacts(
      site,
      new Date(startAt),
      new Date(endAt),
      'UTC',
      1,
      '',
      '',
      '',
      'after',
      ['recent'],
      firstParams,
    );
    const nextParams = {
      ...firstParams,
      page: 2,
      cursor: first.nextCursor,
      tablePages: { logs: 2 },
    };
    await expect(
      getLogFacts(
        site,
        new Date(startAt),
        new Date(endAt),
        'UTC',
        2,
        '',
        '',
        nextParams.cursor,
        'after',
        ['recent'],
        nextParams,
      ),
    ).resolves.toMatchObject({ recent: [] });
    await expect(
      getLogFacts(
        site,
        new Date(startAt),
        new Date(endAt),
        'UTC',
        2,
        '',
        '',
        nextParams.cursor,
        'after',
        ['recent'],
        { ...nextParams, crawlerIdentityScope: 'verified_range' },
      ),
    ).rejects.toThrow('日志游标无效');
  });
  it('D-02/D-06 aligns info workflow in list/detail and clears it through legacy ignore/resume', async () => {
    const key = 'cr_' + 'a'.repeat(64);
    await q(
      "INSERT INTO liekan_crawler_finding(website_id,key,bot_id,type,path_group,grade,confidence,facts,window_end) VALUES($1::uuid,$2,'gptbot','access','/','info','possible','{}',$3)",
      site,
      key,
      new Date(startAt),
    );
    const current = await aiTransaction(tx => findingWorkflow(tx, site, key));
    const viewed = await changeFindingWorkflow(actor, site, key, {
      requestId: randomUUID(),
      expectedWorkflowRevision: 0,
      occurrenceVersion: 1,
      factVersion: current.factVersion,
      action: 'snooze',
      hours: 1,
    });
    const list = await crawlerAnalysis(actor, site, { startAt, endAt, timezone: 'UTC' });
    expect(list.findings.find(row => row.key === key)?.workflow.state).toBe('snoozed');
    await changeCrawlerFinding(actor, site, key, true);
    await changeCrawlerFinding(actor, site, key, false);
    const resumed = await aiTransaction(tx => findingWorkflow(tx, site, key));
    expect(resumed.state).toBe('pending');
    expect(resumed.workflowRevision).toBe(viewed.workflowRevision + 1);
  });
  it('A-06 refuses differences for declared hosts and absent browser input', async () => {
    const result = await queryEvidence(
      actor,
      site,
      { ...p, sourceId: 'manual', hostname: 'example.com' },
      'reconciliation',
      readReconciliation,
      true,
    );
    expect(result.rows[0]).toMatchObject({
      requests: 13,
      get2xx: 3,
      crawler: 3,
      candidate: 0,
      pv: null,
    });
    expect(result.rows[0].difference).toMatchObject({ value: null, state: 'not_comparable' });
  });
  it('C-01 freezes explicit zero versus missing bytes independently of import identity', async () => {
    const rows = await q(
      "SELECT measurement->>'bytesAvailability' AS state,count(*)::int AS count FROM liekan_crawler_evidence WHERE website_id=$1::uuid GROUP BY 1 ORDER BY 1",
      site,
    );
    expect(rows).toEqual([
      { state: 'missing', count: 1 },
      { state: 'present', count: 12 },
    ]);
  });
  it('A-09 joins encoded paths once and reports decoding collisions', () => {
    expect(pathMappings(['/a%20b', '/a b'])).toEqual([
      { humanPath: '/a b', encodedPaths: ['/a%20b', '/a b'], ambiguous: true },
    ]);
    expect(pathMappings(['/a%2520b'])[0].humanPath).toBe('/a%20b');
  });
  it('C-01/C-02/C-04 computes exact bytes, complete-minute peaks and continuous quantiles', async () => {
    await q(
      `UPDATE liekan_log SET bytes=9007199254740991 WHERE website_id=$1::uuid AND status IN(200,204)`,
      site,
    );
    await q(
      `UPDATE liekan_crawler_evidence e SET measurement=jsonb_set(measurement,'{bytesUnit}','"edge_body"'),cache_status=CASE WHEN l.status=200 THEN 'hit' WHEN l.status=204 THEN 'miss' ELSE 'unknown' END,
      edge_observation=jsonb_build_object('fields',jsonb_build_object('edgeDurationMs',jsonb_build_object('state','present','value',CASE WHEN l.status=200 THEN 0.1 WHEN l.status=204 THEN 9.9 ELSE NULL END)))
      FROM liekan_log l WHERE e.website_id=$1::uuid AND l.website_id=e.website_id AND l.id=e.log_id`,
      site,
    );
    const result = await queryEvidence(
      actor,
      site,
      { ...p, sourceId: 'manual' },
      'performance',
      readPerformance,
      true,
    );
    expect(result.rows[0].observedBytes).toBe('18014398509481982');
    expect(result.rows[0].samples).toBe(12);
    expect(result.totals.rpm).toBe(13);
    expect(result.coverage.edgeP50.value).toBeCloseTo(5);
    expect(result.coverage.edgeP95.value).toBeCloseTo(9.41);
    expect(result.coverage.cacheHitRatio.value).toBe(0.5);
  });
  it('B-02/B-06 keeps first observation atomic with UUID receipts and counts only public PV', async () => {
    const session = randomUUID(),
      visit = randomUUID(),
      clientId = randomUUID();
    await q(
      "INSERT INTO session(session_id,website_id,browser) VALUES($1::uuid,$2::uuid,'Safari')",
      session,
      site,
    );
    const quality = {
      classification: 'browser' as const,
      source: 'browser' as const,
      reasons: ['browser_compatible'],
      ruleVersion: 'traffic-quality-v2',
      rangeVersion: null,
      rangeStatus: 'missing' as const,
      hostname: 'example.com',
    };
    const input = {
      websiteId: site,
      eventId: clientId,
      fingerprint: 'fixed-test-payload',
      quality,
      observation: observeCollection(
        new Request('https://example.com/api/send', {
          headers: { accept: 'application/json', 'sec-fetch-site': 'same-origin' },
        }),
        new Date(startAt + 5000),
      ),
    };
    const write = async () => {
      const tx = collectionWriteClient(),
        event = randomUUID();
      await tx.$executeRawUnsafe(
        'INSERT INTO website_event(event_id,website_id,session_id,visit_id,event_type,created_at,url_path,referrer_domain) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,1,$5,$6,$7)',
        event,
        site,
        session,
        visit,
        new Date(startAt + 5000),
        '/article',
        'chatgpt.com',
      );
      await recordEventQuality(tx, event, site);
      return event;
    };
    const first = await withCollectionWrite(input, write);
    expect(first.status).toBe('written');
    const duplicate = await withCollectionWrite(
      { ...input, observation: observeCollection(new Request('https://example.com/api/send')) },
      write,
    );
    expect(duplicate.status).toBe('duplicate');
    expect(
      (
        await q(
          'SELECT count(*)::int AS n FROM liekan_event_observation WHERE website_id=$1::uuid',
          site,
        )
      )[0].n,
    ).toBe(1);
    await expect(
      withCollectionWrite({ ...input, fingerprint: 'different' }, write),
    ).rejects.toThrow('different payload');
    await expect(
      withCollectionWrite({ ...input, eventId: randomUUID() }, async () => {
        await write();
        throw new Error('injected after evidence');
      }),
    ).rejects.toThrow('injected');
    expect(
      (
        await q(
          'SELECT count(*)::int AS n FROM liekan_event_observation WHERE website_id=$1::uuid',
          site,
        )
      )[0].n,
    ).toBe(1);
    const observed = await queryEvidence(
      actor,
      site,
      { ...p, subset: 'raw' },
      'observations',
      readObservations,
      true,
    );
    expect(observed.totals).toMatchObject({ pv: 1, observed: 1, notCollected: 0 });
    expect(observed.coverage.accept.sampleCount).toBe(1);
    expect(observed.coverage.language.sampleCount).toBe(0);
    const outcomes = await queryEvidence(
      actor,
      site,
      { ...p, sourceId: 'manual' },
      'outcomes',
      readOutcomes,
      true,
    );
    expect(outcomes.rows.find(row => row.platformId === 'openai')).toMatchObject({
      visits: 1,
      conversions: null,
      goalEvents: null,
    });
    await q(
      "UPDATE liekan_raw_website_event SET utm_source='CHATGPT.COM',utm_medium='referral' WHERE website_id=$1::uuid",
      site,
    );
    const uppercase = await queryEvidence(
      actor,
      site,
      { ...p, sourceId: 'manual' },
      'outcomes',
      readOutcomes,
      true,
    );
    expect(uppercase.rows.find(row => row.platformId === 'openai')?.visits).toBe(1);
  });
  it('D-01/D-02/D-03/D-06 makes workflow idempotent, versioned, audited and independent of facts', async () => {
    const key = 'test-evidence-risk';
    await q(
      `INSERT INTO liekan_crawler_finding(website_id,key,bot_id,type,path_group,grade,confidence,facts,window_end) VALUES($1::uuid,$2,'gptbot','access','/','medium','possible','{}',$3)`,
      site,
      key,
      new Date(startAt),
    );
    const current = await aiTransaction(tx => findingWorkflow(tx, site, key));
    const request = {
      requestId: randomUUID(),
      expectedWorkflowRevision: 0,
      occurrenceVersion: 1,
      factVersion: current.factVersion,
      action: 'snooze' as const,
      hours: 1 as const,
      note: 'test observation',
    };
    const first = await changeFindingWorkflow(actor, site, key, request);
    expect(first.state).toBe('snoozed');
    expect(first.finding.state).toBe('active');
    expect(
      JSON.parse(JSON.stringify(await changeFindingWorkflow(actor, site, key, request))),
    ).toEqual(JSON.parse(JSON.stringify(first)));
    await expect(
      changeFindingWorkflow(actor, site, key, { ...request, note: 'changed' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      changeFindingWorkflow(actor, site, key, { ...request, requestId: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    await q(
      "UPDATE liekan_crawler_finding SET grade='high' WHERE website_id=$1::uuid AND key=$2",
      site,
      key,
    );
    expect((await aiTransaction(tx => findingWorkflow(tx, site, key))).state).toBe('pending');
    const transition = async (state: string, end: number, triggered: boolean) =>
      aiTransaction(async tx => {
        const before = await tx.query(
          'SELECT * FROM liekan_crawler_finding WHERE website_id=$1::uuid',
          site,
        );
        await tx.execute(
          "UPDATE liekan_crawler_finding SET state=$3,window_end=$4,facts=jsonb_build_object('windowEnd',$5::bigint) WHERE website_id=$1::uuid AND key=$2",
          site,
          key,
          state,
          new Date(end),
          end,
        );
        await reconcileFindingWorkflow(tx, site, before, new Set(triggered ? [key] : []), 1);
      });
    await transition('resolved', startAt + 1000, false);
    await transition('active', startAt + 500, true);
    expect((await aiTransaction(tx => findingWorkflow(tx, site, key))).occurrenceVersion).toBe(1);
    await transition('resolved', startAt + 1000, false);
    await transition('active', startAt + 1500, false);
    expect((await aiTransaction(tx => findingWorkflow(tx, site, key))).occurrenceVersion).toBe(1);
    await transition('active', startAt + 2000, true);
    expect((await aiTransaction(tx => findingWorkflow(tx, site, key))).occurrenceVersion).toBe(2);
    await transition('active', startAt + 3000, true);
    expect((await aiTransaction(tx => findingWorkflow(tx, site, key))).occurrenceVersion).toBe(2);
    // A rollback worker advances only its original window_end column when recovery is observed.
    await q(
      "UPDATE liekan_crawler_finding SET state='resolved',window_end=$3 WHERE website_id=$1::uuid AND key=$2",
      site,
      key,
      new Date(startAt + 5000),
    );
    await transition('active', startAt + 3000, true);
    expect((await aiTransaction(tx => findingWorkflow(tx, site, key))).occurrenceVersion).toBe(2);
    await transition('active', startAt + 6000, true);
    expect((await aiTransaction(tx => findingWorkflow(tx, site, key))).occurrenceVersion).toBe(3);
    const context = await addCrawlerContext(actor, site, {
      requestId: randomUUID(),
      title: 'Test release',
      note: 'Manual record',
      occurredAt: new Date(startAt).toISOString(),
    });
    expect(
      await voidCrawlerContext(actor, site, context.id, {
        requestId: randomUUID(),
        reason: 'Test correction',
      }),
    ).toMatchObject({ voided: true });
  });
  it('A-07/C-03 executes simultaneous cache misses inside the configured runtime', async () => {
    const results = await Promise.all([
      queryEvidence(
        actor,
        site,
        { ...p, sort: 'path' },
        'crawler-analysis/evidence',
        readCrawlerEvidence,
      ),
      queryEvidence(
        actor,
        site,
        { ...p, crawlerIdentityScope: 'verified_range' },
        'crawler-analysis/evidence',
        readCrawlerEvidence,
      ),
    ]);
    expect(results.map(row => row.totals.requests)).toEqual([13, 4]);
  });
  it('C-03 cancels only the owned database transaction and releases its connection', async () => {
    const abort = new AbortController();
    const started = Date.now();
    const pending = aiTransaction(tx =>
      cancellableEvidence(tx, abort.signal, async () => {
        setTimeout(() => abort.abort(), 100);
        return tx.query('SELECT pg_sleep(10)');
      }),
    );
    await expect(pending).rejects.toMatchObject({ status: 499 });
    expect(Date.now() - started).toBeLessThan(5000);
    expect((await q('SELECT 1 AS alive'))[0].alive).toBe(1);
  });
  it('C-03 converts an actual database deadline into unavailable without a result', async () => {
    const started = Date.now();
    await expect(
      queryEvidence(
        actor,
        site,
        p,
        'evidence',
        async tx => {
          await tx.query('SELECT pg_sleep(61)');
          throw new Error('deadline failed');
        },
        true,
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(Date.now() - started).toBeLessThan(61000);
    expect((await q('SELECT 1 AS alive'))[0].alive).toBe(1);
  }, 70000);
  it('G-05 rejects a reset that commits while a snapshot is being computed', async () => {
    await expect(
      queryEvidence(
        actor,
        site,
        p,
        'evidence',
        async (tx, website, params, input) => {
          const result = await readCrawlerEvidence(tx, website, params, input);
          await q('UPDATE liekan_log_state SET epoch=epoch+1 WHERE website_id=$1::uuid', site);
          return result;
        },
        true,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('B-07 prunes by reception time, preserves the exact boundary and is idempotent', async () => {
    const now = new Date(endAt + 31 * 86400000);
    const result = await pruneTrafficObservations(now);
    expect(result.deleted).toBe(1);
    expect((await pruneTrafficObservations(now)).deleted).toBe(0);
    expect(
      (
        await q(
          'SELECT count(*)::int AS n FROM liekan_event_quality WHERE website_id=$1::uuid',
          site,
        )
      )[0].n,
    ).toBe(1);
  });
  it('C-03 cancels while all primary pool connections are occupied', async () => {
    let ready = 0,
      release: () => void;
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    const holders = Array.from({ length: 9 }, () =>
      aiTransaction(
        async tx => {
          await tx.query('SELECT 1');
          ready++;
          await held;
        },
        { timeout: 15000, maxWait: 5000 },
      ),
    );
    try {
      while (ready < 9) await new Promise(resolve => setTimeout(resolve, 10));
      const controller = new AbortController(),
        started = Date.now();
      await expect(
        aiTransaction(
          tx =>
            cancellableEvidence(tx, controller.signal, async () => {
              setTimeout(() => controller.abort(), 100);
              return tx.query('SELECT pg_sleep(10)');
            }),
          { timeout: 12000, maxWait: 5000 },
        ),
      ).rejects.toMatchObject({ status: 499 });
      expect(Date.now() - started).toBeLessThan(2500);
    } finally {
      release();
      await Promise.all(holders);
    }
  }, 20000);
  it('G-05 refuses CSV if the user is revoked before final authorization', async () => {
    const view = await queryEvidence(actor, site, p, 'evidence', readCrawlerEvidence, true);
    authentication.value = { authType: 'session', user: { id: owner, role: 'user' } };
    authentication.before = () =>
      q('UPDATE "user" SET deleted_at=now() WHERE user_id=$1::uuid', owner).then(() => {});
    try {
      await expect(
        exportEvidence(
          actor,
          site,
          { kind: 'evidence', query: p, locale: 'en-US', policySnapshot: view.meta.policySnapshot },
          new Request('https://example.com/api/liekan/test', { method: 'POST' }),
          ['evidence'],
        ),
      ).rejects.toMatchObject({ status: 401 });
    } finally {
      authentication.before = null;
      await q('UPDATE "user" SET deleted_at=NULL WHERE user_id=$1::uuid', owner);
    }
  });
  it('D-02 invalidates active workflow with an idempotent rollback audit', async () => {
    const current = await aiTransaction(tx => findingWorkflow(tx, site, 'test-evidence-risk'));
    await changeFindingWorkflow(actor, site, 'test-evidence-risk', {
      requestId: randomUUID(),
      expectedWorkflowRevision: current.workflowRevision,
      occurrenceVersion: current.occurrenceVersion,
      factVersion: current.factVersion,
      action: 'view',
    });
    expect((await invalidateCrawlerWorkflowForRollback()).invalidated).toBe(1);
    expect((await invalidateCrawlerWorkflowForRollback()).invalidated).toBe(0);
    expect(
      (
        await q(
          "SELECT count(*)::int AS n FROM liekan_crawler_finding_action WHERE website_id=$1::uuid AND action='rollback_invalidate'",
          site,
        )
      )[0].n,
    ).toBe(1);
  });
  it('G-01 rejects access by a different principal', async () => {
    await expect(
      queryEvidence({ id: randomUUID(), role: 'user' }, site, p, 'evidence', readCrawlerEvidence),
    ).rejects.toMatchObject({ status: 401 });
  });
});
