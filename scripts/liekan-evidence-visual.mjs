import { isolatedAcceptanceTarget, acceptanceSeedFile } from './liekan-acceptance-target.mjs';
import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const base = process.env.LIEKAN_URL || 'http://127.0.0.1:3302';
const seed = JSON.parse(
  fs.readFileSync(acceptanceSeedFile(isolatedAcceptanceTarget(base)), 'utf8'),
);
const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(seed.admin),
});
assert.equal(login.status, 200);
const { token } = await login.json();
const out = 'test-results/liekan-evidence';
fs.mkdirSync(out, { recursive: true });
const zh = JSON.parse(fs.readFileSync('src/lib/liekan/i18n/messages/zh-CN.json', 'utf8')),
  en = JSON.parse(fs.readFileSync('src/lib/liekan/i18n/messages/en-US.json', 'utf8'));
const text = (value, locale) =>
  locale === 'zh-CN' ? value : en[Object.keys(zh).find(key => zh[key] === value)] || value;
const result = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  passed: false,
  checks: [],
  errors: [],
  fixtures: [
    'Workflow visual checks use explicitly isolated browser response fixtures; API and database behavior are exercised separately.',
  ],
};
const browser = await chromium.launch({
  headless: true,
  ...(!process.env.CI ? { channel: 'chrome' } : {}),
});
try {
  for (const locale of ['zh-CN', 'en-US'])
    for (const width of [1440, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        locale,
        reducedMotion: 'reduce',
      });
      await context.addCookies([{ name: 'liekan.locale', value: locale, url: base }]);
      await context.addInitScript(
        t => localStorage.setItem('umami.auth', JSON.stringify(t)),
        token,
      );
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on('pageerror', e => result.errors.push(e.message));
      const suffix = `${locale}-${width}`;
      const fixtureEnd = Date.now() - 3600000;
      const finding = {
        key: 'cr_' + 'a'.repeat(64),
        botId: 'gptbot',
        type: 'access',
        pathGroup: '/test-visual/' + 'long-path-'.repeat(20),
        grade: 'medium',
        confidence: 'possible',
        state: 'active',
        facts: { windowStart: fixtureEnd - 3600000, windowEnd: fixtureEnd },
        windowEnd: new Date(fixtureEnd).toISOString(),
        firstSeenAt: new Date(fixtureEnd).toISOString(),
        lastSeenAt: new Date(fixtureEnd).toISOString(),
      };
      let workflowState = 'pending',
        workflowRevision = 0;
      await page.route('**/api/liekan/websites/*/crawler-analysis?*', async route => {
        const response = await route.fetch();
        assert(response.ok());
        const data = await response.json();
        finding.botId = data.directory[0].id;
        data.findings = [finding];
        await route.fulfill({ response, json: data });
      });
      await page.route('**/api/liekan/websites/*/crawler-context?*', route =>
        route.fulfill({
          json: {
            workflow: {
              state: workflowState,
              workflowRevision,
              occurrenceVersion: 1,
              factVersion: 'a'.repeat(64),
              finding,
            },
            canDraft: true,
            rows: [],
            actions: [],
            total: 0,
            page: 1,
            pageSize: 20,
            actionTotal: 0,
            actionPage: 1,
            evidence: null,
          },
        }),
      );
      await page.route('**/api/liekan/websites/*/crawler-findings/*/workflow', route => {
        workflowState = 'viewed';
        workflowRevision++;
        return route.fulfill({ json: { state: workflowState } });
      });

      await page.goto(`${base}/websites/${seed.website.id}/geo/ai/bots?date=7day`);
      await page.waitForLoadState('networkidle');
      const open = page.getByRole('button', {
        name: text('查看归因、风险与访问策略', locale),
        exact: true,
      });
      await open.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      for (const [zh, en] of [
        ['身份与响应', 'Identity and responses'],
        ['资源与性能', 'Resources and performance'],
        ['业务效果', 'Business outcomes'],
      ]) {
        const endpoint = {
          身份与响应: 'evidence',
          资源与性能: 'performance',
          业务效果: 'outcomes',
        }[zh];
        const evidenceResponse = page.waitForResponse(response => {
          const url = new URL(response.url());
          return (
            url.pathname.endsWith(`/crawler-analysis/${endpoint}`) &&
            url.searchParams.has('crawlerIdentityScope')
          );
        });
        await dialog.getByRole('tab', { name: text(zh, locale), exact: true }).click();
        const response = await evidenceResponse;
        assert(response.ok());
        const requested = new URL(response.url());
        assert.equal(
          requested.searchParams.get('botId'),
          null,
          'General entry includes all crawlers',
        );
        assert.equal(requested.searchParams.get('botName'), null);
        await expect(dialog.getByLabel(text('蜘蛛', locale), { exact: true })).toHaveValue('');
        await expect(
          dialog.getByRole('button', { name: text('重新读取', locale), exact: true }),
        ).toBeEnabled();
        await expect(dialog.getByText(text('日志来源', locale), { exact: true })).toBeVisible();
        if (endpoint === 'evidence') {
          const unverified = dialog.getByRole('button', {
            name: `${text('未核验', locale)} 2xx`,
            exact: true,
          });
          const back = dialog.getByRole('button', {
            name: text('返回身份矩阵', locale),
            exact: true,
          });
          await unverified.click();
          await expect(back).toBeVisible();
          await back.click();
          await expect(unverified).toBeVisible();
          await unverified.click();
          await expect(back).toBeVisible();
          await dialog
            .getByLabel(text('蜘蛛身份范围', locale), { exact: true })
            .selectOption('verified_range');
          await expect(
            dialog.getByRole('button', {
              name: `${text('官方范围匹配', locale)} 2xx`,
              exact: true,
            }),
          ).toBeVisible();
          await expect(back).toHaveCount(0);
          await dialog
            .getByLabel(text('蜘蛛身份范围', locale), { exact: true })
            .selectOption('all');
          await expect(unverified).toBeVisible();
          const selected = page.waitForResponse(response => {
            const url = new URL(response.url());
            return (
              url.pathname.endsWith('/crawler-analysis/evidence') &&
              url.searchParams.get('botId') === finding.botId
            );
          });
          await dialog
            .getByLabel(text('蜘蛛', locale), { exact: true })
            .selectOption(finding.botId);
          assert((await selected).ok());
          await expect(unverified).toBeVisible();
          await dialog.getByLabel(text('蜘蛛', locale), { exact: true }).selectOption('');
          await expect(unverified).toBeVisible();
        }
        const widthState = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          width: innerWidth,
        }));
        assert(widthState.scroll <= widthState.width + 1, `${suffix} viewport overflow`);
        await page.screenshot({
          path: `${out}/${suffix}-${en.replaceAll(' ', '-')}.png`,
          fullPage: true,
        });
        result.checks.push({ locale, width, panel: en });
      }
      await dialog.getByRole('tab', { name: text('风险证据', locale), exact: true }).click();
      await dialog.getByRole('button', { name: text('上下文与处理', locale), exact: true }).click();
      await expect(
        dialog.getByRole('button', { name: text('标记已查看', locale), exact: true }),
      ).toBeEnabled();
      await dialog.getByLabel(text('处理备注', locale), { exact: true }).fill('test visual note');
      await dialog.getByRole('button', { name: text('标记已查看', locale), exact: true }).click();
      await expect(dialog.getByLabel(text('处理备注', locale), { exact: true })).toHaveValue('');
      await expect(
        dialog.getByRole('button', { name: text('重新读取归因与风险', locale), exact: true }),
      ).toBeEnabled();
      await page.screenshot({ path: `${out}/${suffix}-workflow.png`, fullPage: true });
      result.checks.push({ locale, width, panel: 'workflow', fixture: true });
      await page.keyboard.press('Escape');
      await page.goto(
        `${base}/liekan/website-settings?websiteId=${seed.website.id}&section=collection`,
      );
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: text('浏览流量质量', locale), exact: true }).click();
      const quality = page.getByRole('dialog');
      for (const label of ['观察证据', '采集对账']) {
        const summary = quality.locator('summary').filter({ hasText: text(label, locale) });
        await summary.focus();
        await page.keyboard.press('Enter');
        await expect(
          quality.getByRole('button', { name: text('重新读取', locale), exact: true }),
        ).toBeEnabled();
        const geometry = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          width: innerWidth,
        }));
        assert(geometry.scroll <= geometry.width + 1);
        await page.screenshot({
          path: `${out}/${suffix}-${label === '观察证据' ? 'observations' : 'reconciliation'}.png`,
          fullPage: true,
        });
        result.checks.push({ locale, width, panel: label, keyboard: true });
        await summary.click();
      }
      await page.keyboard.press('Escape');
      await context.close();
    }
  assert.equal(result.errors.length, 0);
  result.passed = true;
} finally {
  await browser.close();
  fs.writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2));
}
console.log(JSON.stringify(result));
