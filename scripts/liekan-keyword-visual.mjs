import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { isolatedAcceptanceTarget, acceptanceSeedFile } from './liekan-acceptance-target.mjs';
import { checkNavigation } from './liekan-navigation-visual.mjs';

const base = process.env.LIEKAN_URL || 'http://127.0.0.1:3302';
const target = isolatedAcceptanceTarget(base);
const seed = JSON.parse(fs.readFileSync(acceptanceSeedFile(target), 'utf8'));
const baseline = JSON.parse(fs.readFileSync('config/liekan/navigation-ui.json', 'utf8'));
const reference = JSON.parse(fs.readFileSync('config/liekan/keyword-ui.json', 'utf8'));
const html = fs.readFileSync(`${reference.directory}/keywords.html`, 'utf8');
assert.equal(createHash('sha256').update(html).digest('hex'), reference.files['keywords.html']);
const out = 'test-results/liekan-keywords';
fs.mkdirSync(out, { recursive: true });
let token;
async function api(method, path, body) {
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
  return response.json();
}
token = (await api('POST', '/auth/login', seed.admin)).token;
const website = await api('POST', '/websites', {
  name: '来源关键词（隔离验收）',
  domain: 'keyword-visual.test',
});
const now = Date.now(),
  range = { startAt: now - 600000, endAt: now + 3600000 };
