import { expect, test } from './fixtures';
import { createWebsite, deleteWebsite } from './helpers/entities';
import { pageReportParts } from '../../src/lib/liekan/contracts/page-report';

test('identifies source keywords through real collection, scopes access, pages and exports the complete population', async ({
  admin,
  user,
  api,
  share,
}) => {
  const website = await createWebsite(admin, {
    name: '隔离关键词验收',
    domain: 'keyword-fixture.test',
  });
  const base = `/api/liekan/websites/${website.id}`;
  const midnight = Math.floor((Date.now() - 86400000) / 86400000) * 86400000;
  const params = {
    resource: 'human/keywords',
    startAt: midnight,
    endAt: midnight + 3600000,
    timezone: 'UTC',
    sort: 'keyword',
    direction: 'asc',
  };
  const send = async (
    id: string,
    referrer: string,
    timestamp: number,
    url = '/',
    cache?: string,
    name?: string,
  ) => {
    const response = await api.post(
      '/api/send',
      {
        type: 'event',
        payload: {
          website: website.id,
          hostname: website.domain,
          url,
          referrer,
          timestamp: Math.floor(timestamp / 1000),
          id,
          ip: '10.90.0.1',
          userAgent: 'Mozilla/5.0 Chrome/124.0.0.0',
          screen: '1440x900',
          language: 'zh-CN',
          ...(name ? { name } : {}),
        },
      },
      { headers: cache ? { 'x-umami-cache': cache } : {} },
    );
    expect(response.status).toBe(200);
    expect(response.body.cache).toBeTruthy();
    return response.body.cache as string;
  };
  try {
    for (let i = 0; i < 25; i++)
      await send(
        `keyword-${i}`,
        `https://www.google.com/search?q=word${String(i).padStart(2, '0')}`,
        midnight + 60000 + i * 1000,
      );
    // The first browser entry predates the window; later pages and repeated goals keep that entry.
    const first = await send(
      'cross-midnight',
      'https://www.baidu.com/s?wd=%E7%8C%8E%E7%9C%8B',
      midnight - 1000,
    );
    const second = await send(
      'cross-midnight',
      'https://www.bing.com/search?q=later',
      midnight + 1000,
      '/',
      first,
    );
    await send('cross-midnight', '', midnight + 2000, '/', second, 'keyword-goal');
    await send('cross-midnight', '', midnight + 3000, '/', second, 'keyword-goal');
    await send(
      'manual',
      'https://www.google.com/search?q=real',
      midnight + 4000,
      '/?utm_source=google&utm_term=manual',
    );
    await send(
      'conflict',
      'https://www.google.com/search?q=real',
      midnight + 5000,
      '/?utm_source=bing',
    );
    await send(
      'utm',
      'https://www.bing.com/',
      midnight + 6000,
      '/?utm_source=bing&utm_term=C%2B%2B%2520guide',
    );
    await send('missing', 'https://www.baidu.com/', midnight + 7000);
    await send('private', 'https://www.google.com/search?q=person%40example.test', midnight + 8000);
    await send(
      'nonsearch',
      'https://www.google.com/search?q=ignore',
      midnight + 9000,
      '/?utm_source=google&utm_medium=email',
    );
    const before = await admin.get(`${base}/page-report`, { params });
    expect(before.status, before.text).toBe(200);
    expect((await admin.get(`${base}/report`, { params })).status).toBe(400);
    expect(before.body.meta.tablePages.keywordBody.total).toBe(31);
    expect(before.body.cards.map(c => c.value)).toEqual([31, 27, 1, 90.32]);
    expect(before.body.tables.keywordBody).toHaveLength(20);
    expect(before.body.tables.keywordBody.every(r => r.conversionRate === null)).toBe(true);
    const page2 = await admin.get(`${base}/page-report`, {
      params: { ...params, page: 2, keywordSnapshot: before.body.meta.keywordSnapshot },
    });
    expect(page2.status).toBe(200);
    expect(page2.body.tables.keywordBody).toHaveLength(11);
    const ids = [...before.body.tables.keywordBody, ...page2.body.tables.keywordBody].map(
      r => r.id,
    );
    expect(new Set(ids).size).toBe(31);
    const matched = await admin.get(`${base}/page-report`, {
      params: { ...params, search: 'word24', page: 2 },
    });
    expect(matched.body.tables.keywordBody[0].keyword).toBe('word24');
    const source = await admin.get(`${base}/page-report`, {
      params: { ...params, resource: 'human/sources' },
    });
    expect(
      source.body.tables.srcBody
        .filter(r => r.channel === '传统搜索')
        .reduce((n, r) => n + r.sessions, 0),
    ).toBe(31);
    expect((await api.get(`${base}/page-report`, { params })).status).toBe(401);
    expect((await user.get(`${base}/page-report`, { params })).status).toBe(403);
    expect((await (await share()).get(`${base}/page-report`, { params })).status).toBe(401);
    expect(
      (await api.post(`${base}/exports`, { kind: 'source-keywords', format: 'csv', ...params }))
        .status,
    ).toBe(401);
    const goal = await admin.post(`/api/websites/${website.id}/goals`, {
      name: '关键词验收目标',
      parameters: { type: 'event', value: 'keyword-goal' },
    });
    expect(goal.status).toBe(200);
    const converted = await admin.get(`${base}/page-report`, {
      params: { ...params, engine: '百度', refresh: '1' },
    });
    const baidu = converted.body.tables.keywordBody.find(r => r.keyword === '猎看');
    expect(baidu).toMatchObject({
      sessions: 1,
      conversions: 1,
      bounceRate: 0,
      conversionRate: 100,
    });
    const reset = await admin.get(`${base}/page-report`, {
      params: { ...params, page: 2, keywordSnapshot: before.body.meta.keywordSnapshot },
    });
    expect(reset.body.meta.keywordReset).toBe(true);
    expect(reset.body.meta.tablePages.keywordBody.page).toBe(1);
    const exported = await admin.post(`${base}/exports`, {
      kind: 'source-keywords',
      format: 'csv',
      startAt: params.startAt,
      endAt: params.endAt,
      timezone: 'UTC',
      search: 'word',
      sort: 'keyword',
      direction: 'asc',
    });
    expect(exported.status, exported.text).toBe(200);
    const frames = exported.text
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    expect(frames.at(-1).type).toBe('complete');
    expect(frames.find(frame => frame.type === 'file').manifest.rows).toBe(25);
    const csv = Buffer.concat(
      frames.filter(f => f.type === 'chunk').map(f => Buffer.from(f.data, 'base64')),
    ).toString();
    expect(csv).toContain('word00');
    expect(csv).toContain('word24');
    expect(csv).toContain('统计读取时间');
    expect(csv).not.toContain('person@example.test');
  } finally {
    await deleteWebsite(admin, website.id);
  }
});

