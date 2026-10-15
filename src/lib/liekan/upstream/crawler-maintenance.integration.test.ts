// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgBoss, TestClock } from 'pg-boss';
import { CRAWLER_SOURCE_RETRY } from '../log-ingestion/queue';
import { aiTransaction } from './ai-db';
import {
  crawlerCandidates,
  crawlerRecognition,
  crawlerSources,
  documentSourceHealth,
  initializeDocumentSources,
  refreshDocumentSources,
} from './crawler-maintenance';
import { initializeRangeSources, refreshRangeSources } from './crawler-ranges';
import { rangeSources } from '../crawlers/range-sources';
import { rangeBaselines } from '../crawlers/range-check';
import { DocumentCheckError } from '../crawlers/document-check';
import { documentSources } from '../crawlers/document-sources';
import { importLogs, saveSettings } from '../store';

const enabled = process.env.LIEKAN_CRAWLER_TEST === '1';
const q = (sql: string, ...args: unknown[]) => aiTransaction(tx => tx.query(sql, ...args));
const run = (sql: string, ...args: unknown[]) => aiTransaction(tx => tx.execute(sql, ...args));
function requireIsolated() {
  const url = new URL(process.env.DATABASE_URL || 'http://invalid');
  if (
    url.hostname !== '127.0.0.1' ||
    url.port !== '15440' ||
    url.pathname !== '/liekan_crawler_acceptance'
  )
    throw new Error('Only isolated crawler DB15440 is allowed');
  return url;
}
const documentResponse = (text = 'Reviewed text') =>
  (async () =>
    new Response(`<main>${text}</main>`, { headers: { ETag: 'fixture-v1' } })) as typeof fetch;
const firstSource = documentSources[0];
const firstState = async () =>
  (await q('SELECT * FROM liekan_crawler_document_source WHERE source_id=$1', firstSource.id))[0];

