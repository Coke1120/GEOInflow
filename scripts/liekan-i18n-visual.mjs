import assert from 'node:assert/strict';
import fs from 'node:fs';
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
  const context = async (width, authToken) => {
    const value = await browser.newContext({
      viewport: { width, height: 1000 },
      locale: 'en-US',
      reducedMotion: 'reduce',
    });
    contexts.push(value);
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
  const settled = async page => {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => document.documentElement.lang === 'en-US');
    await page.waitForSelector('[data-liekan-features], [data-help-center], main, article');
    await page.waitForFunction(
      () => !document.querySelector('[aria-busy="true"]'),
      {},
      { timeout: 30000 },
    );
    await page.evaluate(() => document.fonts.ready);
  };
  const geometry = async page =>
    page.evaluate(() => ({
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      width: innerWidth,
      title: document.title,
      empty: !document.body.textContent.trim(),
      untranslatedTitles: [...document.querySelectorAll('[data-liekan-page-title]')]
        .map(el => el.textContent.trim())
        .filter(text => /[\u3400-\u9fff]/.test(text)),
      untranslatedTablists: [
        ...document.querySelectorAll('[data-analysis-family] [role="tablist"]'),
      ]
        .map(el => el.getAttribute('aria-label') || '')
        .filter(text => /[\u3400-\u9fff]/.test(text)),
      untranslated: [
        ...document.querySelectorAll(
          '.metric-label,.table-sort,.tab,[data-liekan-features] header h1,[data-liekan-ui] main h1,.identity-flow h1,[data-help-center] h2,[data-help-center] h3,.dialog-title,.state-box h3',
        ),
      ]
        .map(el => el.textContent.trim())
        .filter(text => /[\u3400-\u9fff]/.test(text)),
    }));
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
    for (const { locale, html } of rendered)
      assert.match(
        html,
        new RegExp(`<html[^>]*lang="${locale}"`),
        'Server language stays isolated by request cookie',
      );
    report.checks.push({ name: 'server-cookie-request-isolation', passed: true });
    for (const width of [1440, 390]) {
      const authenticated = await context(width, token),
        auth = await context(width);
      await auth.addInitScript(
        value => sessionStorage.setItem('umami.partial-token', value),
        partial,
      );
      const actual = await authenticated.newPage(),
        login = await auth.newPage();
      for (const page of [actual, login])
        page.on('pageerror', error => report.errors.push(error.message));
      for (const route of routes) {
        const page = ['login', 'login-2fa', 'sso'].includes(route.id) ? login : actual;
        try {
          await page.goto(base + route.path);
          await settled(page);
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
          const state = await geometry(page);
          assert(!state.empty, `${route.id}: empty page`);
          assert.equal(state.overflow, 0, `${route.id} ${width}px page overflow`);
          // User-defined labels remain original; known application labels must localize.
          const leftovers = state.untranslated.filter(
            text => english.has(normalize(text)) && label(text) !== text,
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
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(base + '/liekan/preferences');
    await settled(page);
    const range = page.locator('select[name="range"]');
    await range.selectOption('7day');
    const draft = await range.inputValue();
    await page.getByRole('combobox', { name: 'Language / 语言' }).selectOption('zh-CN');
    await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
    assert.equal(await range.inputValue(), draft, 'Language switch preserves preference drafts');
    await page.getByRole('combobox', { name: 'Language / 语言' }).selectOption('en-US');
    await page.waitForFunction(() => document.documentElement.lang === 'en-US');
    const language = page.getByRole('combobox', { name: 'Language / 语言' });
    await language.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.documentElement.lang === 'en-US');
    assert.equal(
      await range.inputValue(),
      draft,
      'Keyboard language switching preserves the draft',
    );
    report.checks.push({ name: 'keyboard-language-selection', passed: true });
    await page.reload();
    await settled(page);
    assert.equal(
      await page.getByRole('combobox', { name: 'Language / 语言' }).inputValue(),
      'en-US',
    );
    report.checks.push({ name: 'draft-and-reload-persistence', passed: true });

    const date = `range:${seed.range.startAt}:${seed.range.endAt}:day`;
    await page.goto(base + `/websites/${seed.website.id}/geo?date=${date}&unit=day`);
    await settled(page);
    const before = {
      url: page.url(),
      values: (await page.locator('.num').allTextContents()).map(
        text => text.match(/[0-9]+(?:[.,][0-9]+)*/g) || [],
      ),
    };
    const analyticsRequests = [];
    const track = request => {
      if (/\/api\/liekan\/websites\/.*\/(?:report|keywords)/.test(request.url()))
        analyticsRequests.push(request.url());
    };
    page.on('request', track);
    await page
      .locator('#liekan-navigation footer button[aria-controls="account-navigation"]')
      .click();
    await page.getByRole('combobox', { name: 'Language / 语言' }).selectOption('zh-CN');
    await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
    await page.getByRole('combobox', { name: 'Language / 语言' }).selectOption('en-US');
    await page.waitForFunction(() => document.documentElement.lang === 'en-US');
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
    page.off('request', track);
    report.checks.push({ name: 'snapshot-and-route-preservation', passed: true });

    await page.goto(base + '/liekan/help');
    await settled(page);
    await page.getByRole('searchbox').fill('official range');
    assert(
      (await page.locator('[data-help-center] .articleList li, [data-help-center] li a').count()) >
        0,
      'English help search results',
    );
    await page.goto(base + '/liekan/help?section=crawlers');
    await settled(page);
    const purpose = page.getByRole('combobox', { name: label('用途') });
    await purpose.selectOption({ label: label('训练') });
    assert.equal(
      await purpose.inputValue(),
      '训练',
      'English purpose labels preserve raw filter IDs',
    );
    report.checks.push({ name: 'english-help-search-and-purpose-filter', passed: true });

    await page.goto(base + '/liekan/websites');
    await settled(page);
    await page
      .locator('#liekan-navigation footer button[aria-controls="account-navigation"]')
      .click();
    await page.getByRole('button', { name: label('退出登录'), exact: true }).click();
    await page.waitForURL(url => url.pathname.includes('/login'));
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
    report.checks.push({ name: 'logout-language-persistence', passed: true });
    assert.deepEqual(report.errors, []);
    report.passed = true;
    return report;
  } finally {
    fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
    await Promise.allSettled(contexts.map(context => context.close()));
  }
}
