import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { execFileSync } from 'node:child_process';
import { isolatedAcceptanceTarget } from './liekan-acceptance-target.mjs';

const normalize = text => text.trim().replace(/\s+/g, ' ');
const english = new Map();
for (const directory of ['messages', 'help-messages']) {
  const zh = JSON.parse(fs.readFileSync(`src/lib/liekan/i18n/${directory}/zh-CN.json`, 'utf8'));
  const en = JSON.parse(fs.readFileSync(`src/lib/liekan/i18n/${directory}/en-US.json`, 'utf8'));
  for (const [key, source] of Object.entries(zh)) english.set(normalize(source), en[key]);
}
const label = source => english.get(normalize(source)) || source;

export function englishPageGeometry() {
  return {
    overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    width: innerWidth,
    title: document.title,
    empty: !document.body.textContent.trim(),
    contentLength: (
      document.querySelector('#main-content,main,article,.identity-flow')?.textContent || ''
    ).trim().length,
    readFailureHeads: [...document.querySelectorAll('.state-box h3')].map(el =>
      el.textContent.trim(),
    ),
    analyticsCards: document.querySelectorAll('main .metric-label,main [data-liekan-metric-label]')
      .length,
    untranslatedOwned: [
      ...document.querySelectorAll(
        '[data-liekan-page-title],[data-liekan-owned-actions] button,[data-liekan-product-footer] nav a,[data-navigation-section],[data-ai-suggested-question],[data-ai-platform-note],[data-liekan-metric-label],[data-liekan-auth-copy],.auth-form .field > span',
      ),
    ]
      .map(el => el.textContent.trim())
      .filter(text => /[\u3400-\u9fff]/.test(text)),
    untranslatedTitles: [...document.querySelectorAll('[data-liekan-page-title]')]
      .map(el => el.textContent.trim())
      .filter(text => /[\u3400-\u9fff]/.test(text)),
    untranslatedTablists: [...document.querySelectorAll('[data-analysis-family] [role="tablist"]')]
      .map(el => el.getAttribute('aria-label') || '')
      .filter(text => /[\u3400-\u9fff]/.test(text)),
    untranslated: [
      ...document.querySelectorAll(
        '.metric-label,[data-liekan-metric-label],.table-sort,.tab,[data-liekan-page-title],[data-liekan-owned-actions] button,[data-liekan-product-footer] nav a,[data-navigation-section],[data-ai-suggested-question],[data-ai-platform-note],[data-liekan-features] header h1,[data-liekan-ui] main h1,.identity-flow h1,[data-help-center] h2,[data-help-center] h3,.dialog-title,.state-box h3',
      ),
    ]
      .map(el => el.textContent.trim())
      .filter(text => /[\u3400-\u9fff]/.test(text)),
  };
}
export function englishChartsReady() {
  return [...document.querySelectorAll('.chart,[data-liekan-chart-state]')].every(el => {
    const state = el.getAttribute('data-liekan-chart-state');
    return (
      state === 'empty' ||
      (state !== 'loading' && state !== 'failed' && !!el.querySelector('canvas,svg'))
    );
  });
}
export const isStatisticsRequest = url =>
  /\/api\/liekan\/websites\/[^/]+\/(?:page-report|report|keywords)(?:\/|$)/.test(
    new URL(url).pathname,
  );
export function assertRenderedEnglishState(state, analytics = false) {
  assert(!state.empty && state.contentLength > 0, 'Rendered page body is required');
  if (analytics) assert(state.analyticsCards > 0, 'Rendered analytics cards are required');
  assert.deepEqual(state.untranslatedOwned, [], 'Owned interface text must be English');
  assert(
    !state.readFailureHeads.some(text => [label('读取失败'), label('加载失败')].includes(text)),
    'Fixture data read must succeed',
  );
}
export function assertEnglishRouteIdentity(route, url, title) {
  assert.equal(
    new URL(url).pathname,
    new URL(route.path, url).pathname,
    `${route.id}: correct page route`,
  );
  assert.equal(
    title,
    label(route.documentTitle) + ' | Liekan',
    `${route.id}: correct English document title`,
  );
}
export function assertNumericSnapshot(values) {
  assert(
    values.length > 0 && values.some(row => row.length > 0),
    'Snapshot checks include actual numeric statistics',
  );
}

