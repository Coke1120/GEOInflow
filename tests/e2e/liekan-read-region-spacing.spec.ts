import { expect, test } from '@playwright/test';
import { loginPage } from './helpers';

for (const width of [1440, 375]) {
  test.describe(`read-only page spacing at ${width}px`, () => {
    test.use({ viewport: { width, height: 1000 } });

    for (const path of ['/websites', '/dashboard']) {
      test(`${path} keeps section gaps through metadata loading`, async ({ page, request }) => {
        await loginPage(page, request);
        let release = () => {};
        const gate = new Promise<void>(resolve => {
          release = resolve;
        });
        await page.route('**/api/me/websites**', async route => {
          await gate;
          await route.continue();
        });
        try {
          await page.goto(path);
          const region = page.locator('.content > [data-liekan-read-region]');
          await expect(region).toBeVisible();
          await expect(region).toHaveAttribute('aria-busy', 'true');
          const check = async (state: string) => {
            const layout = await region.evaluate(element => {
              const parent = getComputedStyle(element.parentElement!);
              const style = getComputedStyle(element);
              const sections = [...element.children]
                .filter(child => {
                  const css = getComputedStyle(child);
                  return (
                    css.display !== 'none' &&
                    css.position !== 'absolute' &&
                    css.position !== 'fixed'
                  );
                })
                .map(child => child.getBoundingClientRect());
              return {
                display: style.display,
                parentDisplay: parent.display,
                gap: parseFloat(style.rowGap),
                parentGap: parseFloat(parent.rowGap),
                gaps: sections.slice(1).map((box, index) => box.top - sections[index].bottom),
              };
            });
            await test.info().attach(`layout-${state}`, {
              body: JSON.stringify(layout),
              contentType: 'application/json',
            });
            expect(layout.parentDisplay).toBe('grid');
            expect(layout.parentGap).toBe(16);
            expect(layout.display).toBe(layout.parentDisplay);
            expect(layout.gap).toBe(layout.parentGap);
            expect(layout.gaps.length).toBeGreaterThan(0);
            for (const gap of layout.gaps) expect(gap).toBeCloseTo(layout.parentGap, 1);
          };
          await check('loading');
          release();
          await expect(region).not.toHaveAttribute('aria-busy', 'true');
          await page.waitForLoadState('networkidle');
          await check('ready');
          for (const label of path === '/websites'
            ? ['数据总览', '网站管理']
            : ['网站管理', '数据总览']) {
            if (width <= 900)
              await page.getByRole('button', { name: '页面导航', exact: true }).click();
            await page
              .locator('[data-navigation-primary] a')
              .filter({ hasText: new RegExp(`^${label}$`) })
              .click();
            await page.waitForURL(
              url => url.pathname === (label === '网站管理' ? '/websites' : '/dashboard'),
            );
          }
          await expect(region).not.toHaveAttribute('aria-busy', 'true');
          await check('warm');
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
        } finally {
          release();
        }
      });
    }
  });
}
