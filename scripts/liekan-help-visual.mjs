import { isolatedAcceptanceTarget, acceptanceSeedFile } from './liekan-acceptance-target.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.env.LIEKAN_URL || 'http://127.0.0.1:3302';
const target = isolatedAcceptanceTarget(base);
const out = 'test-results/liekan-help';
fs.mkdirSync(out, { recursive: true });
const seedFile = acceptanceSeedFile(target);
const credentials = fs.existsSync(seedFile)
  ? JSON.parse(fs.readFileSync(seedFile, 'utf8')).admin
  : {
      username: process.env.LIEKAN_HELP_USERNAME || 'admin',
      password: process.env.LIEKAN_HELP_PASSWORD || 'liekan',
    };
const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(credentials),
});
assert.equal(login.status, 200, 'Help validation login failed; credentials withheld');
const { token } = await login.json();
assert(token, 'Complete login token required');
const report = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  passed: false,
  checks: [],
  errors: [],
};
const browser = await chromium.launch({
  headless: true,
  ...(!process.env.CI ? { channel: 'chrome' } : {}),
});
async function run(name, check) {
  await check();
  report.checks.push({ name, passed: true });
  fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
}
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: 'zh-CN',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await context.addInitScript(
    value => localStorage.setItem('umami.auth', JSON.stringify(value)),
    token,
  );
  context.setDefaultTimeout(20000);
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await run('global-navigation-and-search', async () => {
    await page.goto(base + '/liekan/help');
    await page.getByRole('heading', { name: '使用指南与参考资料' }).waitFor();
    assert.equal(await page.locator('[data-help-center]').count(), 1);
    assert.equal(await page.locator('nav[aria-label="帮助分类"] a').count(), 6);
    assert.equal(
      await page.locator('#liekan-navigation a[aria-current="page"]').textContent(),
      '帮助中心',
    );
    assert.equal(await page.locator('.date-btn').count(), 0);
    const search = page.getByRole('searchbox', { name: '搜索帮助文档或蜘蛛' });
    await search.fill('openai GPTBot');
    const link = page
      .getByRole('region', { name: '蜘蛛结果' })
      .getByRole('link', { name: /GPTBot/ });
    assert.equal(await link.count(), 1);
    await link.click();
    await page.getByRole('heading', { name: 'GPTBot', exact: true }).waitFor();
    assert.match(page.url(), /crawler=gptbot/);
    await page.getByText(/查看 \d+ 个公开 CIDR 网段/).click();
    assert(await page.locator('details[open] pre').textContent());
  });
  await run('copy-and-download-draft', async () => {
    await page.getByRole('button', { name: '复制', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '已复制配置草稿' }).waitFor();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    assert(clipboard.includes('User-agent: GPTBot') && clipboard.includes('Configuration draft'));
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载草稿' }).click();
    const file = await download;
    assert.equal(file.suggestedFilename(), 'gptbot-robots-draft.txt');
    assert.equal(fs.readFileSync(await file.path(), 'utf8'), clipboard);
  });
  await run('filters-deep-links-and-history', async () => {
    await page.getByRole('link', { name: '‹ 返回全球蜘蛛目录' }).click();
    await page.getByLabel('类型', { exact: true }).selectOption('control');
    assert.equal(await page.getByRole('region', { name: '蜘蛛结果' }).locator('li').count(), 3);
    await page
      .getByRole('region', { name: '蜘蛛结果' })
      .getByRole('link', { name: /Google-Extended/ })
      .click();
    await page.getByRole('heading', { name: 'Google-Extended', exact: true }).waitFor();
    assert.equal(await page.getByText('无独立 UA', { exact: true }).count(), 1);
    await page.reload();
    await page.getByRole('heading', { name: 'Google-Extended', exact: true }).waitFor();
    await page.goBack();
    await page.getByLabel('类型', { exact: true }).waitFor();
    await page.goForward();
    await page.getByRole('heading', { name: 'Google-Extended', exact: true }).waitFor();
  });
  await run('invalid-and-pending-evidence', async () => {
    await page.goto(base + '/liekan/help?article=removed');
    await page.getByRole('heading', { name: '未找到这份资料' }).waitFor();
    await page.getByRole('link', { name: '返回帮助中心', exact: true }).click();
    await page.getByRole('heading', { name: '使用指南与参考资料' }).waitFor();
    await page.getByRole('searchbox').fill('PetalBot');
    await page.getByRole('region', { name: '蜘蛛结果' }).getByRole('link').click();
    await page.getByRole('heading', { name: 'PetalBot', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '复制', exact: true }).count(), 0);
    assert.equal(await page.getByText('资料待复核', { exact: true }).count(), 1);
  });
  for (const width of [1440, 768, 375, 320]) {
    await run(`layout-and-keyboard-${width}`, async () => {
      // Viewport changes are confined to a new, isolated browser context.
      const responsive = await browser.newContext({
        viewport: { width, height: 1000 },
        locale: 'zh-CN',
      });
      try {
        await responsive.addInitScript(
          value => localStorage.setItem('umami.auth', JSON.stringify(value)),
          token,
        );
        const view = await responsive.newPage();
        view.on('pageerror', error => report.errors.push(error.message));
        for (const [state, path] of [
          ['home', ''],
          ['directory', '?section=crawlers'],
          ['article', '?article=manual-logs'],
          ['crawler', '?crawler=google-extended'],
        ]) {
          await view.goto(base + '/liekan/help' + path);
          await view.locator('[data-help-center]').waitFor();
          await view.evaluate(() => document.fonts.ready);
          assert(
            await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            `Horizontal overflow ${width} ${state}`,
          );
          const box = await view.locator('[data-help-center]').boundingBox();
          assert(
            box.width > 0 && box.x + box.width <= width + 1,
            `Help outside viewport ${width} ${state}`,
          );
          const search = view.getByRole('searchbox');
          await search.focus();
          await view.keyboard.type('不存在的资料-query');
          await view.getByRole('heading', { name: '没有匹配的资料' }).waitFor();
          await view.keyboard.press('Tab');
          assert.equal(await view.evaluate(() => document.activeElement.textContent), '清空');
          await view.keyboard.press('Enter');
          await view.screenshot({ path: `${out}/${width}-${state}.png`, fullPage: true });
        }
      } finally {
        await responsive.close();
      }
    });
  }
  await run('login-required', async () => {
    const anonymous = await browser.newContext();
    try {
      const view = await anonymous.newPage();
      await view.goto(base + '/liekan/help');
      await view.waitForURL(/\/login/);
      assert.equal(await view.locator('[data-help-center]').count(), 0);
    } finally {
      await anonymous.close();
    }
  });
  await context.close();
  assert.deepEqual(report.errors, [], 'Help produced browser errors');
  report.passed = true;
} finally {
  await browser.close();
  fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
}
console.log(
  JSON.stringify({ passed: report.passed, checks: report.checks.length, responsive: 16 }),
);