describe.skipIf(!enabled)('durable document maintenance in an owned PostgreSQL schema', () => {
  let originalUrl: string;
  const schema = 'crawler_docs_' + randomUUID().replaceAll('-', '');
  beforeAll(async () => {
    const url = requireIsolated();
    originalUrl = process.env.DATABASE_URL;
    await run(`CREATE SCHEMA "${schema}"`);
    url.searchParams.set('schema', schema);
    process.env.DATABASE_URL = url.toString();
    for (const table of [
      'liekan_crawler_range_source',
      'liekan_crawler_range_snapshot',
      'liekan_crawler_range_observation',
      'liekan_bot_snapshot',
    ])
      await run(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
    const sql = await readFile('db/liekan/migrations/023_crawler_source_maintenance.sql', 'utf8');
    for (const statement of sql
      .split(';')
      .map(value => value.trim())
      .filter(Boolean))
      await run(statement);
  });
  afterAll(async () => {
    if (!originalUrl) return;
    process.env.DATABASE_URL = originalUrl;
    await run(`DROP SCHEMA "${schema}" CASCADE`);
  });
  beforeEach(async () => {
    await run('DELETE FROM liekan_crawler_document_source');
    await run('DELETE FROM liekan_crawler_document_lease');
    await run('DELETE FROM liekan_crawler_range_source');
    await initializeRangeSources();
  });
  it('starts missing, observes a baseline once, and renews a valid 304 without changing manual review', async () => {
    await initializeDocumentSources();
    expect((await firstState()).current_hash).toBeNull();
    await refreshDocumentSources({ fetcher: documentResponse() });
    const before = await firstState();
    expect(before.current_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(before.baseline_hash).toBe(before.current_hash);
    expect(before.pending_review).toBe(false);
    expect(+before.next_check_at - +before.last_success_at).toBeGreaterThanOrEqual(7 * 86400000);
    expect(before.reviewed_at.toISOString().slice(0, 10)).toBe(firstSource.reviewedAt);
    let called = 0;
    await refreshDocumentSources({
      fetcher: (async () => {
        called++;
        return new Response(null, { status: 304 });
      }) as typeof fetch,
    });
    expect(called).toBe(0);
    await refreshDocumentSources({
      force: true,
      fetcher: (async () => new Response(null, { status: 304 })) as typeof fetch,
    });
    const after = await firstState();
    expect(after.current_hash).toBe(before.current_hash);
    expect(+after.last_success_at).toBeGreaterThanOrEqual(+before.last_success_at);
    expect(after.reviewed_at).toEqual(before.reviewed_at);
  });
  it('exposes first-observation failures while preserving absent document hashes', async () => {
    await refreshDocumentSources({
      fetcher: (async () => new Response(null, { status: 403 })) as typeof fetch,
    });
    expect(documentSourceHealth(firstSource, await firstState())).toMatchObject({
      status: 'update_failed',
      currentHash: null,
      baselineHash: null,
      errorCode: 'http_403',
    });
    await refreshDocumentSources({
      force: true,
      fetcher: (async () => {
        throw new DocumentCheckError('timeout');
      }) as typeof fetch,
    });
    expect(documentSourceHealth(firstSource, await firstState())).toMatchObject({
      status: 'warning',
      currentHash: null,
      baselineHash: null,
      errorCode: 'timeout',
      consecutiveFailures: 2,
    });
  });
  it('retains last-good observations and safe failure codes for failed checks', async () => {
    await refreshDocumentSources({ fetcher: documentResponse() });
    const before = await firstState();
    for (const status of [403, 429])
      await refreshDocumentSources({
        force: true,
        fetcher: (async () => new Response('private response', { status })) as typeof fetch,
      });
    const after = await firstState();
    expect(after.current_hash).toBe(before.current_hash);
    expect(after.last_success_at).toEqual(before.last_success_at);
    expect(after.consecutive_failures).toBe(2);
    expect(after.error_code).toBe('http_429');
    expect(JSON.stringify(after)).not.toContain('private response');
  });
  it('latches change through unchanged and reverted observations until a later manual review', async () => {
    await refreshDocumentSources({ fetcher: documentResponse() });
    const baseline = (await firstState()).current_hash;
    await refreshDocumentSources({ force: true, fetcher: documentResponse('Changed text') });
    expect((await firstState()).pending_review).toBe(true);
    await refreshDocumentSources({ force: true, fetcher: documentResponse('Changed text') });
    expect((await firstState()).pending_review).toBe(true);
    await refreshDocumentSources({ force: true, fetcher: documentResponse() });
    expect(await firstState()).toMatchObject({
      baseline_hash: baseline,
      current_hash: baseline,
      pending_review: true,
    });
    await initializeDocumentSources();
    expect((await firstState()).pending_review).toBe(true);
    await run(
      "UPDATE liekan_crawler_document_source SET reviewed_at=$2::date-interval '1 day',last_success_at=$2::date+interval '12 hours' WHERE source_id=$1",
      firstSource.id,
      firstSource.reviewedAt,
    );
    await initializeDocumentSources();
    expect((await firstState()).pending_review).toBe(false);
    await run(
      "UPDATE liekan_crawler_document_source SET reviewed_at=$2::date+interval '1 day',pending_review=true WHERE source_id=$1",
      firstSource.id,
      firstSource.reviewedAt,
    );
    await initializeDocumentSources();
    expect((await firstState()).pending_review).toBe(true);
  });
  it('caps simultaneous IP and document jobs at two requests across both families', async () => {
    let active = 0,
      peak = 0,
      entered = 0;
    let release: () => void, started: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const firstTwo = new Promise<void>(resolve => {
      started = resolve;
    });
    const fetcher: typeof fetch = async input => {
      active++;
      peak = Math.max(peak, active);
      entered++;
      if (entered === 2) started();
      await gate;
      active--;
      const range = rangeSources.find(source => source.url === input);
      return new Response(
        range
          ? JSON.stringify({
              prefixes: rangeBaselines[range.id].content.prefixes.map(prefix => ({
                [prefix.includes(':') ? 'ipv6Prefix' : 'ipv4Prefix']: prefix,
              })),
            })
          : '<main>Shared capacity fixture</main>',
      );
    };
    const jobs = Promise.allSettled([
      refreshRangeSources({ fetcher }),
      refreshDocumentSources({ force: true, fetcher }),
    ]);
    await firstTwo;
    try {
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(peak).toBe(2);
    } finally {
      release();
      await jobs;
    }
    await refreshRangeSources({ fetcher });
    await refreshDocumentSources({ force: true, fetcher });
    expect(peak).toBe(2);
    expect(active).toBe(0);
    expect(
      (
        await q("SELECT lease_token FROM liekan_crawler_range_source WHERE source_id='__refresh__'")
      )[0].lease_token,
    ).toBeNull();
    expect(
      (await q("SELECT token FROM liekan_crawler_document_lease WHERE id='documents'"))[0].token,
    ).toBeNull();
  });
  it('automatically retries a busy source family through durable pg-boss jobs', async () => {
    const queueSchema = 'crawler_retry_' + randomUUID().replaceAll('-', '');
    const clock = new TestClock();
    const boss = new PgBoss({
      connectionString: originalUrl,
      schema: queueSchema,
      migrate: true,
      schedule: false,
      supervise: false,
      clock,
    });
    boss.on('error', () => {});
    let release: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let active = 0,
      peak = 0,
      ipRequests = 0,
      documentRequests = 0;
    const fetcher: typeof fetch = async input => {
      active++;
      peak = Math.max(peak, active);
      const range = rangeSources.find(source => source.url === input);
      if (range) ipRequests++;
      else documentRequests++;
      await gate;
      active--;
      return new Response(
        range
          ? JSON.stringify({
              prefixes: rangeBaselines[range.id].content.prefixes.map(prefix => ({
                [prefix.includes(':') ? 'ipv6Prefix' : 'ipv4Prefix']: prefix,
              })),
            })
          : '<main>Automatic retry fixture</main>',
      );
    };
    try {
      await boss.start();
      for (const queue of ['fixture-ip', 'fixture-documents'])
        await boss.createQueue(queue, { ...CRAWLER_SOURCE_RETRY, expireInSeconds: 900 });
      const ipJob = await boss.send('fixture-ip', {}, CRAWLER_SOURCE_RETRY);
      const docJob = await boss.send('fixture-documents', {}, CRAWLER_SOURCE_RETRY);
      const states = () =>
        Promise.all([
          boss.getJobById('fixture-ip', ipJob),
          boss.getJobById('fixture-documents', docJob),
        ]);
      await boss.work(
        'fixture-ip',
        { pollingIntervalSeconds: 0.5, localConcurrency: 1, batchSize: 1 },
        async () => {
          await refreshRangeSources({ fetcher });
        },
      );
      await boss.work(
        'fixture-documents',
        { pollingIntervalSeconds: 0.5, localConcurrency: 1, batchSize: 1 },
        async () => {
          await refreshDocumentSources({ force: true, fetcher });
        },
      );
      await clock.tick(0);
      await vi.waitFor(
        async () => expect((await states()).some(job => job.state === 'retry')).toBe(true),
        { timeout: 5000, interval: 20 },
      );
      const retry = (await states()).find(job => job.state === 'retry');
      expect(retry.retryLimit).toBe(CRAWLER_SOURCE_RETRY.retryLimit);
      expect(retry.retryDelay).toBe(CRAWLER_SOURCE_RETRY.retryDelay);
      expect(retry.retryBackoff).toBe(true);
      expect(
        (
          await q(
            'SELECT sum(consecutive_failures)::int AS failures FROM liekan_crawler_document_source',
          )
        )[0].failures,
      ).toBe(0);
      expect(
        (
          await q(
            'SELECT sum(consecutive_failures)::int AS failures FROM liekan_crawler_range_source',
          )
        )[0].failures,
      ).toBe(0);
      expect(ipRequests === 0 || documentRequests === 0).toBe(true);
      release();
      await vi.waitFor(
        async () => expect((await states()).some(job => job.state === 'completed')).toBe(true),
        { timeout: 5000, interval: 20 },
      );
      // Advance the queue's documented test clock to its persisted retry deadline. No manual job call occurs.
      await clock.setTime(+new Date(retry.startAfter) + 1);
      await clock.tick(1000);
      await vi.waitFor(
        async () => expect((await states()).every(job => job.state === 'completed')).toBe(true),
        { timeout: 5000, interval: 20 },
      );
      expect((await states()).reduce((sum, job) => sum + job.retryCount, 0)).toBeGreaterThanOrEqual(
        1,
      );
      expect(ipRequests).toBe(rangeSources.length);
      expect(documentRequests).toBe(documentSources.length);
      expect(peak).toBe(2);
    } finally {
      release();
      await boss.stop({ graceful: false });
      await run(`DROP SCHEMA IF EXISTS "${queueSchema}" CASCADE`);
    }
  }, 30000);
  it('uses a durable global lease to cap concurrent requests across competing refreshes', async () => {
    let active = 0,
      peak = 0,
      entered = 0;
    let release: () => void, started: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const firstTwo = new Promise<void>(resolve => {
      started = resolve;
    });
    const fetcher: typeof fetch = async () => {
      active++;
      peak = Math.max(peak, active);
      entered++;
      if (entered === 2) started();
      await gate;
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      return new Response('<main>Text</main>');
    };
    const first = refreshDocumentSources({ force: true, fetcher });
    await firstTwo;
    try {
      await expect(refreshDocumentSources({ force: true, fetcher })).rejects.toMatchObject({
        code: 'crawler_source_maintenance_busy',
      });
    } finally {
      release();
    }
    await first;
    expect(peak).toBe(2);
    expect(entered).toBe(documentSources.length);
    expect(
      (await q("SELECT token FROM liekan_crawler_document_lease WHERE id='documents'"))[0].token,
    ).toBeNull();
  });
  it('fences stale per-document epochs and a replaced global lease', async () => {
    let first = true;
    await refreshDocumentSources({
      force: true,
      fetcher: (async () => {
        if (first) {
          first = false;
          await run(
            'UPDATE liekan_crawler_document_source SET lease_epoch=lease_epoch+1 WHERE source_id=$1',
            firstSource.id,
          );
        }
        return new Response('<main>Fenced</main>');
      }) as typeof fetch,
    });
    expect((await firstState()).current_hash).toBeNull();
    await run('UPDATE liekan_crawler_document_source SET lease_until=NULL');
    first = true;
    let fencing: Promise<number> | undefined;
    const results = await refreshDocumentSources({
      force: true,
      fetcher: (async () => {
        if (first) {
          first = false;
          fencing = run(
            "UPDATE liekan_crawler_document_lease SET epoch=epoch+1 WHERE id='documents'",
          );
        }
        await fencing;
        return new Response('<main>Replaced global</main>');
      }) as typeof fetch,
    });
    expect(results.every(result => result.status === 'superseded')).toBe(true);
    expect((await firstState()).current_hash).toBeNull();
  });
  it('fences replaced shared-capacity epochs and cannot release their new ownership', async () => {
    const replacement = randomUUID();
    let fencing: Promise<number> | undefined;
    const results = await refreshDocumentSources({
      force: true,
      fetcher: (async () => {
        fencing ||= run(
          "UPDATE liekan_crawler_range_source SET lease_token=$1::uuid,lease_epoch=lease_epoch+1 WHERE source_id='__refresh__'",
          replacement,
        );
        await fencing;
        return new Response('<main>Stale shared owner</main>');
      }) as typeof fetch,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(result => result.status === 'superseded')).toBe(true);
    expect((await firstState()).current_hash).toBeNull();
    expect(
      (
        await q("SELECT lease_token FROM liekan_crawler_range_source WHERE source_id='__refresh__'")
      )[0].lease_token,
    ).toBe(replacement);
  });
  it('releases shared capacity when an outstanding document lease prevents a claim', async () => {
    await run(
      "INSERT INTO liekan_crawler_document_lease(id,token,lease_until) VALUES('documents',$1::uuid,clock_timestamp()+interval '1 minute')",
      randomUUID(),
    );
    let requests = 0;
    await expect(
      refreshDocumentSources({
        fetcher: (async () => {
          requests++;
          return new Response('<main>unused</main>');
        }) as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'crawler_source_maintenance_busy' });
    expect(requests).toBe(0);
    expect(
      (
        await q("SELECT lease_token FROM liekan_crawler_range_source WHERE source_id='__refresh__'")
      )[0].lease_token,
    ).toBeNull();
  });
  it('settles in-flight work before releasing a lease after a persistence failure', async () => {
    await initializeDocumentSources();
    await run(
      `ALTER TABLE liekan_crawler_document_source ADD CONSTRAINT fixture_failure CHECK (source_id<>'${firstSource.id}' OR current_hash IS NULL)`,
    );
    let active = 0;
    try {
      await expect(
        refreshDocumentSources({
          force: true,
          fetcher: (async () => {
            active++;
            await new Promise(resolve => setTimeout(resolve, 2));
            active--;
            return new Response('<main>Persistence fixture</main>');
          }) as typeof fetch,
        }),
      ).rejects.toThrow('Document maintenance persistence unavailable');
      expect(active).toBe(0);
      expect(
        (
          await q(
            "SELECT lease_token FROM liekan_crawler_range_source WHERE source_id='__refresh__'",
          )
        )[0].lease_token,
      ).toBeNull();
      expect(
        (await q("SELECT token FROM liekan_crawler_document_lease WHERE id='documents'"))[0].token,
      ).toBeNull();
    } finally {
      await run('ALTER TABLE liekan_crawler_document_source DROP CONSTRAINT fixture_failure');
    }
  });
});

describe.skipIf(!enabled)(
  'private website maintenance with real permissions and effective logs',
  () => {
    beforeAll(requireIsolated);
    const owner = randomUUID(),
      outsider = randomUUID(),
      site = randomUUID(),
      otherSite = randomUUID(),
      admin = randomUUID();
    const actor = { id: owner, role: 'user' };
    beforeAll(async () => {
      for (const [id, role] of [
        [owner, 'view-only'],
        [outsider, 'user'],
        [admin, 'admin'],
      ])
        await run(
          'INSERT INTO "user"(user_id,username,password,role) VALUES($1::uuid,$2,\'test-no-login\',$3)',
          id,
          'maintenance-' + id,
          role,
        );
      for (const [id, user] of [
        [site, owner],
        [otherSite, outsider],
      ])
        await run(
          "INSERT INTO website(website_id,name,domain,user_id) VALUES($1::uuid,'maintenance fixture','example.com',$2::uuid)",
          id,
          user,
        );
    });
    afterAll(async () => {
      for (const website of [site, otherSite]) {
        for (const table of [
          'liekan_log_interval',
          'liekan_log_source',
          'liekan_log_geography',
          'liekan_crawler_evidence',
          'liekan_log',
          'liekan_import',
          'liekan_crawler_rule_version',
          'liekan_log_state',
          'liekan_setting',
        ])
          await run(`DELETE FROM ${table} WHERE website_id=$1::uuid`, website);
        await run('DELETE FROM website WHERE website_id=$1::uuid', website);
      }
      for (const id of [owner, outsider, admin])
        await run('DELETE FROM "user" WHERE user_id=$1::uuid', id);
    });
    it('allows an authorized site viewer, blocks another site, and checks live administrator role', async () => {
      expect((await crawlerRecognition(actor, site)).mode).toBe('official');
      await expect(crawlerRecognition(actor, otherSite)).rejects.toMatchObject({ status: 404 });
      await expect(crawlerCandidates(actor, otherSite)).rejects.toMatchObject({ status: 404 });
      await expect(crawlerSources({ ...actor, role: 'admin' })).rejects.toMatchObject({
        status: 403,
      });
      expect((await crawlerSources({ id: admin, role: 'user' })).documents).toHaveLength(
        documentSources.length,
      );
      await run('UPDATE "user" SET deleted_at=now() WHERE user_id=$1::uuid', admin);
      await expect(crawlerSources({ id: admin, role: 'admin' })).rejects.toMatchObject({
        status: 401,
      });
    });
    it('bounds aggregation of 100000 full-length user agents by the five-second total budget', async () => {
      const importId = randomUUID();
      await run(
        'INSERT INTO liekan_import(id,website_id,digest,accepted,rejected) VALUES($1::uuid,$2::uuid,$3,100000,0)',
        importId,
        site,
        'load-fixture-' + importId,
      );
      await aiTransaction(
        tx =>
          tx.execute(
            `INSERT INTO liekan_log(id,website_id,import_id,created_at,path,method,status,bytes,ip_masked,ip_hash,user_agent,location,bot,vendor,bot_type,verification,recognition_state)
      SELECT 'load-fixture-'||n::text,$1::uuid,$2::uuid,now()-interval '2 hours'-n*interval '1 microsecond','/fixture','GET',200,0,'fixture','fixture',
      rpad('LoadBot/1.0 Mozilla/5.0 (private customer text)',500,' private'),'','其他','','其他','unknown','unknown' FROM generate_series(1,100000) n`,
            site,
            importId,
          ),
        { timeout: 20000 },
      );
      const started = Date.now();
      const result = await crawlerCandidates(actor, site);
      expect(Date.now() - started).toBeLessThan(6000);
      expect(result.partial).toBe(true);
      if (result.state === 'ready') {
        expect(result.scannedRows).toBeGreaterThan(0);
        expect(result.scannedRows).toBeLessThanOrEqual(100000);
        expect(result.items).toEqual([
          {
            token: 'loadbot',
            count: result.scannedRows,
            firstSeen: result.scannedStart,
            lastSeen: result.scannedEnd,
          },
        ]);
      } else expect(result).toMatchObject({ state: 'unavailable', items: [], scannedRows: 0 });
      expect(JSON.stringify(result)).not.toMatch(/private customer|userAgent|\/fixture/);
      await run(
        'DELETE FROM liekan_log WHERE website_id=$1::uuid AND import_id=$2::uuid',
        site,
        importId,
      );
      await run(
        'DELETE FROM liekan_import WHERE website_id=$1::uuid AND id=$2::uuid',
        site,
        importId,
      );
    }, 30000);
    it('counts unknown and ambiguous effective rows while excluding known custom other and self-checks', async () => {
      const time = Date.now() - 3600000;
      await saveSettings(site, {
        crawlerRules: {
          mode: 'official',
          disabledIds: [],
          overrides: {},
          customRules: [
            {
              name: '其他',
              vendor: 'Fixture',
              type: '其他',
              pattern: 'KnownCustomBot',
              matchMode: 'token',
            },
          ],
        },
        expectedRulesRevision: 0,
      });
      const input = {
        format: 'json',
        records: [
          'NewCrawler/1.0',
          'NewCrawler/1.0',
          'GPTBot/1.0 ClaudeBot/1.0',
          'KnownCustomBot/1.0',
          'Liekan-Crawler-Check/1.0 HiddenBot/1.0',
          'Mozilla/5.0 (private token) Safari/537.36',
        ].map((userAgent, index) => ({
          userAgent,
          time: new Date(time + index * 1000).toISOString(),
          path: '/private-fixture',
          ip: '203.0.113.9',
          status: 200,
        })),
      };
      await importLogs(site, 'example.com', input);
      await importLogs(site, 'example.com', input);
      await importLogs(otherSite, 'example.com', {
        format: 'json',
        records: [
          {
            userAgent: 'CrossSiteBot/1.0',
            time: new Date(time).toISOString(),
            path: '/',
            ip: '203.0.113.10',
            status: 200,
          },
        ],
      });
      const result = await crawlerCandidates(actor, site);
      expect(result.scannedRows).toBe(4);
      expect(result.items).toEqual([
        {
          token: 'newcrawler',
          count: 2,
          firstSeen: new Date(time).toISOString(),
          lastSeen: new Date(time + 1000).toISOString(),
        },
        {
          token: 'claudebot',
          count: 1,
          firstSeen: new Date(time + 2000).toISOString(),
          lastSeen: new Date(time + 2000).toISOString(),
        },
        {
          token: 'gptbot',
          count: 1,
          firstSeen: new Date(time + 2000).toISOString(),
          lastSeen: new Date(time + 2000).toISOString(),
        },
      ]);
      expect(JSON.stringify(result)).not.toMatch(/private-fixture|203\.0\.113|CrossSite|userAgent/);
      const sourceId = randomUUID();
      await run(
        "INSERT INTO liekan_log_source(id,website_id,kind,domain,created_by,state) VALUES($1::uuid,$2::uuid,'server','example.com',$3::uuid,'active')",
        sourceId,
        site,
        owner,
      );
      await run(
        'INSERT INTO liekan_log_interval(id,website_id,source_id,starts_at,ends_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4::timestamptz,$5::timestamptz)',
        randomUUID(),
        site,
        sourceId,
        new Date(time - 1000),
        new Date(time + 10000),
      );
      expect((await crawlerCandidates(actor, site)).scannedRows).toBe(0);
    });
  },
);
