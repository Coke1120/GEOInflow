// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  query: vi.fn(),
  execute: vi.fn(),
  authorize: vi.fn(),
  range: vi.fn(),
  transactions: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ checkAuth: h.auth }));
vi.mock('@/lib/db', () => ({ isRelationalOnly: () => true }));
vi.mock('./ai-db', () => ({ aiTransaction: (work, options) => h.transactions(work, options) }));
vi.mock('./crawler-ranges', () => ({ rangeSourceHealth: h.range }));
vi.mock('./crawler-access', async importOriginal => ({
  ...(await importOriginal<typeof import('./crawler-access')>()),
  authorizeCrawler: h.authorize,
  crawlerTransaction: (work, options) => h.transactions(work, options),
}));
import {
  authenticateCrawlerMaintenance,
  crawlerCandidates,
  crawlerRecognition,
  crawlerSources,
  documentSourceHealth,
} from './crawler-maintenance';
import { documentSources } from '../crawlers/document-sources';
import { LiekanError } from './errors';
import {
  crawlerCandidatesResponseSchema,
  crawlerRecognitionResponseSchema,
  crawlerSourcesResponseSchema,
} from '../contracts/crawler-maintenance';
const actor = { id: '3fa59080-39b9-450a-b19d-f4d0e24b2b09', role: 'admin' };
const website = 'de70ea88-01f5-4bfb-8f1b-c38a8e4c82c4';
beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ authType: 'session', user: actor });
  h.authorize.mockResolvedValue({ id: website });
  h.query.mockResolvedValue([]);
  h.range.mockResolvedValue([]);
  h.transactions.mockImplementation(work => work({ query: h.query, execute: h.execute }));
});

describe('crawler maintenance boundaries', () => {
  it.each(['api-key', 'share', 'partial', undefined])(
    'rejects %s authentication',
    async authType => {
      h.auth.mockResolvedValue({ authType, user: actor });
      await expect(
        authenticateCrawlerMaintenance(new Request('https://liekan.test/api')),
      ).rejects.toMatchObject({ status: 401 });
    },
  );
  it('rejects missing, deleted and mixed-share sessions', async () => {
    for (const auth of [
      null,
      { authType: 'session', user: { ...actor, deletedAt: new Date() } },
      { authType: 'session', user: actor, shareToken: { websiteId: website } },
    ]) {
      h.auth.mockResolvedValue(auth);
      await expect(
        authenticateCrawlerMaintenance(new Request('https://liekan.test/api')),
      ).rejects.toMatchObject({ status: 401 });
    }
  });
  it.each(['x-umami-share-token', 'x-umami-share-context'])(
    'rejects public context header %s before checking session',
    async header => {
      await expect(
        authenticateCrawlerMaintenance(
          new Request('https://liekan.test/api', { headers: { [header]: 'invalid' } }),
        ),
      ).rejects.toMatchObject({ status: 401 });
      expect(h.auth).not.toHaveBeenCalled();
    },
  );
  it('accepts complete sessions and checks the current admin role before loading global sources', async () => {
    expect(await authenticateCrawlerMaintenance(new Request('https://liekan.test/api'))).toEqual(
      actor,
    );
    h.query.mockImplementation(sql =>
      Promise.resolve(sql.includes('FROM "user"') ? [{ role: 'user' }] : []),
    );
    await expect(crawlerSources(actor)).rejects.toMatchObject({ status: 403 });
    expect(h.range).not.toHaveBeenCalled();
    h.query.mockImplementation(sql =>
      Promise.resolve(sql.includes('FROM "user"') ? [{ role: 'admin' }] : []),
    );
    const result = await crawlerSources(actor);
    expect(crawlerSourcesResponseSchema.safeParse(result).success).toBe(true);
    expect(h.range).toHaveBeenCalledWith(expect.any(Number), { initialize: false });
    expect(h.execute).not.toHaveBeenCalled();
    expect(result.documents.every(source => source.status === 'missing')).toBe(true);
  });
  it('scopes effective recognition to the authorized website and excludes same-name custom identities', async () => {
    h.query.mockResolvedValue([
      {
        rulesRevision: 3,
        crawlerRules: {
          mode: 'official',
          disabledIds: ['gptbot'],
          overrides: {},
          customRules: [
            {
              name: 'GPTBot',
              vendor: 'OpenAI',
              type: '训练',
              pattern: 'CustomBot',
              matchMode: 'token',
            },
          ],
        },
      },
    ]);
    const result = await crawlerRecognition(actor, website);
    expect(crawlerRecognitionResponseSchema.safeParse(result).success).toBe(true);
    expect(result.enabledIds).not.toContain('gptbot');
    expect(result.rulesRevision).toBe(3);
    expect(h.authorize).toHaveBeenCalledWith(expect.anything(), actor, website);
    h.authorize.mockRejectedValue(new LiekanError('unavailable', 404));
    await expect(crawlerRecognition(actor, 'another-site')).rejects.toMatchObject({ status: 404 });
  });
  it('preserves official identities for exact historical rules inside mixed legacy settings', async () => {
    h.query.mockResolvedValue([
      {
        crawlerRules: {
          mode: 'legacy',
          rules: [
            { name: 'GPTBot', vendor: 'OpenAI', type: '训练', pattern: 'GPTBot' },
            {
              name: 'ClaudeBot',
              vendor: 'Anthropic',
              type: '训练',
              pattern: 'ClaudeBot',
              matchMode: 'token',
            },
          ],
        },
        rulesRevision: 4,
      },
    ]);
    expect(await crawlerRecognition(actor, website)).toMatchObject({
      mode: 'legacy',
      enabledIds: ['gptbot'],
      rulesRevision: 4,
    });
  });
  it('queries effective unknown rows with self-check exclusion and explicit five-second budget', async () => {
    h.query.mockResolvedValue([
      { userAgent: 'NewBot/1.0', createdAt: new Date('2026-10-15T01:00:00Z') },
      { userAgent: 'NewBot/1.0', createdAt: new Date('2026-10-14T01:00:00Z') },
    ]);
    const result = await crawlerCandidates(actor, website);
    expect(crawlerCandidatesResponseSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({
      state: 'ready',
      scannedRows: 2,
      partial: false,
      scannedStart: '2026-10-14T01:00:00.000Z',
      items: [{ token: 'newbot', count: 2 }],
    });
    const [sql, id] = h.query.mock.lastCall;
    expect(id).toBe(website);
    expect(sql).toContain('liekan_effective_log');
    expect(sql).toContain("'unknown','ambiguous'");
    expect(sql).toContain("NOT LIKE 'Liekan-Crawler-Check/%'");
    expect(h.transactions).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 5000,
      transactionTimeout: 6000,
    });
    expect(JSON.stringify(result)).not.toContain('userAgent');
  });
  it('reports a bounded partial sample at the row limit', async () => {
    h.query.mockResolvedValue(
      Array.from({ length: 100000 }, () => ({ userAgent: 'Mozilla/5.0', createdAt: new Date() })),
    );
    const result = await crawlerCandidates(actor, website);
    expect(result).toMatchObject({
      state: 'ready',
      scannedRows: 100000,
      scanLimit: 100000,
      partial: true,
    });
  });
  it('returns actual partial row counts and scanned bounds when processing reaches its deadline', async () => {
    const start = Date.now();
    const rows = Array.from({ length: 10 }, (_, index) => ({
      userAgent: 'PartialBot/1.0',
      createdAt: new Date(start - index * 1000),
    }));
    h.query.mockResolvedValue(rows);
    let ticks = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => start + ticks++ * 1000);
    try {
      const result = await crawlerCandidates(actor, website);
      expect(result).toMatchObject({
        state: 'ready',
        partial: true,
        scannedRows: 5,
        scannedStart: rows[4].createdAt.toISOString(),
        scannedEnd: rows[0].createdAt.toISOString(),
        items: [{ token: 'partialbot', count: 5 }],
      });
    } finally {
      clock.mockRestore();
    }
  });
  it('returns explicit unavailable on query timeout and rechecks permission after cancellation', async () => {
    h.query.mockRejectedValue({
      code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: '57014' } } },
    });
    expect(await crawlerCandidates(actor, website)).toMatchObject({
      state: 'unavailable',
      partial: true,
      scannedRows: 0,
      items: [],
    });
    expect(h.authorize).toHaveBeenCalledTimes(2);
    h.authorize
      .mockResolvedValueOnce({ id: website })
      .mockRejectedValueOnce(new LiekanError('unavailable', 404));
    await expect(crawlerCandidates(actor, website)).rejects.toMatchObject({ status: 404 });
  });
  it('does not disguise unauthorized or unrelated persistence failures as an empty result', async () => {
    h.authorize.mockRejectedValue(new LiekanError('unavailable', 404));
    await expect(crawlerCandidates(actor, website)).rejects.toMatchObject({ status: 404 });
    h.authorize.mockResolvedValue({ id: website });
    h.query.mockRejectedValue(new Error('persistence failure'));
    await expect(crawlerCandidates(actor, website)).rejects.toThrow('persistence failure');
  });
});