test('keeps the deployed shared overview scoped and aggregate-only', async ({
  admin,
  user,
  api,
  share,
  seed,
}) => {
  const path = `/api/liekan/websites/${seed.website.id}/shared-report`;
  const params = { ...seed.range, timezone: 'Asia/Shanghai', chartPeriod: '30d' };
  expect((await api.get(path, { params })).status).toBe(401);
  expect((await user.get(path, { params })).status).toBe(403);
  for (const client of [admin, await share()]) {
    const result = await client.get(path, { params });
    expect(result.status).toBe(200);
    expect(result.body.website.id).toBe(seed.website.id);
    expect(Object.keys(result.body.website).sort()).toEqual(['domain', 'id', 'name']);
    expect(Object.keys(result.body.tables).sort()).toEqual(['cityBody', 'envGrid']);
    expect(Object.keys(result.body.charts).sort()).toEqual([
      'd1',
      'd2',
      'd3',
      'g1',
      'g2',
      'h1',
      'h2',
      'h3',
    ]);
    expect(result.body.meta).toEqual({
      aiCrawlerEnabled: true,
      demo: false,
      canManage: false,
      latestImportAt: null,
      ruleCount: 0,
    });
    expect((await client.get(path, { params: { ...params, resource: 'logs' } })).status).toBe(400);
  }
  const publicClient = await share();
  const settings = `/api/liekan/websites/${seed.website.id}/settings`;
  try {
    expect((await admin.put(settings, { aiCrawlerEnabled: false })).status).toBe(200);
    for (let i = 0; i < 2; i++) {
      const hidden = await publicClient.get(path, { params });
      expect(hidden.status).toBe(200);
      expect(hidden.body.meta.aiCrawlerEnabled).toBe(false);
      expect(hidden.body.states.logs).toBe('unsupported');
      expect(hidden.body.states.catalog).toBe('unsupported');
      expect(hidden.body.cards.some(card => card.label === 'AI 蜘蛛请求')).toBe(false);
      expect(hidden.body.meta.logsConfigured).toBeUndefined();
    }
  } finally {
    expect((await admin.put(settings, { aiCrawlerEnabled: true })).status).toBe(200);
  }
  expect((await publicClient.get(path, { params })).body.meta.aiCrawlerEnabled).toBe(true);
  expect(
    (
      await (
        await share()
      ).get(`/api/liekan/websites/${seed.website2.id}/shared-report`, { params })
    ).status,
  ).toBe(403);
});

