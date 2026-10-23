import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { isolatedAcceptanceTarget } from '../../scripts/liekan-acceptance-target.mjs';
import { assertGeoWeightCardAppearance } from '../../scripts/liekan-visual-baseline.mjs';

/** Read-only acceptance against an explicitly selected isolated website and browser process. */
export async function verifyGeoWeightUi({
  base,
  token,
  websiteId,
  asOf,
  startAt,
  endAt,
  expectedLevel,
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
      for (const width of [1440, 1024, 390]) {
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
            reads = [],
            snapshots = [],
            exports = [];
          page.on('pageerror', error => errors.push(error.message));
          page.on('request', request => {
            if (/\/geo-weight\/snapshot\?/.test(request.url())) reads.push(request);
            if (/\/geo-weight\/export$/.test(new URL(request.url()).pathname))
              exports.push(request);
          });
          page.on('response', async response => {
            if (/\/geo-weight\/snapshot\?/.test(response.url()) && response.ok()) {
              const value = await response.json();
              snapshots.push({ url: response.url(), value });
            }
          });
          const zh = locale === 'zh-CN';
          const path = `${base}/websites/${websiteId}/geo?date=range:${startAt}:${endAt}&timezone=Asia%2FShanghai`;
          await page.goto(path);
          const summary = page.locator('[data-geo-weight]');
          await expect(summary.locator('strong')).toHaveText(String(expectedLevel), {
            timeout: 30000,
          });
          await expect(summary.locator('time')).toHaveAttribute('datetime', asOf);
          expect(await summary.evaluate(el => [...el.parentElement.children].indexOf(el))).toBe(3);
          expect(await summary.evaluate(el => el.parentElement.children.length)).toBe(4);
          await expect(summary).toContainText(zh ? '参考等级' : 'Reference level');
          expect(
            reads.filter(r => new URL(r.url()).searchParams.get('view') === 'detail'),
          ).toHaveLength(0);
          await expect(summary).toBeVisible();
          await summary.evaluate(assertGeoWeightCardAppearance);
          const metricStyle = await summary.evaluate(el => {
            const value = el.querySelector('strong');
            const label = el.querySelector('[data-liekan-metric-label]');
            const button = el.querySelector('button');
            return {
              valueFont: getComputedStyle(value).fontSize,
              valueLine: getComputedStyle(value).lineHeight,
              buttonFont: getComputedStyle(button).fontSize,
              buttonHeight: button.getBoundingClientRect().height,
              valueGap: value.getBoundingClientRect().y - label.getBoundingClientRect().bottom,
            };
          });
          expect(metricStyle.valueFont).toBe(width <= 540 ? '22px' : '24px');
          expect(metricStyle.valueLine).toBe(width <= 540 ? '33px' : '36px');
          expect(metricStyle.buttonFont).toBe('10.5px');
          expect(metricStyle.valueGap).toBeCloseTo(6, 0);
          if (width <= 900) expect(metricStyle.buttonHeight).toBeGreaterThanOrEqual(44);

          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          ).toBe(true);
          await page.screenshot({ path: `${out}/overview-${locale}-${width}.png` });
          await summary
            .getByRole('button', {
              name: zh ? '查看 GEO 权重计算依据' : 'View GEO weight calculation evidence',
            })
            .click();
          const dialog = page.getByRole('dialog');
          await expect(dialog).toContainText(zh ? '三类用途贡献' : 'Contributions by purpose', {
            timeout: 30000,
          });
          await expect(dialog).toContainText('3,000');
          await expect(dialog).toContainText(
            zh ? '距权重 7 还差 143,200 加权单元' : 'Weight 7 requires 143,200 more weighted units',
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
          expect(reads.every(r => !r.headers()['x-liekan-catalog-version'])).toBe(true);
          const detailRead = reads.find(
            r => new URL(r.url()).searchParams.get('view') === 'detail',
          );
          const savedId = new URL(detailRead.url()).searchParams.get('snapshotId');
          expect(savedId).toMatch(/^[a-f0-9-]{36}$/);
          expect(new URL(detailRead.url()).searchParams.has('refresh')).toBe(false);
          await expect
            .poll(() => snapshots.filter(s => s.value.result?.view === 'detail').length)
            .toBe(1);
          const detailSnapshot = snapshots.find(s => s.value.result?.view === 'detail').value;
          expect(detailSnapshot.snapshotId).toBe(savedId);
          expect(detailSnapshot.result.snapshotId).toBe(savedId);
          expect(snapshots.find(s => s.value.result?.view === 'summary').value.snapshotId).toBe(
            savedId,
          );
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
          expect(exports).toHaveLength(1);
          expect(exports[0].postDataJSON()).toEqual({ snapshotId: savedId, locale });
          expect(exports[0].headers()['x-liekan-catalog-version']).toBeUndefined();
          await page.keyboard.press('Escape');
          await expect(dialog).toHaveCount(0);
          const count = reads.length;
          await page.bringToFront();
          await page.waitForTimeout(1200);
          expect(reads).toHaveLength(count);
          await page.goto(path.replace('/geo?', '/geo/ai?'));
          await expect(page.locator('[data-geo-weight] strong')).toHaveText(String(expectedLevel), {
            timeout: 30000,
          });
          const aiSummary = page.locator('[data-geo-weight]');
          expect(await aiSummary.evaluate(el => [...el.parentElement.children].indexOf(el))).toBe(
            2,
          );
          expect(await aiSummary.evaluate(el => el.parentElement.children.length)).toBe(4);
          await expect(aiSummary.locator('time')).toHaveAttribute('datetime', asOf);
          await aiSummary.evaluate(assertGeoWeightCardAppearance);
          await page.screenshot({ path: `${out}/ai-${locale}-${width}.png` });
          expect(errors).toEqual([]);
          checks.push({
            locale,
            width,
            level: expectedLevel,
            immutableSnapshot: savedId,
            catalogHeaderAbsent: true,
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
      `GEO UI acceptance passed: ${checks.length} locale/viewport combinations, both summaries, details, export and immutable snapshot reads.`,
    );
  } finally {
    await browser.close();
  }
}
