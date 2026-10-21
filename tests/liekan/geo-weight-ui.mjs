import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { isolatedAcceptanceTarget } from '../../scripts/liekan-acceptance-target.mjs';

/** Read-only acceptance against an explicitly selected isolated website and browser process. */
export async function verifyGeoWeightUi({
  base,
  token,
  websiteId,
  asOf,
  startAt,
  endAt,
  expectedScore,
}) {
  isolatedAcceptanceTarget(base);
  const out = 'outputs/geo-weight-ui';
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    ...(!process.env.CI ? { channel: 'chrome' } : {}),
  });
  const checks = [];
  try {
    for (const locale of ['zh-CN', 'en-US']) {
      for (const width of [1440, 390]) {
        const context = await browser.newContext({
          locale,
          viewport: { width, height: 1000 },
          reducedMotion: 'reduce',
          acceptDownloads: true,
        });
        try {
          await context.addCookies([{ name: 'liekan.locale', value: locale, url: base }]);
          await context.addInitScript(
            token => localStorage.setItem('umami.auth', JSON.stringify(token)),
            token,
          );
          const page = await context.newPage();
          page.setDefaultTimeout(30000);
          const errors = [],
            reads = [];
          page.on('pageerror', error => errors.push(error.message));
          page.on('request', request => {
            if (/\/geo-weight\?/.test(request.url())) reads.push(request);
          });
          const zh = locale === 'zh-CN';
          const path = `${base}/websites/${websiteId}/geo?date=range:${startAt}:${endAt}&timezone=Asia%2FShanghai`;
          await page.goto(path);
          const summary = page.locator('[data-geo-weight]');
          await expect(summary).toContainText(`${expectedScore.toFixed(1)} / 100`, {
            timeout: 30000,
          });
          await expect(summary).toContainText(asOf);
          await expect(summary).toContainText(zh ? '参考等级' : 'Reference level');
          expect(
            reads.filter(r => new URL(r.url()).searchParams.get('view') === 'detail'),
          ).toHaveLength(0);
          await expect(summary).toBeVisible();
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          ).toBe(true);
          await page.screenshot({ path: `${out}/overview-${locale}-${width}.png` });
          await summary
            .getByRole('button', { name: zh ? '查看计算依据' : 'View calculation evidence' })
            .click();
          const dialog = page.getByRole('dialog');
          await expect(dialog).toContainText(zh ? '三类用途贡献' : 'Contributions by purpose', {
            timeout: 30000,
          });
          await expect(dialog).toContainText('3,000');
          await expect(dialog).toContainText(
            zh ? '距下一等级还差 6.3 分' : '6.3 points to the next level',
          );
          await expect(dialog).toContainText(
            zh ? '工作台与个人 Agent 观察' : 'Workbench and personal agent observations',
          );
          await expect(
            dialog.getByRole('button', {
              name: zh ? '导出计算依据' : 'Export calculation evidence',
            }),
          ).toBeEnabled();
          expect(
            reads.filter(r => new URL(r.url()).searchParams.get('view') === 'detail'),
          ).toHaveLength(1);
          const versions = reads.map(r => r.headers()['x-liekan-catalog-version']);
          expect(versions.every(v => !!v && v === versions[0])).toBe(true);
          const bounds = await dialog.boundingBox();
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
          await page.screenshot({ path: `${out}/detail-${locale}-${width}.png` });
          const downloads = page.waitForEvent('download');
          await dialog
            .getByRole('button', { name: zh ? '导出计算依据' : 'Export calculation evidence' })
            .click();
          const download = await downloads;
          await download.saveAs(`${out}/evidence-${locale}-${width}.csv`);
          await page.keyboard.press('Escape');
          await expect(dialog).toHaveCount(0);
          const count = reads.length;
          await page.bringToFront();
          await page.waitForTimeout(1200);
          expect(reads).toHaveLength(count);
          await page.goto(path.replace('/geo?', '/geo/ai?'));
          await expect(page.locator('[data-geo-weight]')).toContainText(
            `${expectedScore.toFixed(1)} / 100`,
            { timeout: 30000 },
          );
          await expect(page.locator('[data-geo-weight]')).toContainText(
            zh ? '用户触发' : 'User-triggered',
          );
          await page.screenshot({ path: `${out}/ai-${locale}-${width}.png` });
          expect(errors).toEqual([]);
          checks.push({
            locale,
            width,
            score: expectedScore,
            catalogPinned: true,
            export: true,
            noPolling: true,
            overflow: false,
          });
        } finally {
          await context.close();
        }
      }
    }
    await writeFile(`${out}/report.json`, JSON.stringify({ passed: true, checks }, null, 2));
    console.log(
      `GEO UI acceptance passed: ${checks.length} locale/viewport combinations, both summaries, details, export and pinned reads.`,
    );
  } finally {
    await browser.close();
  }
}