test.describe('Liekan evidence and website boundary', () => {
  test.describe.configure({ mode: 'serial' });
  let id = '',
    domain = '';
  const report = (extra: Record<string, string | number> = {}) => ({
    resource: 'logs',
    startAt: Date.now() - 2 * 86400000,
    endAt: Date.now() + 1000,
    timezone: 'Asia/Shanghai',
    ...extra,
  });
  test.beforeAll(async ({ admin }) => {
    const website = await createWebsite(admin);
    id = website.id;
    domain = website.domain;
  });
  test.afterAll(async ({ admin }) => {
    if (id) await deleteWebsite(admin, id);
  });
  test('requires full website access for every owned endpoint', async ({ api, user, share }) => {
    const path = `/api/liekan/websites/${id}`;
    expect((await api.get(`${path}/report`, { params: report() })).status).toBe(401);
    expect((await user.get(`${path}/report`, { params: report() })).status).toBe(403);
    expect((await (await share()).get(`${path}/report`, { params: report() })).status).toBe(401);
    expect((await api.post(`${path}/logs/import`, {})).status).toBe(401);
    expect((await api.put(`${path}/catalog`, {})).status).toBe(401);
    expect((await api.put(`${path}/settings`, {})).status).toBe(401);
  });
  test('serves an aggregate shared overview to authorized website readers', async ({
    api,
    user,
    admin,
  }) => {
    const url = `/api/liekan/websites/${id}/shared-report`;
    const params = {
      startAt: Date.now() - 86400000,
      endAt: Date.now() + 1000,
      timezone: 'Asia/Shanghai',
    };
    expect((await api.get(url, { params })).status).toBe(401);
    expect((await user.get(url, { params })).status).toBe(403);
    const response = await admin.get(url, { params });
    expect(response.status).toBe(200);
    expect(response.body.website.id).toBe(id);
    expect(response.body.tables.logBody).toBeUndefined();
  });
  test('enforces rule classes and separates missing evidence from zero', async ({ admin }) => {
    const path = `/api/liekan/websites/${id}`;
    const empty = await admin.get(`${path}/report`, { params: report() });
    expect(empty.status).toBe(200);
    expect(empty.body.states.logs).toBe('not_connected');
    expect(empty.body.charts.d2.series).toEqual([]);
    const settings = await admin.get(`${path}/settings`);
    expect(settings.status).toBe(200);
    expect(
      (
        await admin.put(`${path}/settings`, {
          rules: [{ name: 'x', vendor: 'x', type: 'x'.repeat(31), pattern: 'x' }],
        })
      ).status,
    ).toBe(400);
    const { robots, allowlist, rules } = settings.body;
    expect((await admin.put(`${path}/settings`, { robots, allowlist, rules })).status).toBe(200);
    expect(
      (
        await admin.put(`${path}/catalog`, {
          format: 'sitemap',
          content: `<sitemapindex><sitemap><loc>https://${domain}/sitemap.xml</loc></sitemap></sitemapindex>`,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await admin.put(`${path}/catalog`, {
          format: 'json',
          content: JSON.stringify([
            { path: '/a', updatedAt: '2026-01-01', linkDepth: 3, source: 'API fixture' },
          ]),
        })
      ).body.accepted,
    ).toBe(1);
  });
  test('imports partial batches, deduplicates and paginates with stable cursors', async ({
    admin,
  }) => {
    const path = `/api/liekan/websites/${id}`;
    const now = Date.now() - 20000;
    const records = Array.from({ length: 150 }, (_, index) => ({
      time: new Date(now + index).toISOString(),
      ip: '203.0.113.9',
      method: 'GET',
      path: index === 0 ? '/literal_%' : '/plain',
      status: index % 4 === 0 ? 404 : 200,
      userAgent: 'GPTBot/1.0',
    }));
    const input = { format: 'json', records: [...records, null] };
    const result = await admin.post(`${path}/logs/import`, input);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ accepted: 150, rejected: 1, inserted: 150 });
    expect(result.body.errors[0].line).toBe(151);
    expect((await admin.post(`${path}/logs/import`, input)).body).toMatchObject({
      duplicate: true,
      inserted: 0,
    });
    const first = await admin.get(`${path}/report`, { params: report() });
    expect(first.status).toBe(200);
    expect(first.body.tables.logBody).toHaveLength(100);
    const second = await admin.get(`${path}/report`, {
      params: report({ page: 2, cursor: first.body.meta.nextCursor }),
    });
    expect(second.status).toBe(200);
    expect(second.body.tables.logBody).toHaveLength(50);
    expect(
      new Set([...first.body.tables.logBody, ...second.body.tables.logBody].map(r => r.recordId))
        .size,
    ).toBe(150);
    const back = await admin.get(`${path}/report`, {
      params: report({ page: 1, cursor: second.body.meta.previousCursor, seek: 'before' }),
    });
    expect(back.body.tables.logBody.map(r => r.recordId)).toEqual(
      first.body.tables.logBody.map(r => r.recordId),
    );
    for (const search of ['_', '%']) {
      const matching = await admin.get(`${path}/report`, { params: report({ search }) });
      expect(matching.body.meta.totalLogs).toBe(1);
      expect(matching.body.tables.logBody[0].path).toBe('/literal_%');
    }
    const status = await admin.get(`${path}/report`, { params: report({ search: '404' }) });
    expect(status.body.meta.totalLogs).toBe(38);
    expect((await admin.get(`${path}/report`, { params: report({ cursor: 'bad' }) })).status).toBe(
      400,
    );
  });
  test('merges independent settings edits and honors an explicitly empty rule list', async ({
    admin,
    user,
  }) => {
    const path = `/api/liekan/websites/${id}`;
    const initial = await admin.get(`${path}/settings`);
    expect(initial.status).toBe(200);
    for (const invalid of [{}, { isDemo: true }, { robots: '', unexpected: '' }])
      expect((await admin.put(`${path}/settings`, invalid)).status).toBe(400);
    expect((await user.put(`${path}/settings`, { rules: [] })).status).toBe(403);
    const rule = { name: 'FixtureBot', vendor: 'Fixture', type: '搜索', pattern: 'FixtureBot' };
    const results = await Promise.all([
      admin.put(`${path}/settings`, { rules: [rule] }),
      admin.put(`${path}/settings`, { robots: 'User-agent: *\nDisallow: /private' }),
    ]);
    expect(results.map(result => result.status)).toEqual([200, 200]);
    expect((await admin.get(`${path}/settings`)).body).toMatchObject({
      robots: 'User-agent: *\nDisallow: /private',
      rules: [rule],
      isDemo: initial.body.isDemo,
    });
    const cleared = await admin.put(`${path}/settings`, { rules: [] });
    expect(cleared.status).toBe(200);
    expect(cleared.body.rules).toEqual([]);
    expect((await admin.get(`${path}/settings`)).body.rules).toEqual([]);
    const imported = await admin.post(`${path}/logs/import`, {
      format: 'json',
      records: [
        {
          time: new Date().toISOString(),
          ip: '192.0.2.9',
          path: '/rules-cleared',
          status: 200,
          userAgent: 'GPTBot/1.0',
        },
      ],
    });
    expect(imported.status).toBe(200);
    const log = await admin.get(`${path}/report`, { params: report({ search: '/rules-cleared' }) });
    expect(log.status).toBe(200);
    expect(log.body.tables.logBody).toHaveLength(1);
    expect(log.body.tables.logBody[0]).toMatchObject({ bot: '其他', botType: '其他' });
    const { robots, allowlist, rules } = initial.body;
    expect((await admin.put(`${path}/settings`, { robots, allowlist, rules })).status).toBe(200);
  });
  test('preserves catalog evidence across sitemap and partial metadata imports', async ({
    admin,
  }) => {
    const path = `/api/liekan/websites/${id}`;
    const updatedAt = new Date(Date.now() - 5 * 86400000).toISOString();
    const rich = await admin.put(`${path}/catalog`, {
      format: 'json',
      content: JSON.stringify([
        {
          path: '/plain',
          title: 'Fixture page',
          type: '文章',
          wordCount: 500,
          structureScore: 75,
          structured: true,
          updatedAt,
          linkDepth: 2,
          source: 'API evidence fixture',
        },
      ]),
    });
    expect(rich.status).toBe(200);
    const before = await admin.get(`${path}/report`, { params: report() });
    expect(before.status).toBe(200);
    expect(before.body.charts.pf2.rows).toContainEqual(
      expect.objectContaining({ path: '/plain', words: 500, structureScore: 75 }),
    );
    const sitemap = await admin.put(`${path}/catalog`, {
      format: 'sitemap',
      content: `<urlset><url><loc>https://${domain}/plain</loc></url><url><loc>https://${domain}/sitemap-new</loc></url></urlset>`,
    });
    expect(sitemap.status).toBe(200);
    expect(sitemap.body.accepted).toBe(2);
    const preserved = await admin.get(`${path}/report`, { params: report() });
    expect(preserved.status).toBe(200);
    expect(preserved.body.charts.pf2.rows).toContainEqual(
      expect.objectContaining({ path: '/plain', words: 500, structureScore: 75 }),
    );
    expect(preserved.body.charts.pf1.labels).toContain('文章');
    expect(preserved.body.charts.pf1.labels).toContain('未分类');
    expect(preserved.body.tables.apBody.find(row => row.path === '/plain').freshness).toBe(
      before.body.tables.apBody.find(row => row.path === '/plain').freshness,
    );
    const partial = await admin.put(`${path}/catalog`, {
      format: 'json',
      content: JSON.stringify([{ path: '/plain', wordCount: 750 }]),
    });
    expect(partial.status).toBe(200);
    const updated = await admin.get(`${path}/report`, { params: report() });
    expect(updated.status).toBe(200);
    expect(updated.body.charts.pf2.rows).toContainEqual(
      expect.objectContaining({ path: '/plain', words: 750, structureScore: 75 }),
    );
    const clear = await admin.put(`${path}/catalog`, {
      format: 'json',
      content: JSON.stringify([{ path: '/plain', structureScore: null, updatedAt: null }]),
    });
    expect(clear.status).toBe(200);
    const cleared = await admin.get(`${path}/report`, { params: report() });
    expect(cleared.status).toBe(200);
    expect(cleared.body.charts.pf2.rows.some(row => row.path === '/plain')).toBe(false);
    expect(cleared.body.tables.apBody.find(row => row.path === '/plain').freshness).toBeNull();
  });
  test('keeps installation metadata readable and persists setup changes', async ({ admin }) => {
    const path = `/api/liekan/websites/${id}/installation`;
    const before = await admin.get(path);
    expect(before.status).toBe(200);
    expect(before.body.canManage).toBe(true);
    expect(before.body.logs.total).toBeGreaterThan(0);
    const saved = await admin.post(path, { action: 'select-method', method: 'manual' });
    expect(saved.status).toBe(200);
    expect(saved.body.progress).toMatchObject({ method: 'manual', lastStep: 'logs' });
    const after = await admin.get(path);
    expect(after.body.progress).toEqual(saved.body.progress);
    expect(after.body.logs.total).toBe(before.body.logs.total);
  });

  test('clears statistics on reset and removes owned evidence on UUID reuse', async ({ admin }) => {
    const path = `/api/liekan/websites/${id}`;
    expect((await admin.post(`/api/websites/${id}/reset`, {})).status).toBe(200);
    const reset = await admin.get(`${path}/report`, { params: report() });
    expect(reset.body.meta.totalLogs).toBe(0);
    expect(reset.body.states.catalog).toBe('available');
    await deleteWebsite(admin, id);
    await createWebsite(admin, { id, domain });
    const fresh = await admin.get(`${path}/report`, { params: report() });
    expect(fresh.body.states.catalog).toBe('not_connected');
    expect(fresh.body.meta.latestImportAt).toBeNull();
  });
});