describe('document health', () => {
  const source = documentSources[0],
    now = Date.parse('2026-10-15T00:00:00Z');
  const good = {
    current_hash: 'a'.repeat(64),
    baseline_hash: 'a'.repeat(64),
    last_success_at: new Date(now),
  };
  it('keeps missing observation and manual review age independent', () => {
    expect(documentSourceHealth(source, undefined, now)).toMatchObject({
      status: 'missing',
      reviewOverdue: false,
    });
    expect(documentSourceHealth(source, good, now + 46 * 86400000)).toMatchObject({
      status: 'warning',
      reviewOverdue: true,
    });
  });
  it('reports first-observation failures without inventing a qualified hash', () => {
    expect(
      documentSourceHealth(source, { consecutive_failures: 1, error_code: 'http_403' }, now),
    ).toMatchObject({ status: 'update_failed', currentHash: null, lastSuccessAt: null });
    expect(
      documentSourceHealth(source, { consecutive_failures: 2, error_code: 'timeout' }, now),
    ).toMatchObject({ status: 'warning', currentHash: null, lastSuccessAt: null });
  });
  it('warns at two failures or 14 days and keeps a changed document latched', () => {
    expect(
      documentSourceHealth(
        source,
        { ...good, consecutive_failures: 1, error_code: 'http_403' },
        now,
      ).status,
    ).toBe('update_failed');
    expect(documentSourceHealth(source, { ...good, consecutive_failures: 2 }, now).status).toBe(
      'warning',
    );
    expect(documentSourceHealth(source, good, now + 14 * 86400000 + 1).status).toBe('warning');
    expect(documentSourceHealth(source, { ...good, pending_review: true }, now).status).toBe(
      'review_required',
    );
  });
});