/** Uses new Playwright contexts; it never resizes a user's browser window. */
export async function checkEnglishExperience({ browser, base, seed, token, partial, routes }) {
  isolatedAcceptanceTarget(base);
  const out = 'test-results/liekan-i18n';
  fs.mkdirSync(out, { recursive: true });
  const report = {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    passed: false,
    pages: [],
    checks: [],
    errors: [],
  };
  const contexts = [];
  const watchPage = page => {
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('response', response => {
      const url = new URL(response.url());
      if (
        url.origin === new URL(base).origin &&
        url.pathname.startsWith('/api/') &&
        response.status() >= 400
      )
        report.errors.push(`Unexpected API response ${response.status()}: ${url.pathname}`);
    });
    page.on('requestfailed', request => {
      const url = new URL(request.url());
      if (
        url.origin === new URL(base).origin &&
        url.pathname.startsWith('/api/') &&
        !request.failure()?.errorText.includes('ERR_ABORTED')
      )
        report.errors.push(`API request failed: ${url.pathname}`);
    });
  };
  const context = async (width, authToken) => {
    const value = await browser.newContext({
      viewport: { width, height: 1000 },
      locale: 'en-US',
      reducedMotion: 'reduce',
    });
    contexts.push(value);
    value.on('page', watchPage);
    await value.addCookies([{ name: 'liekan.locale', value: 'en-US', url: base }]);
    if (authToken)
      await value.addInitScript(value => {
        if (!sessionStorage.getItem('liekan.i18n.seeded')) {
          localStorage.setItem('umami.auth', JSON.stringify(value));
          sessionStorage.setItem('liekan.i18n.seeded', 'true');
        }
      }, authToken);
    return value;
  };
  const settled = async (page, locale = 'en-US') => {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(value => document.documentElement.lang === value, locale);
    await page.waitForSelector('[data-liekan-features], [data-help-center], main, article');
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(
      () => !document.querySelector('[aria-busy="true"]'),
      {},
      { timeout: 30000 },
    );
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(englishChartsReady, {}, { timeout: 15000 });
    await page.evaluate(
      () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  };
  const geometry = page => page.evaluate(englishPageGeometry);
  try {
    const rendered = await Promise.all(
      ['en-US', 'zh-CN', 'en-US'].map(async locale => {
        const response = await fetch(base + '/login', {
          headers: { cookie: `liekan.locale=${locale}` },
        });
        assert.equal(response.status, 200);
        return { locale, html: await response.text() };
      }),
    );
    for (const { locale, html } of rendered) {
      assert.match(
        html,
        new RegExp(`<html[^>]*lang="${locale}"`),
        'Server language stays isolated by request cookie',
      );
      const body = new JSDOM(html).window.document;
      assert.equal(
        body.querySelector('main h1')?.textContent.trim(),
        locale === 'en-US' ? label('欢迎回来') : '欢迎回来',
        'Server response renders the requested language body',
      );
    }
    report.checks.push({ name: 'server-cookie-request-isolation', passed: true });
    for (const width of [1440, 390]) {
      const authenticated = await context(width, token),
        auth = await context(width),
        publicContext = await context(width);
      await auth.addInitScript(
        value => sessionStorage.setItem('umami.partial-token', value),
        partial,
      );
      const actual = await authenticated.newPage(),
        login = await auth.newPage(),
        shared = await publicContext.newPage();
      for (const route of routes) {
        const page =
          route.id === 'share-preview'
            ? shared
            : ['login', 'login-2fa', 'sso'].includes(route.id)
              ? login
              : actual;
        try {
          await page.goto(base + route.path);
          await settled(page);
          assertEnglishRouteIdentity(route, page.url(), await page.title());
          if (route.id === 'share-preview') {
            await page.locator('.public-shell[data-share-theme="light"]').waitFor();
            assert(
              (await page.locator('.public-brand small').innerText()).includes(route.shareName),
              'Anonymous share retains its resource name',
            );
            assert.equal(
              await page.evaluate(() => localStorage.getItem('umami.auth')),
              null,
              'Public share is anonymous',
            );
            assert.equal(
              await page.getByRole('combobox', { name: 'Language / 语言' }).inputValue(),
              'en-US',
            );
          } else {
            assert(route.heading, `${route.id}: approved heading is required`);
            await page
              .getByRole('heading', { name: label(route.heading), exact: true, level: 1 })
              .waitFor();
          }
          if (['login', 'login-2fa', 'sso'].includes(route.id)) {
            assert.equal(new URL(page.url()).pathname, new URL(base + route.path).pathname);
            await page
              .getByRole('heading', {
                name: label(
                  route.id === 'login'
                    ? '欢迎回来'
                    : route.id === 'login-2fa'
                      ? '验证登录'
                      : '单点登录',
                ),
                exact: true,
              })
              .waitFor();
          }
          const failureHeads = await page.locator('.state-box h3').allTextContents();
          assert(
            !failureHeads.some(text =>
              [label('读取失败'), label('加载失败')].includes(text.trim()),
            ),
            `${route.id}: fixture data read succeeded`,
          );
          const state = await geometry(page);
          assertRenderedEnglishState(state, route.id.startsWith('geo-'));
          assert(!state.empty, `${route.id}: empty page`);
          assert(state.contentLength > 0, `${route.id}: missing page body`);
          if (route.id.startsWith('geo-'))
            assert(state.analyticsCards > 0, `${route.id}: missing analytics cards`);
          assert.equal(state.overflow, 0, `${route.id} ${width}px page overflow`);
          // User-defined labels remain original; known application labels must localize.
          const leftovers = state.untranslated.filter(
            text => english.has(normalize(text)) && label(text) !== text,
          );
          assert.deepEqual(
            state.untranslatedOwned,
            [],
            `${route.id}: untranslated owned interface text`,
          );
          assert.deepEqual(leftovers, [], `${route.id}: untranslated interface text`);
          assert.deepEqual(
            state.untranslatedTitles,
            [],
            `${route.id}: untranslated application title`,
          );
          assert.deepEqual(
            state.untranslatedTablists,
            [],
            `${route.id}: untranslated analysis accessible name`,
          );
          assert.equal(state.title.includes('undefined'), false, `${route.id}: invalid title`);
          await page.screenshot({
            path: `${out}/${route.id}-${width}.png`,
            fullPage: true,
            animations: 'disabled',
          });
          report.pages.push({ id: route.id, width, passed: true });
        } catch (error) {
          report.pages.push({ id: route.id, width, passed: false, error: error.message });
          await page
            .screenshot({ path: `${out}/${route.id}-${width}-failed.png`, fullPage: true })
            .catch(() => {});
        }
      }
      await authenticated.close();
      await auth.close();
    }
    assert.equal(routes.length, 82, 'Every approved feature, GEO and help view must run');
    assert.equal(report.pages.length, 164);
    assert(
      report.pages.every(page => page.passed),
      report.pages
        .filter(page => !page.passed)
        .map(page => `${page.id} ${page.width}: ${page.error}`)
        .join('\n'),
    );

    const live = await context(1440, token),
      page = await live.newPage();
    await page.goto(base + '/liekan/preferences');
    await settled(page);
    const range = page.locator('select[name="range"]');
    const language = page
      .locator('#main-content')
      .getByRole('combobox', { name: 'Language / 语言' });
    const menuLanguage = page
      .locator('#account-navigation')
      .getByRole('combobox', { name: 'Language / 语言' });
    if (!(await menuLanguage.isVisible()))
      await page
        .locator('#liekan-navigation footer button[aria-controls="account-navigation"]')
        .click();
    await range.selectOption('7day');
    const draft = await range.inputValue();
    await language.selectOption('zh-CN');
    await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
    assert.equal(
      await menuLanguage.inputValue(),
      'zh-CN',
      'Account selector follows preferences selector',
    );
    await menuLanguage.selectOption('en-US');
    await page.waitForFunction(() => document.documentElement.lang === 'en-US');
    assert.equal(
      await language.inputValue(),
      'en-US',
      'Preferences selector follows account selector',
    );
    assert.equal(await range.inputValue(), draft, 'Language switches preserve preference drafts');
    await language.selectOption('zh-CN');
    await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
    await language.focus();
    await page.keyboard.press('e');
    await page.waitForFunction(() => document.documentElement.lang === 'en-US');
    assert.equal(await menuLanguage.inputValue(), 'en-US');
    assert.equal(
      await range.inputValue(),
      draft,
      'Keyboard language switching preserves the draft',
    );
    report.checks.push({
      name: 'keyboard-language-selection-and-two-selector-synchronization',
      passed: true,
    });
    await language.selectOption('zh-CN');
    await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
    assert.equal(
      (await live.cookies(base)).find(cookie => cookie.name === 'liekan.locale')?.value,
      'zh-CN',
      'Changed cookie differs from the initial English cookie',
    );
    assert.equal(
      await page.evaluate(() => JSON.parse(localStorage.getItem('umami.locale'))),
      'zh-CN',
    );
    await page.reload();
    await settled(page, 'zh-CN');
    assert.equal(await language.inputValue(), 'zh-CN', 'Reload retains the changed language');
    const reopened = await live.newPage();
    await reopened.goto(base + '/liekan/preferences');
    await settled(reopened, 'zh-CN');
    assert.equal(
      await reopened
        .locator('#main-content')
        .getByRole('combobox', { name: 'Language / 语言' })
        .inputValue(),
      'zh-CN',
    );
    await reopened.close();
    await language.selectOption('en-US');
    await settled(page);
    assert.equal(
      (await live.cookies(base)).find(cookie => cookie.name === 'liekan.locale')?.value,
      'en-US',
    );
    report.checks.push({
      name: 'changed-language-cookie-reload-and-reopen-persistence',
      passed: true,
    });

    const date = `range:${seed.range.startAt}:${seed.range.endAt}:day`;
    await page.goto(base + `/websites/${seed.website.id}/geo?date=${date}&unit=day`);
    await settled(page);
    const before = {
      url: page.url(),
      values: (await page.locator('.num').allTextContents()).map(
        text => text.match(/[0-9]+(?:[.,][0-9]+)*/g) || [],
      ),
    };
    assertNumericSnapshot(before.values);
    const analyticsRequests = [];
    const track = request => {
      if (isStatisticsRequest(request.url())) analyticsRequests.push(request.url());
    };
    page.on('request', track);
    await page
      .locator('#liekan-navigation footer button[aria-controls="account-navigation"]')
      .click();
    await page.getByRole('combobox', { name: 'Language / 语言' }).selectOption('zh-CN');
    await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
    await page.getByRole('combobox', { name: 'Language / 语言' }).selectOption('en-US');
    await page.waitForFunction(() => document.documentElement.lang === 'en-US');
    await page.waitForLoadState('networkidle');
    assert.equal(page.url(), before.url, 'Language switch preserves resource and date/filter URL');
    assert.deepEqual(
      (await page.locator('.num').allTextContents()).map(
        text => text.match(/[0-9]+(?:[.,][0-9]+)*/g) || [],
      ),
      before.values,
      'Statistics values remain unchanged',
    );
    assert.equal(
      analyticsRequests.length,
      0,
      'Language switch does not request a new statistics snapshot',
    );
    const refreshedSnapshot = page.waitForRequest(request =>
      new URL(request.url()).pathname.endsWith('/page-report'),
    );
    await page.locator('[data-manual-refresh]').click();
    await refreshedSnapshot;
    await page.waitForFunction(() => !document.querySelector('[data-manual-refresh]')?.disabled);
    await page.waitForLoadState('networkidle');
    assert(
      analyticsRequests.some(url => new URL(url).pathname.endsWith('/page-report')),
      'Explicit refresh proves the snapshot listener observes actual page-report requests',
    );
    page.off('request', track);
    report.checks.push({ name: 'snapshot-and-route-preservation', passed: true });

    await page.goto(base + '/liekan/help');
    await settled(page);
    await page.getByRole('searchbox').fill('Automated crawling');
    const results = page.getByRole('region', { name: label('蜘蛛结果'), exact: true });
    await results.locator('a[href*="crawler=gptbot"]').waitFor();
    assert(
      (await results.locator('li a').count()) > 0,
      'English help search has matching crawler results',
    );
    await page.goto(base + '/liekan/help?section=crawlers');
    await settled(page);
    const purpose = page.getByRole('combobox', { name: label('用途') });
    const crawlerIds = () =>
      page
        .getByRole('region', { name: label('蜘蛛结果'), exact: true })
        .locator('li a')
        .evaluateAll(links => links.map(link => new URL(link.href).searchParams.get('crawler')));
    await page.getByRole('combobox', { name: label('运营方') }).selectOption('OpenAI');
    const unfilteredIds = await crawlerIds();
    assert(
      unfilteredIds.includes('gptbot') && unfilteredIds.includes('oai-searchbot'),
      'Purpose check starts with training and search crawlers',
    );
    await purpose.selectOption({ label: label('训练') });
    assert.equal(
      await purpose.inputValue(),
      '训练',
      'English purpose labels preserve raw filter IDs',
    );
    const filteredIds = await crawlerIds();
    assert(
      filteredIds.includes('gptbot') && !filteredIds.includes('oai-searchbot'),
      'Training filter changes the result population',
    );
    assert.notDeepEqual(filteredIds, unfilteredIds);
    await page
      .locator('#liekan-navigation footer button[aria-controls="account-navigation"]')
      .click();
    await page.getByRole('combobox', { name: 'Language / 语言' }).selectOption('zh-CN');
    await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
    assert.equal(
      await page.getByRole('combobox', { name: '用途', exact: true }).inputValue(),
      '训练',
    );
    const chineseIds = await page
      .getByRole('region', { name: '蜘蛛结果', exact: true })
      .locator('li a')
      .evaluateAll(links => links.map(link => new URL(link.href).searchParams.get('crawler')));
    assert.deepEqual(
      chineseIds,
      filteredIds,
      'Language switch retains purpose selection and results',
    );
    await page.getByRole('combobox', { name: 'Language / 语言' }).selectOption('en-US');
    await settled(page);
    report.checks.push({ name: 'english-help-search-and-purpose-filter', passed: true });

    await page.goto(base + '/liekan/websites');
    await settled(page);
    await page
      .locator('#liekan-navigation footer button[aria-controls="account-navigation"]')
      .click();
    await page.getByRole('button', { name: label('退出登录'), exact: true }).click();
    await page.waitForURL(url => url.pathname === '/login');
    await settled(page);
    assert.equal(
      await page.getByRole('combobox', { name: 'Language / 语言' }).inputValue(),
      'en-US',
    );
    await page.reload();
    await settled(page);
    assert.equal(
      await page.getByRole('combobox', { name: 'Language / 语言' }).inputValue(),
      'en-US',
    );
    assert.equal(
      (await live.cookies(base)).find(cookie => cookie.name === 'liekan.locale')?.value,
      'en-US',
      'Logout keeps the changed language cookie',
    );
    assert.equal(
      await page.evaluate(() => JSON.parse(localStorage.getItem('umami.locale'))),
      'en-US',
    );
    report.checks.push({ name: 'logout-language-persistence', passed: true });
    assert.deepEqual(report.errors, []);
    report.passed = true;
    return report;
  } finally {
    fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
    await Promise.allSettled(contexts.map(context => context.close()));
  }
}
