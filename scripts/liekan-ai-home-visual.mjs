import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { isolatedAcceptanceTarget, acceptanceSeedFile } from './liekan-acceptance-target.mjs';

const base = process.env.LIEKAN_URL || 'http://127.0.0.1:3305';
const target = isolatedAcceptanceTarget(base, { aiPreview: true });
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const reference = JSON.parse(fs.readFileSync('config/liekan/ai-ui.json', 'utf8')).chatHome;
for (const [file, digest] of Object.entries(reference.sha256))
  assert.equal(
    createHash('sha256')
      .update(fs.readFileSync(path.join(reference.referenceRoot, file)))
      .digest('hex'),
    digest,
    `AI homepage reference changed: ${file}`,
  );
const seed = JSON.parse(fs.readFileSync(acceptanceSeedFile(target), 'utf8'));
const login = await fetch(base + '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(seed.admin),
});
assert.equal(login.status, 200);
const { token } = await login.json();
const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
const historyResponse = await fetch(base + '/api/liekan/ai/conversations', {
  method: 'POST',
  headers,
  body: JSON.stringify({ websiteId: seed.website.id }),
});
assert.equal(historyResponse.status, 200);
const historyItem = await historyResponse.json();
assert(historyItem.id, 'History validation requires a real conversation');
let browser;
const errors = [];
const out = 'test-results/liekan-ai-home-v3';
const checks = [];
async function style(page, selector) {
  return page
    .locator(selector)
    .first()
    .evaluate(el => {
      const css = getComputedStyle(el),
        box = el.getBoundingClientRect();
      return {
        fontSize: css.fontSize,
        fontWeight: css.fontWeight,
        lineHeight: css.lineHeight,
        borderRadius: css.borderRadius,
        color: css.color,
        background: css.backgroundColor,
        resize: css.resize,
        width: box.width,
        height: box.height,
        top: box.top,
      };
    });
}
try {
  browser = await chromium.launch({
    headless: true,
    ...(!process.env.CI ? { channel: 'chrome' } : {}),
  });
  const context = await browser.newContext({ locale: 'zh-CN', reducedMotion: 'reduce' });
  await context.addInitScript(
    token => localStorage.setItem('umami.auth', JSON.stringify(token)),
    token,
  );
  const actual = await context.newPage(),
    original = await context.newPage();
  actual.on('pageerror', error => errors.push(error.message));
  fs.mkdirSync(out, { recursive: true });
  for (const width of [1440, 1280, 375, 320]) {
    await actual.setViewportSize({ width, height: 1000 });
    await original.setViewportSize({ width, height: 1000 });
    await original.goto(pathToFileURL(path.resolve(reference.referenceRoot, 'agent.html')).href);
    await original.evaluate(() => document.fonts.ready);
    await actual.goto(base + '/liekan/ai-chat');
    await expect(actual.getByLabel('分析网站')).toBeVisible();
    await actual.getByLabel('分析问题').fill('分析最近 7 天的 AI 抓取趋势');
    await actual.getByRole('button', { name: '发起分析', exact: true }).click();
    await expect(actual.getByLabel('分析网站')).toBeFocused();
    await assertPickerFocus('分析网站');
    await actual.getByLabel('分析网站').selectOption(seed.website.id);
    await expect(actual.getByLabel('分析模型')).toBeEnabled();
    await actual.evaluate(() => document.fonts.ready);
    await actual.getByLabel('分析问题').click();
    const focus = await actual.getByLabel('分析问题').evaluate(el => {
      const css = getComputedStyle(el),
        form = getComputedStyle(el.closest('form'));
      return {
        outlineWidth: css.outlineWidth,
        outlineColor: css.outlineColor,
        borderWidth: css.borderWidth,
        formBorder: form.borderTopWidth,
        formColor: form.borderTopColor,
      };
    });
    assert(
      focus.outlineWidth === '0px' || focus.outlineColor === 'rgba(0, 0, 0, 0)',
      'Textarea has a second visible focus frame',
    );
    assert.equal(focus.borderWidth, '0px');
    assert.equal(focus.formBorder, '1px');
    assert.equal(
      focus.formColor,
      'rgb(233, 236, 241)',
      'Composer keeps its light boundary while typing',
    );
    const title = await style(actual, '[data-ai-welcome] h2');
    const referenceTitle = await style(original, '#welcome h1');
    const shortcut = await style(actual, '[aria-labelledby="ai-functions-title"] a');
    const referenceShortcut = await style(original, '.fn-btn');
    const input = await style(actual, 'textarea[aria-label="分析问题"]');
    const referenceInput = await style(original, '#askInput');
    for (const property of ['fontSize', 'fontWeight', 'lineHeight', 'color']) {
      if (width >= 768)
        assert.equal(title[property], referenceTitle[property], `Welcome ${property}`);
      assert.equal(shortcut[property], referenceShortcut[property], `Shortcut ${property}`);
    }
    assert.equal(shortcut.borderRadius, referenceShortcut.borderRadius);
    assert.equal(input.resize, referenceInput.resize);
    if (width >= 768) {
      const page = await style(actual, '[data-liekan-ai="ai-chat"]');
      const referencePage = await style(original, '#chatBody');
      assert(Math.abs(page.width - referencePage.width) <= 1, 'Homepage width matches agent.html');
      assert(
        Math.abs(input.width - referenceInput.width) <= 1,
        'Composer width matches agent.html',
      );
      assert(
        Math.abs(input.height - referenceInput.height) <= 1,
        'Textarea height matches agent.html',
      );
      assert(Math.abs(input.top - referenceInput.top) <= 1, 'Composer top matches agent.html');
      const composer = await style(actual, 'form:has(textarea[aria-label="分析问题"])');
      const referenceComposer = await style(original, '#welcome > .card');
      assert(
        Math.abs(composer.height - referenceComposer.height) <= 1,
        'Composer height matches agent.html',
      );
    }
    assert.equal(await actual.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
    await actual.screenshot({ path: `${out}/home-${width}-focused.png`, fullPage: true });
    await original.screenshot({ path: `${out}/reference-${width}.png`, fullPage: true });
    await actual.keyboard.press('Tab');
    await expect(actual.getByLabel('分析网站')).toBeFocused();
    async function assertPickerFocus(label) {
      const focus = await actual.getByLabel(label).evaluate(el => ({
        outline: getComputedStyle(el).outlineWidth,
        shadow: getComputedStyle(el).boxShadow,
        border: getComputedStyle(el.parentElement).borderTopColor,
      }));
      assert.equal(focus.outline, '0px', `${label} has no additional focus frame`);
      assert.equal(focus.shadow, 'none');
      assert.equal(
        focus.border,
        'rgb(105, 115, 134)',
        `${label} shows focus on its existing boundary`,
      );
    }
    await assertPickerFocus('分析网站');
    await actual.keyboard.press('Tab');
    await actual.keyboard.press('Tab');
    await expect(actual.getByLabel('分析模型')).toBeFocused();
    await assertPickerFocus('分析模型');
    await actual.getByLabel('分析网站').click();
    await actual.keyboard.press('Escape');
    await expect(actual.getByLabel('分析网站')).toBeFocused();
    await assertPickerFocus('分析网站');
    await actual.screenshot({ path: `${out}/home-${width}-website-focused.png`, fullPage: true });
    await actual.getByRole('button', { name: '回答记录', exact: true }).click();
    const history = actual.locator('[data-ai-history] > div');
    await expect(history).toBeVisible();
    await expect(history.locator('button').first()).toContainText(historyItem.title);
    const panel = await history.evaluate(el => {
      const css = getComputedStyle(el),
        box = el.getBoundingClientRect();
      return {
        background: css.backgroundColor,
        position: css.position,
        left: box.left,
        right: box.right,
      };
    });
    assert.equal(panel.background, 'rgb(255, 255, 255)', 'History has an opaque surface');
    assert.equal(panel.position, 'absolute');
    assert(panel.left >= 0 && panel.right <= width, 'History stays within the viewport');
    await actual.screenshot({ path: `${out}/home-${width}-history.png`, fullPage: true });
    await actual.keyboard.press('Escape');
    await expect(history).not.toBeVisible();
    await expect(actual.locator('[data-ai-history] summary')).toBeFocused();
    await actual.getByLabel('分析问题').fill('检查本周的抓取变化');
    await actual.getByLabel('分析问题').press('Shift+Enter');
    assert.equal(await actual.getByRole('dialog').count(), 0, 'Shift+Enter does not send');
    await actual.getByLabel('分析问题').press('Enter');
    const dialog = actual.getByRole('dialog', { name: '配置 AI，开始分析' });
    await expect(dialog).toBeVisible();
    await actual.keyboard.press('Escape');
    await expect(actual.getByLabel('分析问题')).toHaveValue(/检查本周的抓取变化/);
    checks.push({ width, focus: true, reference: true, keyboard: true, overflow: 0 });
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    `${out}/report.json`,
    JSON.stringify({ head, passed: true, checks, errors }, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: true,
      widths: checks.map(row => row.width),
      reference: reference.referenceRoot,
    }),
  );
} finally {
  try {
    await browser?.close();
  } finally {
    const deleted = await fetch(base + '/api/liekan/ai/conversations/' + historyItem.id, {
      method: 'DELETE',
      headers,
    });
    assert(deleted.ok, 'Temporary history fixture was removed');
  }
}
