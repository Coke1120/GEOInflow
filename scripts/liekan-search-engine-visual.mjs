import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { retimeBrowserFixtures } from '../tests/api/seed/retime.ts';
import { isolatedAcceptanceTarget, acceptanceSeedFile } from './liekan-acceptance-target.mjs';
import { checkNavigation } from './liekan-navigation-visual.mjs';

const base = process.env.LIEKAN_URL || 'http://127.0.0.1:3302';
const target = isolatedAcceptanceTarget(base);
const seed = JSON.parse(fs.readFileSync(acceptanceSeedFile(target), 'utf8'));
const baseline = JSON.parse(fs.readFileSync('config/liekan/navigation-ui.json', 'utf8'));
const reference = JSON.parse(fs.readFileSync('config/liekan/search-engine-ui.json', 'utf8'));
const html = fs.readFileSync(`${reference.directory}/engines.html`, 'utf8');
assert.equal(createHash('sha256').update(html).digest('hex'), reference.files['engines.html']);
const out = 'test-results/liekan-search-engines';
fs.mkdirSync(out, { recursive: true });
let token, website, browser;
const browserFixtures = [];
async function api(method, path, body) {
  if (method === 'POST' && path === '/send') body.payload.eventId = randomUUID();
  const response = await fetch(base + '/api' + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(method === 'POST' && path === '/send'
        ? {
            'x-liekan-fixture-ip': '192.0.2.1',
            'user-agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          }
        : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(response.status, 200, `${method} ${path}: ${response.status}`);
  if (method === 'POST' && path === '/send')
    browserFixtures.push({
      websiteId: body.payload.website,
      eventId: body.payload.eventId,
      at: Math.floor((now - 7 * 60000) / 1000),
      splitVisits: false,
    });
  return response.json();
}
const report = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  passed: false,
  checks: [],
  cleanup: false,
};
const now = Date.now();
const range = { startAt: now - 600000, endAt: now + 3600000, timezone: 'UTC' };
try {
  token = (await api('POST', '/auth/login', seed.admin)).token;
  website = await api('POST', '/websites', {
    name: '搜索引擎（隔离验收）',
    domain: 'engine-visual.test',
  });
  const hosts = [
    'www.google.com',
    'cn.bing.com',
    'www.baidu.com',
    'www.sogou.com',
    'www.so.com',
    'duckduckgo.com',
    'search.yahoo.com',
    'chatgpt.com',
    'perplexity.ai',
    'claude.ai',
    'gemini.google.com',
    'copilot.microsoft.com',
    'doubao.com',
    'kimi.com',
    'yiyan.baidu.com',
    'chat.deepseek.com',
    'chat.openai.com',
    'kimi.moonshot.cn',
  ];
  for (const [index, host] of hosts.entries())
    await api('POST', '/send', {
      type: 'event',
      payload: {
        website: website.id,
        hostname: website.domain,
        url: '/',
        referrer: `https://${host}/`,
        id: `engine-visual-${index}`,
      },
    });
  for (const [id, url, referrer] of [
    ['utm', '/?utm_source=chatgpt', 'https://www.google.com/'],
    ['email', '/?utm_source=google&utm_medium=email', 'https://www.google.com/'],
    ['direct', '/', ''],
  ])
    await api('POST', '/send', {
      type: 'event',
      payload: {
        website: website.id,
        hostname: website.domain,
        id: `engine-${id}`,
        url,
        referrer,
      },
    });
  // Dashboard projections publish closed batches after the ingestion buffer.
  retimeBrowserFixtures(browserFixtures);
  const parameters = new URLSearchParams({ resource: 'human/search-engines', ...range });
  const data = await api('GET', `/liekan/websites/${website.id}/page-report?${parameters}`);
  assert.deepEqual(
    data.cards.map(card => card.value),
    [19, 7, 12, 63.16],
  );
  assert.equal(data.tables.searchEngineBody.length, 16);
  assert.equal(data.tables.searchEngineBody.find(row => row.engine === 'ChatGPT').sessions, 3);
  assert.equal(data.tables.searchEngineBody.find(row => row.engine === 'Kimi').sessions, 2);
  assert(data.tables.searchEngineBody.every(row => row.conversionRate === null));
  const sources = await api(
    'GET',
    `/liekan/websites/${website.id}/page-report?${new URLSearchParams({ resource: 'human/sources', ...range })}`,
  );
  for (const type of ['传统搜索', 'AI 搜索引荐']) {
    const total = sources.tables.srcBody
      .filter(row => row.channel === type)
      .reduce((sum, row) => sum + row.sessions, 0);
    assert.equal(
      data.tables.searchEngineBody
        .filter(row => row.type === type)
        .reduce((sum, row) => sum + row.sessions, 0),
      total,
    );
  }
  browser = await chromium.launch({
    headless: true,
    ...(!process.env.CI ? { channel: 'chrome' } : {}),
  });
  for (const width of [1440, 900, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      locale: 'zh-CN',
      reducedMotion: 'reduce',
      acceptDownloads: true,
    });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + '/login');
      await page.locator('input[name=username]').fill(seed.admin.username);
      await page.locator('input[name=password]').fill(seed.admin.password);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.waitForURL(url => !url.pathname.startsWith('/login'));
      const url = `${base}/websites/${website.id}/geo/human/search-engines?date=range:${range.startAt}:${range.endAt}`;
      await page.goto(url);
      await page.waitForFunction(
        () => document.querySelector('#searchEngineBody')?.querySelectorAll('tr').length === 16,
      );
      await checkNavigation(page, baseline.geo['human-search-engines'], width, baseline);
      assert.deepEqual(
        (await page.locator('main th').allTextContents()).map(text =>
          text.replace(/[↑↓]/g, '').trim(),
        ),
        reference.columns,
      );
      assert.deepEqual(
        (await page.locator('main > section:first-child .num').allTextContents()).map(text =>
          text.trim(),
        ),
        ['19', '7', '12', '63.16%'],
      );
      await page.waitForFunction(() =>
        ['se1', 'se2'].every(id => document.getElementById(id)?.querySelector('canvas')),
      );
      for (const id of reference.charts) {
        const box = await page.locator(`#${id}`).boundingBox();
        assert(box.width > 200 && box.height === 260, `${id} chart geometry`);
        const painted = await page
          .locator(`#${id} canvas`)
          .first()
          .evaluate(canvas => {
            const pixels = canvas
              .getContext('2d')
              .getImageData(0, 0, canvas.width, canvas.height).data;
            let count = 0;
            for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) count++;
            return count;
          });
        assert(painted > 1000, `${id} empty canvas`);
      }
      const ref = await context.newPage();
      await ref.setContent(html);
      const visual = async element =>
        element.evaluate(el => {
          const style = getComputedStyle(el);
          return {
            background: style.backgroundColor,
            border: style.borderTopColor,
            radius: style.borderRadius,
          };
        });
      assert.deepEqual(
        await visual(page.locator('main .card').first()),
        await visual(ref.locator('.metric').first()),
      );
      await ref.close();
      const filters = page.getByRole('group', { name: '搜索类型筛选' });
      await filters.getByRole('button', { name: '传统搜索', exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector('#searchEngineBody')?.querySelectorAll('tr').length === 7,
      );
      assert.equal(
        await filters
          .getByRole('button', { name: '传统搜索', exact: true })
          .getAttribute('aria-pressed'),
        'true',
      );
      await filters.getByRole('button', { name: 'AI 搜索引荐', exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector('#searchEngineBody')?.querySelectorAll('tr').length === 9,
      );
      const downloaded = page.waitForEvent('download');
      await page.getByRole('button', { name: '导出明细', exact: true }).click();
      const download = await downloaded;
      const csv = fs.readFileSync(await download.path(), 'utf8');
      assert.equal(csv.split('\r\n').length, 10);
      assert(csv.includes('ChatGPT') && !csv.includes('Google'));
      await filters.getByRole('button', { name: '全部', exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector('#searchEngineBody')?.querySelectorAll('tr').length === 16,
      );
      await page.getByRole('tab', { name: '来源关键词', exact: true }).click();
      await page.waitForURL(url => url.pathname.endsWith('/keywords'));
      assert.equal(new URL(page.url()).searchParams.has('filter'), false);
      await page.getByRole('tab', { name: '搜索引擎', exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector('#searchEngineBody')?.querySelectorAll('tr').length === 16,
      );
      const dimensions = await page.evaluate(() => ({
        viewport: innerWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      assert(dimensions.scroll <= dimensions.viewport + 1, 'Page overflows the viewport');
      await page.screenshot({ path: `${out}/engines-${width}.png`, fullPage: true });
      assert.deepEqual(errors, []);
      report.checks.push({ width, passed: true, platforms: 16, csvRows: 9, charts: 2 });
    } finally {
      await context.close();
    }
  }
  const empty = await api(
    'GET',
    `/liekan/websites/${website.id}/page-report?${new URLSearchParams({ resource: 'human/search-engines', startAt: 0, endAt: 1, timezone: 'UTC' })}`,
  );
  assert.deepEqual(
    empty.cards.map(card => card.value),
    [0, 0, 0, null],
  );
  assert.equal(empty.charts.se1.state, 'empty');
  assert.equal(empty.charts.se2.state, 'empty');
  report.passed = true;
} finally {
  await browser?.close();
  if (website) await api('DELETE', `/websites/${website.id}`);
  report.cleanup = true;
  fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