const report = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  passed: false,
  checks: [],
  cleanup: false,
};
let browser;
let visitCount = 51;
try {
  const values = [
    ...Array.from({ length: 45 }, (_, i) => `word${String(i).padStart(2, '0')}`),
    '超长关键词'.repeat(40),
    'person@example.test',
  ];
  for (const [i, term] of values.entries())
    await api('POST', '/send', {
      type: 'event',
      payload: {
        website: website.id,
        hostname: website.domain,
        url: term.startsWith('超长关键词')
          ? '/?utm_source=google&utm_term=' + encodeURIComponent(term)
          : '/',
        referrer: term.startsWith('超长关键词')
          ? 'https://www.google.com/'
          : 'https://www.google.com/search?q=' + encodeURIComponent(term),
        id: `keyword-visual-${i}`,
      },
    });
  for (const [i, referrer] of [
    'https://cn.bing.com/',
    'https://www.baidu.com/link?url=opaque&wd=',
    'https://www.so.com/link?m=opaque',
    'https://www.sogou.com/link?url=opaque',
  ].entries())
    await api('POST', '/send', {
      type: 'event',
      payload: {
        website: website.id,
        hostname: website.domain,
        url: '/',
        referrer,
        id: `keyword-status-visual-${i}`,
      },
    });
  browser = await chromium.launch({
    headless: true,
    ...(!process.env.CI ? { channel: 'chrome' } : {}),
  });
  for (const width of [1440, 900, 390]) {
    // Context viewport belongs to this isolated headless browser only.
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      locale: 'zh-CN',
      reducedMotion: 'reduce',
      acceptDownloads: true,
    });
    const page = await context.newPage();
    await page.goto(base + '/login');
    await page.locator('input[name=username]').fill(seed.admin.username);
    await page.locator('input[name=password]').fill(seed.admin.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL(url => !url.pathname.startsWith('/login'));
    const reads = [];
    page.on('response', response => {
      if (response.url().includes('/page-report?') && response.ok()) reads.push(response.url());
    });
    await page.goto(
      `${base}/websites/${website.id}/geo/human/keywords?date=range:${range.startAt}:${range.endAt}`,
    );
    await page.getByRole('heading', { name: '来源关键词明细' }).waitFor();
    await page.getByRole('button', { name: '导出全部筛选结果' }).waitFor();
    await page.waitForFunction(() =>
      document.querySelector('main tbody')?.textContent.includes('word'),
    );
    await checkNavigation(page, baseline.geo['human-keywords'], width, baseline);
    const columns = await page.locator('main thead th').allTextContents();
    assert.deepEqual(
      columns.map(value => value.replace(/[↑↓]/g, '').trim()),
      reference.columns,
    );
    const styles = await page
      .locator('main > section:first-child .card')
      .first()
      .evaluate(element => {
        const s = getComputedStyle(element);
        return { background: s.backgroundColor, border: s.borderTopColor, radius: s.borderRadius };
      });
    const ref = await context.newPage();
    await ref.setContent(html);
    const expected = await ref
      .locator('.metric')
      .first()
      .evaluate(element => {
        const s = getComputedStyle(element);
        return { background: s.backgroundColor, border: s.borderTopColor, radius: s.borderRadius };
      });
    assert.deepEqual(styles, expected);
    await ref.screenshot({ path: `${out}/reference-${width}.png`, fullPage: true });
    await ref.close();
    assert.equal(await page.locator('main script').count(), 0);
    assert(!(await page.locator('main').textContent()).includes('person@example.test'));
    await page.getByLabel('关键词查询', { exact: true }).fill('word44');
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('main tbody')?.textContent.includes('word44') &&
        document.querySelectorAll('main tbody tr').length === 1,
    );
    assert(
      (await page.locator('main > section:first-child').textContent()).includes(String(visitCount)),
    );
    await page.getByLabel('关键词查询', { exact: true }).fill('word');
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('main')?.textContent.includes('共 45 行'),
    );
    await page.getByRole('button', { name: '关键词 / 状态', exact: false }).click();
    await page.waitForFunction(
      () => document.querySelector('main th')?.getAttribute('aria-sort') === 'descending',
    );
    await page.getByRole('button', { name: '关键词 / 状态', exact: false }).click();
    await page.waitForFunction(() =>
      document.querySelector('main tbody')?.textContent.includes('word00'),
    );
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('main tbody')?.textContent.includes('word20') &&
        !document.querySelector('main tbody')?.textContent.includes('word00'),
    );
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出全部筛选结果', exact: true }).click();
    const download = await downloadPromise;
    const csv = fs.readFileSync(await download.path(), 'utf8');
    assert(csv.includes('word00') && csv.includes('word44') && csv.includes('统计读取时间'));
    const baselineReads = reads.length;
    await page.bringToFront();
    await page.waitForTimeout(1200);
    assert.equal(reads.length, baselineReads, 'Focus triggered an automatic keyword read');
    // Each viewport shares the same user and aggregation base, including its refresh cooldown.
    await page.waitForTimeout(5100);
    const unchangedRead = page.waitForResponse(
      response => response.url().includes('/page-report?') && response.url().includes('refresh=1'),
    );
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    assert.equal((await unchangedRead).status(), 200, 'Unchanged snapshot refresh failed');
    await page.waitForFunction(() =>
      document.querySelector('main')?.textContent.includes('第 2 / 3 页'),
    );
    await page.waitForTimeout(5100);
    await api('POST', '/send', {
      type: 'event',
      payload: {
        website: website.id,
        hostname: website.domain,
        url: '/',
        referrer: 'https://www.google.com/search?q=word00',
        id: `keyword-refresh-${width}`,
      },
    });
    visitCount++;
    const changedRead = page.waitForResponse(
      response => response.url().includes('/page-report?') && response.url().includes('refresh=1'),
    );
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    assert.equal((await changedRead).status(), 200, 'Changed snapshot refresh failed');
    await page.waitForFunction(() =>
      document.querySelector('main')?.textContent.includes('第 1 / 3 页'),
    );
    assert(reads.length > baselineReads);
    await page.getByRole('button', { name: '重置筛选', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('main')?.textContent.includes('共 51 行'),
    );
    for (const [status, label] of Object.entries(reference.statusLabels))
      assert.equal(await page.locator(`option[value="${status}"]`).textContent(), label);
    await page.getByLabel('关键词状态', { exact: true }).selectOption('redirect');
    await page.waitForFunction(
      () =>
        document.querySelectorAll('main tbody tr').length === 3 &&
        [...document.querySelectorAll('main tbody tr td:first-child')].every(cell =>
          cell.textContent.includes('跳转链接无可用搜索词'),
        ),
    );
    assert(
      (await page.locator('main > section:first-child').textContent()).includes(String(visitCount)),
    );
    const statusDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出全部筛选结果', exact: true }).click();
    const statusCsv = fs.readFileSync(await (await statusDownloadPromise).path(), 'utf8');
    assert(statusCsv.includes(reference.statusLabels.redirect));
    assert(statusCsv.includes('百度') && statusCsv.includes('360') && statusCsv.includes('搜狗'));
    assert(!statusCsv.includes('opaque'));
    await page.screenshot({ path: `${out}/keyword-statuses-${width}.png`, fullPage: true });
    await page.getByLabel('关键词状态', { exact: true }).selectOption('missing');
    await page.waitForFunction(
      () =>
        document.querySelectorAll('main tbody tr').length === 1 &&
        document.querySelector('main tbody')?.textContent.includes('来源未携带搜索词'),
    );
    await page.getByRole('button', { name: '重置筛选', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('main')?.textContent.includes('共 51 行'),
    );
    await page.getByLabel('关键词查询', { exact: true }).fill('未提交的查询');
    await page.getByRole('button', { name: '重置筛选', exact: true }).click();
    assert.equal(await page.getByLabel('关键词查询', { exact: true }).inputValue(), '');
    await page.getByLabel('关键词查询', { exact: true }).fill('超长关键词');
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll('main tbody tr').length === 1 &&
        document.querySelector('main tbody')?.textContent.includes('超长关键词'),
    );
    const geometry = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      table: document.querySelector('main table').scrollWidth,
      scroller: document.querySelector('main table').parentElement.clientWidth,
    }));
    assert(geometry.document <= geometry.viewport + 1, `Page overflows at ${width}`);
    if (width < 900)
      assert(geometry.table > geometry.scroller, 'Narrow table did not scroll within its card');
    await page.screenshot({ path: `${out}/keywords-${width}.png`, fullPage: true });
    report.checks.push({
      width,
      styles,
      geometry,
      completeExport: true,
      manualRefresh: true,
      serverSearch: true,
      pagination: true,
      resetDraft: true,
      keywordStatusFilters: true,
      keywordStatusExport: true,
    });
    await context.close();
  }
  report.passed = true;
} finally {
  await browser?.close();
  await api('DELETE', `/websites/${website.id}`);
  report.cleanup = true;
  fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
}
console.log(
  JSON.stringify({
    passed: report.passed,
    checks: report.checks.length,
    cleanup: report.cleanup,
    report: `${out}/report.json`,
  }),
);