test.describe('Liekan statistics cache', () => {
  test('keeps every page consistent with the complete report and shares concurrent reads', async ({
    admin,
    seed,
  }) => {
    const path = `/api/liekan/websites/${seed.website.id}`;
    const params = { ...seed.range, timezone: 'Asia/Shanghai' };
    const full = await admin.get(`${path}/report`, { params: { ...params, resource: 'overview' } });
    expect(full.status).toBe(200);
    for (const [resource, parts] of Object.entries(pageReportParts).filter(
      ([resource]) => resource !== 'human/keywords',
    )) {
      const page = await admin.get(`${path}/page-report`, { params: { ...params, resource } });
      expect(page.status, resource).toBe(200);
      expect(page.body.cards).toEqual(
        full.body.cards.filter(card => parts.cards.includes(card.label as never)),
      );
      for (const name of parts.charts)
        expect(page.body.charts[name], `${resource}:${name}`).toEqual(full.body.charts[name]);
      for (const name of parts.tables)
        expect(page.body.tables[name], `${resource}:${name}`).toEqual(full.body.tables[name]);
    }
    const range = { ...params, startAt: params.startAt + 7, resource: 'overview' };
    const concurrent = await Promise.all(
      Array.from({ length: 10 }, () => admin.get(`${path}/page-report`, { params: range })),
    );
    expect(concurrent.every(row => row.status === 200)).toBe(true);
    expect(concurrent.filter(row => row.headers['x-liekan-cache'] === 'miss')).toHaveLength(1);
    expect(new Set(concurrent.map(row => row.body.meta.generatedAt)).size).toBe(1);
    const warm = await admin.get(`${path}/page-report`, { params: range });
    expect(warm.headers['x-liekan-cache']).toBe('hit');
    expect(warm.body.meta.expiresAt).toBe(concurrent[0].body.meta.expiresAt);
    const fresh = await admin.get(`${path}/page-report`, { params: { ...range, refresh: '1' } });
    expect(fresh.headers['x-liekan-cache']).toBe('miss');
    expect(fresh.body.meta.generatedAt).toBeGreaterThan(warm.body.meta.generatedAt);
    const expanded = await admin.get(`/api/websites/${seed.website.id}/metrics/expanded`, {
      params: { ...params, type: 'path' },
    });
    expect(expanded.status).toBe(200);
    expect(expanded.body.length).toBeGreaterThan(0);
    expect(Number(expanded.headers['x-liekan-expires-at'])).toBeGreaterThan(0);
  });

  test('invalidates writes and checks revoked access before returning cached statistics', async ({
    admin,
    user,
    api,
    share,
    seed,
  }) => {
    const website = await createWebsite(user);
    const path = `/api/liekan/websites/${website.id}`;
    const params = {
      startAt: Date.now() - 86400000,
      endAt: Date.now() + 1000,
      timezone: 'Asia/Shanghai',
      resource: 'ai/pages',
    };
    try {
      for (const client of [api, await share()]) {
        expect((await client.get(`${path}/page-report`, { params })).status).toBe(401);
        expect(
          (
            await client.get('/api/liekan/websites/summary', {
              params: { ...params, ids: website.id },
            })
          ).status,
        ).toBe(401);
      }
      expect((await user.get(`${path}/page-report`, { params })).body.states.catalog).toBe(
        'not_connected',
      );
      expect((await user.get(`${path}/page-report`, { params })).headers['x-liekan-cache']).toBe(
        'hit',
      );
      expect(
        (
          await user.post(`${path}/logs/import`, {
            format: 'json',
            records: [
              {
                time: new Date(params.endAt - 1000).toISOString(),
                ip: '203.0.113.9',
                method: 'GET',
                path: '/seen',
                status: 200,
                userAgent: 'GPTBot/1.0',
              },
            ],
          })
        ).status,
      ).toBe(200);
      const imported = await user.get(`${path}/page-report`, { params });
      expect(imported.headers['x-liekan-cache']).toBe('miss');
      expect(imported.body.states.logs).toBe('available');
      expect(
        (
          await user.put(`${path}/catalog`, {
            format: 'json',
            content: JSON.stringify([{ path: '/new-page' }]),
          })
        ).status,
      ).toBe(200);
      const updated = await user.get(`${path}/page-report`, { params });
      expect(updated.headers['x-liekan-cache']).toBe('miss');
      expect(updated.body.states.catalog).toBe('available');
      expect(updated.body.tables.blindList).toContainEqual(
        expect.objectContaining({ path: '/new-page' }),
      );
      const summary = await user.get('/api/liekan/websites/summary', {
        params: { ...params, ids: website.id },
      });
      expect(summary.status).toBe(200);
      expect(
        (await admin.post(`/api/websites/${website.id}/transfer`, { userId: seed.admin.id }))
          .status,
      ).toBe(200);
      expect((await user.get(`${path}/page-report`, { params })).status).toBe(403);
      expect(
        (await user.get('/api/liekan/websites/summary', { params: { ...params, ids: website.id } }))
          .status,
      ).toBe(403);
      expect((await admin.get(`${path}/page-report`, { params })).status).toBe(200);
    } finally {
      await deleteWebsite(admin, website.id);
    }
  });
});
