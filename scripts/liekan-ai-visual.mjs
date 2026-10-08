import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { isolatedAcceptanceTarget, acceptanceSeedFile } from './liekan-acceptance-target.mjs';

const base = process.env.LIEKAN_URL || 'http://127.0.0.1:3302';
const target = isolatedAcceptanceTarget(base, { aiPreview: true });
const manifest = JSON.parse(fs.readFileSync('config/liekan/ai-ui.json', 'utf8'));
for (const [file, digest] of Object.entries(manifest.sha256))
  assert.equal(
    createHash('sha256')
      .update(fs.readFileSync(path.join(manifest.referenceRoot, file)))
      .digest('hex'),
    digest,
    `Approved AI reference changed: ${file}`,
  );
const seed = JSON.parse(fs.readFileSync(acceptanceSeedFile(target), 'utf8'));
const login = await fetch(base + '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(seed.admin),
});
assert.equal(login.status, 200);
const { token } = await login.json();
const catalogResponse = await fetch(base + '/api/liekan/ai/catalog', {
  headers: { authorization: 'Bearer ' + token },
});
assert.equal(catalogResponse.status, 200);
const catalog = await catalogResponse.json();
const out = 'test-results/liekan-ai';
fs.mkdirSync(out, { recursive: true });
const report = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  passed: false,
  moduleEnabled: catalog.module.enabled,
  widths: [1440, 1280, 375, 320],
  checks: [],
  errors: [],
};
const browser = await chromium.launch({
  headless: true,
  ...(!process.env.CI ? { channel: 'chrome' } : {}),
});
const context = await browser.newContext({ locale: 'zh-CN', reducedMotion: 'reduce' });
await context.addInitScript(
  token => localStorage.setItem('umami.auth', JSON.stringify(token)),
  token,
);
const actual = await context.newPage(),
  reference = await context.newPage();
