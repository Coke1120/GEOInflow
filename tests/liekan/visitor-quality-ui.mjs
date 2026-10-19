import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

/** Uses only the disposable integration website and an isolated browser process. */
export async function verifyVisitorQualityUi({ base, token, websiteId, startAt, endAt }) {
  const browser = await chromium.launch({
    headless: true,
    ...(!process.env.CI ? { channel: 'chrome' } : {}),
  });
  await mkdir('outputs/visitor-quality', { recursive: true });
  try {
    for (const locale of ['zh-CN', 'en-US']) {
      for (const width of [1440, 390]) {
        const context = await browser.newContext({
          locale,
          viewport: { width, height: 1000 },
          reducedMotion: 'reduce',
        });
        try {
          await context.addCookies([{ name: 'liekan.locale', value: locale, url: base }]);
          await context.addInitScript(
            token => localStorage.setItem('umami.auth', JSON.stringify(token)),
            token,
          );
          const page = await context.newPage();
          page.setDefaultTimeout(20000);
          const errors = [];
          page.on('pageerror', error => errors.push(error.message));
          await page.goto(`${base}/websites/${websiteId}/geo?date=range:${startAt}:${endAt}`);
          const zh = locale === 'zh-CN';
          await expect(
            page
              .locator('[data-liekan-metric-label]')
              .filter({ hasText: zh ? '访客（UV）' : 'Visitors (UV)' }),
          ).toBeVisible();
          await expect(
            page.getByText(
              zh
                ? '按当前流量策略去重，可能含未识别自动化'
                : 'Deduplicated under the current traffic policy; may include undetected automation',
              { exact: true },
            ),
          ).toBeVisible();
          await page.screenshot({
            path: `outputs/visitor-quality/overview-${locale}-${width}.png`,
          });
          await page
            .getByRole('link', { name: zh ? '流量质量' : 'Traffic quality', exact: true })
            .click();
          const dialog = page.getByRole('dialog');
          await expect(dialog).toBeVisible();
          await expect(
            dialog.getByRole('cell', { name: zh ? '浏览器特征' : 'Browser-like', exact: true }).first(),
          ).toBeInViewport();
          await page.screenshot({ path: `outputs/visitor-quality/classification-${locale}-${width}.png` });
          const input = dialog.getByLabel(
            zh ? /^页面路径（精确匹配）/ : /^Page path \(exact match\)/,
          );
          await input.fill('/cases/');
          const audit = page.waitForResponse(
            response =>
              response.url().includes('/traffic-quality?') &&
              new URL(response.url()).searchParams.get('path') === '/cases/' &&
              response.status() === 200,
          );
          await dialog
            .getByRole('button', { name: zh ? '应用路径' : 'Apply path', exact: true })
            .click();
          const data = await (await audit).json();
          expect(data.totals.rawPV).toBe(1);
          expect(data.totals.includedPV).toBe(0);
          await expect(input).toHaveValue('/cases/');
          await page.screenshot({ path: `outputs/visitor-quality/quality-${locale}-${width}.png` });
          await expect
            .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
            .toBe(true);
          await dialog
            .getByRole('button', { name: zh ? '关闭' : 'Close', exact: true })
            .last()
            .click();
          await expect(dialog).toHaveCount(0);
          expect(errors).toEqual([]);
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
}
