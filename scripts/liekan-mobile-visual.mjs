import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chromium, webkit } from '@playwright/test';
import { checkNavigation } from './liekan-navigation-visual.mjs';
import { isolatedAcceptanceTarget } from './liekan-acceptance-target.mjs';

export async function checkMobileExperience({ base, seed, board, share, partial, journey, token }) {
  isolatedAcceptanceTarget(base, { localhost: false });
  const baseline = JSON.parse(fs.readFileSync('config/liekan/mobile-ui.json'));
  const navigation = JSON.parse(fs.readFileSync('config/liekan/navigation-ui.json'));
  const manifest = JSON.parse(fs.readFileSync('src/lib/liekan/contracts/feature-pages.json'));
  const out = 'test-results/liekan-mobile';
  fs.mkdirSync(out, { recursive: true });
  const geo = {
    index: '',
    ai: '/ai',
    'ai-bots': '/ai/bots',
    'ai-pages': '/ai/pages',
    'ai-preference': '/ai/preference',
    human: '/human',
    'human-geo': '/human/geo',
    'human-source': '/human/sources',
    content: '/content',
    funnel: '/conversions',
    logs: '/logs',
  };
  const aiScope = JSON.parse(fs.readFileSync('config/liekan/ai-ui.json')).scope;
  const pages = [
    ...manifest.pages
      .filter(p => !aiScope.includes(p.id))
      .map(p => ({ id: p.id, expected: navigation.pages[p.id] })),
    ...Object.entries(geo).map(([id, suffix]) => ({
      id: `geo-${id}`,
      suffix,
      expected: navigation.geo[id],
    })),
  ];
  assert.equal(
    pages.filter(page => !navigation.incrementalVisualPages.includes(page.id)).length,
    baseline.pageCount,
    'Preserve the original mobile page coverage',
  );
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const report = {
    head,
    baseline: baseline.baselineVersion,
    passed: false,
    pages: pages.length,
    incrementalPageIds: navigation.incrementalVisualPages,
    browsers: ['chromium', 'webkit'],
    widths: baseline.widths,
    checks: [],
    variants: [],
    errors: [],
  };
  const save = () => fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  const value = {
    websiteId: seed.website.id,
    date: `range:${seed.range.startAt}:${seed.range.endAt}:day`,
    unit: 'day',
  };
  function target(p) {
    if (p.suffix !== undefined)
      return `/websites/${seed.website.id}/geo${p.suffix}?${new URLSearchParams(value)}`;
    if (p.id === 'login') return '/login';
    if (p.id === 'login-2fa') return '/login/two-factor';
    if (p.id === 'sso') return '/sso';
    const params = { ...value };
    const ids = {
      'session-detail': seed.data.sessionId,
      'replay-player': seed.data.replayVisitId,
      'admin-user': seed.user.id,
      'team-detail': seed.team.id,
      'link-detail': seed.link.id,
      'pixel-detail': seed.pixel.id,
      'board-design': board.id,
      'board-view': board.id,
      'share-preview': share.id,
    };
    if (ids[p.id]) params.id = ids[p.id];
    if (p.id === 'share-preview') params.slug = share.slug;
    if (p.id === 'event-detail') params.eventName = seed.data.eventNames[0];
    if (p.id === 'path-detail')
      Object.assign(params, {
        sequence: JSON.stringify(journey.rows[0]?.nodes || []),
        steps: '3',
        type: 'all',
      });
    return `/liekan/${p.id}?${new URLSearchParams(params)}`;
  }
  async function ready(page) {
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(
      () => !document.querySelector('[aria-busy="true"]'),
      {},
      { timeout: 30000 },
    );
    await page.evaluate(
      () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  }
  async function inspect(page, width) {
    return page.evaluate(
      ({ width }) => {
        const visible = el => {
          const rect = el.getBoundingClientRect(),
            style = getComputedStyle(el);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            rect.right > 0 &&
            rect.left < innerWidth
          );
        };
        const controls = [
          ...document.querySelectorAll(
            '.btn,.tab,.resource-expand,.password-wrap button,button[class*="siteSwitch"],button[class*="mobileToggle"]',
          ),
        ].filter(visible);
        const fields = [
          ...document.querySelectorAll(
            'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),textarea,select',
          ),
        ].filter(visible);
        const strip = [...document.querySelectorAll('[role="tablist"]')].map(el => {
          const active = el.querySelector('[aria-selected="true"]'),
            r = el.getBoundingClientRect(),
            a = active?.getBoundingClientRect();
          return { selectedVisible: !a || (a.left >= r.left - 1 && a.right <= r.right + 1) };
        });
        return {
          overflow: document.documentElement.scrollWidth - innerWidth,
          rootWidth: innerWidth,
          title: document.querySelector('h1')?.textContent,
          smallControls: controls
            .filter(el => el.getBoundingClientRect().height < 43.5)
            .map(el => (el.getAttribute('aria-label') || el.textContent).trim()),
          smallInputs:
            width <= 540
              ? fields
                  .filter(el => parseFloat(getComputedStyle(el).fontSize) < 16)
                  .map(el => el.name || el.getAttribute('aria-label'))
              : [],
          strip,
          resourceTables: document.querySelectorAll('.resource-table').length,
          charts: document.querySelectorAll('canvas').length,
          error: [...document.querySelectorAll('[role="alert"]')].some(el =>
            el.textContent.includes('图表加载失败'),
          ),
          uninitializedCharts: [
            ...document.querySelectorAll(
              '.chart[role="img"], [role="img"][aria-label$=" 数据图表"]',
            ),
          ].filter(el => visible(el) && !el.querySelector('canvas,svg')).length,
        };
      },
      { width },
    );
  }
  for (const [name, engine] of [
    ['chromium', chromium],
    ['webkit', webkit],
  ]) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const width of baseline.widths) {
        const context = await browser.newContext({
          viewport: { width, height: 812 },
          locale: 'zh-CN',
          hasTouch: true,
          reducedMotion: 'reduce',
        });
        const auth = await browser.newContext({
          viewport: { width, height: 812 },
          locale: 'zh-CN',
          hasTouch: true,
          reducedMotion: 'reduce',
        });
        await context.addInitScript(
          token => localStorage.setItem('umami.auth', JSON.stringify(token)),
          token,
        );
        await auth.addInitScript(
          partial => sessionStorage.setItem('umami.partial-token', partial),
          partial,
        );
        const page = await context.newPage(),
          authPage = await auth.newPage();
        for (const current of [page, authPage])
          current.on('pageerror', error =>
            report.errors.push({ browser: name, width, message: error.message }),
          );
        for (const p of pages) {
          const current = ['login', 'login-2fa', 'sso'].includes(p.id) ? authPage : page;
          try {
            await current.goto(base + target(p));
            await ready(current);
            const metrics = await inspect(current, width);
            assert.equal(metrics.overflow, 0, `${p.id} page overflow`);
            assert.equal(metrics.error, false, `${p.id} chart failure`);
            assert.equal(metrics.uninitializedCharts, 0, `${p.id} chart initialization`);
            assert.deepEqual(metrics.smallControls, [], `${p.id} touch controls`);
            assert.deepEqual(metrics.smallInputs, [], `${p.id} input readability`);
            assert(
              metrics.strip.every(strip => strip.selectedVisible),
              `${p.id} selected tab visibility`,
            );
            await checkNavigation(current, p.expected, width, navigation);
            if (width <= 540 && baseline.resourceLists.includes(p.id) && metrics.resourceTables) {
              for (const button of await current.locator('.resource-expand').all()) {
                const row = button.locator('xpath=ancestor::tr');
                const identity = await row.getAttribute('data-expanded');
                assert.equal(identity, null);
                await button.click();
                assert.equal(await button.getAttribute('aria-expanded'), 'true');
                assert(
                  (await row.locator('td[data-mobile-detail]:visible').count()) > 0,
                  'All detail fields must remain available',
                );
                await button.click();
                assert.equal(await button.getAttribute('aria-expanded'), 'false');
              }
            }
            if (
              width === 375 &&
              [
                'websites',
                'website-settings',
                'geo-ai',
                'geo-human-geo',
                'filters',
                'board-design',
                'replay-player',
                'login',
                'share-preview',
              ].includes(p.id)
            )
              await current.screenshot({
                path: `${out}/${name}-${p.id}-${width}.png`,
                fullPage: true,
              });
            report.checks.push({ browser: name, width, id: p.id, passed: true, ...metrics });
          } catch (error) {
            report.checks.push({
              browser: name,
              width,
              id: p.id,
              passed: false,
              error: error.message,
            });
          }
          save();
        }
        await context.close();
        await auth.close();
      }
      const context = await browser.newContext({
        viewport: { width: 901, height: 500 },
        locale: 'zh-CN',
        reducedMotion: 'reduce',
      });
      await context.addInitScript(
        token => localStorage.setItem('umami.auth', JSON.stringify(token)),
        token,
      );
      const page = await context.newPage();
      try {
        await page.goto(
          base + `/liekan/website-settings?${new URLSearchParams(value)}&section=danger`,
        );
        await ready(page);
        for (const width of baseline.boundaryWidths) {
          await page.setViewportSize({ width, height: 500 });
          await page.evaluate(
            () =>
              new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          );
          const metrics = await inspect(page, width);
          assert.equal(metrics.overflow, 0);
          assert(metrics.strip.every(strip => strip.selectedVisible));
          report.variants.push({ browser: name, width, id: 'rotation-settings', passed: true });
        }
        await page.setViewportSize({ width: 375, height: 500 });
        const toggle = page.getByRole('button', { name: '页面导航', exact: true });
        await toggle.click();
        await page.waitForFunction(() => document.body.style.overflow === 'hidden');
        await page.setViewportSize({ width: 901, height: 500 });
        await page.waitForFunction(
          () =>
            document
              .querySelector('button[aria-controls="liekan-navigation"]')
              .getAttribute('aria-expanded') === 'false',
        );
        assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');
        const action = page.getByRole('button', { name: '删除网站', exact: true });
        await action.focus();
        await page.keyboard.press('Tab');
        assert(
          await page.evaluate(
            () => !document.querySelector('#liekan-navigation').contains(document.activeElement),
          ),
          'Desktop content focus must be released after closing mobile navigation',
        );
        await action.click();
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).focus();
        await page.keyboard.press('Tab');
        assert(
          await dialog.evaluate(el => el.contains(document.activeElement)),
          'A desktop dialog must retain its own focus after a mobile breakpoint change',
        );
        await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
        report.variants.push({
          browser: name,
          width: 901,
          id: 'open-menu-to-desktop',
          passed: true,
        });
      } catch (error) {
        report.variants.push({
          browser: name,
          id: 'rotation-settings',
          passed: false,
          error: error.message,
        });
      }
      await context.close();
    } finally {
      await browser.close();
    }
  }
  const failures = report.checks.filter(check => !check.passed);
  report.passed =
    failures.length === 0 &&
    report.errors.length === 0 &&
    report.variants.every(check => check.passed) &&
    report.checks.length === pages.length * baseline.widths.length * 2;
  save();
  assert(
    report.passed,
    failures
      .map(check => `${check.browser} ${check.id} ${check.width}: ${check.error}`)
      .join('\n') || JSON.stringify(report.errors),
  );
  return {
    head,
    passed: report.passed,
    pages: pages.length,
    incrementalPageIds: navigation.incrementalVisualPages,
    checks: report.checks.length,
    variants: report.variants.length,
    report: `${out}/report.json`,
  };
}