actual.on('pageerror', error => report.errors.push(error.message));
const designRoot = path.resolve('design/prototypes');
await reference.route(base + '/__ai-reference/**', async route => {
  const name = decodeURIComponent(
    new URL(route.request().url()).pathname.slice('/__ai-reference/'.length),
  );
  const file = path.resolve(designRoot, 'liekan-ai-v1', name);
  if (!file.startsWith(designRoot + path.sep) || !fs.existsSync(file)) return route.abort();
  const type =
    {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'text/javascript',
      '.svg': 'image/svg+xml',
      '.woff2': 'font/woff2',
    }[path.extname(file)] || 'application/octet-stream';
  await route.fulfill({ body: fs.readFileSync(file), contentType: type });
});
await reference.route(base + '/liekan-ui-v1/assets/**', async route => {
  const name = decodeURIComponent(
    new URL(route.request().url()).pathname.slice('/liekan-ui-v1/assets/'.length),
  );
  const root = path.resolve(designRoot, 'liekan-ui-v1/assets'),
    file = path.resolve(root, name);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.abort();
  await route.fulfill({
    body: fs.readFileSync(file),
    contentType: file.endsWith('.woff2') ? 'font/woff2' : 'image/svg+xml',
  });
});
async function palette(page, selector) {
  return page.locator(selector).evaluate(el => {
    const style = getComputedStyle(el);
    return Object.fromEntries(
      ['ink', 'sub', 'faint', 'line', 'wash', 'brand', 'selected', 'green', 'red'].map(key => [
        key,
        style
          .getPropertyValue('--' + key)
          .trim()
          .toLowerCase(),
      ]),
    );
  });
}
try {
  for (const width of report.widths) {
    // Each page belongs to this newly launched isolated browser, never a shared user window.
    await actual.setViewportSize({ width, height: 1000 });
    await reference.setViewportSize({ width, height: 1000 });
    for (const id of manifest.scope) {
      await actual.goto(base + `/liekan/${id}`);
      await actual.locator(`[data-liekan-ai="${id}"]`).waitFor();
      await actual.waitForLoadState('networkidle');
      await actual.evaluate(() => document.fonts.ready);
      await reference.goto(base + `/__ai-reference/${id}.html?scene=unconfigured`);
      await reference.locator('h1').waitFor();
      await reference.evaluate(() => document.fonts.ready);
      assert.deepEqual(
        await palette(actual, `[data-liekan-ai="${id}"]`),
        await palette(reference, 'body'),
        `${id}: approved palette`,
      );
      const geometry = await actual.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        overflow: document.documentElement.scrollWidth - innerWidth,
        rootRight: document.documentElement.getBoundingClientRect().right,
        text: document.querySelector('[data-liekan-ai]')?.textContent,
      }));
      assert.equal(geometry.overflow, 0, `${id} ${width}px overflows`);
      assert.equal(geometry.rootRight, width, `${id} root does not reach viewport`);
      assert(geometry.text?.trim(), `${id} is empty`);
      if (!catalog.module.enabled)
        assert(
          /停用|未启用|部署|加密|尚未/.test(geometry.text),
          `${id} deployment state is missing`,
        );
      if (width >= 768) {
        const navigation = await actual.locator('#liekan-navigation').innerText();
        assert(
          navigation.indexOf('快速发起') >= 0 &&
            navigation.indexOf('快速发起') < navigation.indexOf('数据管理'),
        );
        assert(navigation.includes('AI能力') && navigation.includes('AI配置器'));
      }
      if (id === 'ai-chat' && manifest.chatHome) {
        const home = await actual.evaluate(() => {
          const question = document.querySelector('textarea[aria-label="分析问题"]');
          const form = question?.closest('form');
          const site = form?.querySelector('select[aria-label="分析网站"]');
          const send = form?.querySelector('button[aria-label="发起分析"]');
          const siteBox = site?.getBoundingClientRect(),
            sendBox = send?.getBoundingClientRect();
          const section = document.querySelector('[aria-labelledby="ai-functions-title"]');
          return {
            composerSite: !!site,
            leftOfSend: !!siteBox && !!sendBox && siteBox.right <= sendBox.left,
            belowQuestion:
              !!siteBox && !!question && siteBox.top >= question.getBoundingClientRect().bottom,
            functions: section?.querySelectorAll('a,button').length,
            questions: document
              .querySelector('[aria-labelledby="ai-questions-title"]')
              ?.querySelectorAll('button').length,
          };
        });
        assert(
          home.composerSite && home.leftOfSend && home.belowQuestion,
          `chat composer scope at ${width}px`,
        );
        assert.equal(home.functions, manifest.chatHome.shortcuts.length);
        assert.equal(home.questions, manifest.chatHome.questions);
      }
      await actual.screenshot({
        path: `${out}/${id}-${width}-actual.png`,
        fullPage: true,
        animations: 'disabled',
      });
      await reference.screenshot({
        path: `${out}/${id}-${width}-reference.png`,
        fullPage: true,
        animations: 'disabled',
      });
      if (id === 'ai-chat' && manifest.chatHome && catalog.module.enabled) {
        await actual.getByLabel('分析网站').selectOption(seed.website.id);
        await actual.getByLabel('分析模型').waitFor({ state: 'visible' });
        await actual.getByLabel('分析问题').fill('哪些页面值得优先优化？');
        await actual.getByRole('button', { name: '发起分析', exact: true }).click();
        const dialog = actual.getByRole('dialog', { name: '配置 AI，开始分析' });
        await dialog.waitFor({ state: 'visible' });
        const setup = await dialog.evaluate(el => {
          const field = el.querySelector('input[aria-label="API Key"]');
          const style = field && getComputedStyle(field);
          const box = el.getBoundingClientRect();
          return {
            line: getComputedStyle(el).getPropertyValue('--line').trim().toLowerCase(),
            border: style?.borderTopWidth,
            borderStyle: style?.borderTopStyle,
            x: box.x + box.width / 2,
            y: box.y + box.height / 2,
          };
        });
        assert.equal(setup.line, '#e9ecf1', `setup palette at ${width}px`);
        assert.equal(setup.border, '1px', `setup input border at ${width}px`);
        assert.equal(setup.borderStyle, 'solid', `setup input boundary at ${width}px`);
        assert(Math.abs(setup.x - width / 2) <= 2, `setup horizontal center at ${width}px`);
        assert(Math.abs(setup.y - 500) <= 2, `setup vertical center at ${width}px`);
        await actual.screenshot({
          path: `${out}/ai-setup-${width}-actual.png`,
          fullPage: true,
          animations: 'disabled',
        });
        await actual.keyboard.press('Escape');
      }
      report.checks.push({ id, width, passed: true, palette: true, overflow: geometry.overflow });
    }
  }
  assert.equal(report.errors.length, 0, report.errors.join('\n'));
  assert.equal(report.checks.length, manifest.scope.length * report.widths.length);
  report.passed = true;
} catch (error) {
  report.error = error.message;
  throw error;
} finally {
  fs.writeFileSync(out + '/report.json', JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(
  JSON.stringify({
    passed: true,
    head: report.head,
    checks: report.checks.length,
    moduleEnabled: report.moduleEnabled,
    report: out + '/report.json',
  }),
);
