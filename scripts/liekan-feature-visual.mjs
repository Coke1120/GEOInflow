import {
  assertLanguageHeader,
  checkEnglishExperience,
  languageHeaderGeometry,
} from './liekan-i18n-visual.mjs';
import { checkNavigation } from './liekan-navigation-visual.mjs';
import { checkMobileExperience } from './liekan-mobile-visual.mjs';
import { isolatedAcceptanceTarget, acceptanceSeedFile } from './liekan-acceptance-target.mjs';
import { assertDialogContract } from './liekan-dialog-contract.mjs';
import fs from 'node:fs';
import ts from 'typescript';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { generateSync } from 'otplib';

const base = process.env.LIEKAN_URL || 'http://127.0.0.1:3302';
const target = isolatedAcceptanceTarget(base);
assertDialogContract();
const navigationBaseline = JSON.parse(fs.readFileSync('config/liekan/navigation-ui.json', 'utf8'));
assert.equal(
  navigationBaseline.baselineVersion,
  'liekan-navigation-v0.2.3',
  'Explicit approved navigation baseline required',
);
const featureReference = JSON.parse(fs.readFileSync('config/liekan/feature-ui.json', 'utf8'));
for (const [file, hash] of Object.entries(featureReference.files))
  assert.equal(
    createHash('sha256')
      .update(fs.readFileSync(path.join(featureReference.directory, file)))
      .digest('hex'),
    hash,
    `Original feature reference changed: ${file}`,
  );
const seed = JSON.parse(fs.readFileSync(acceptanceSeedFile(target), 'utf8'));
const manifest = JSON.parse(fs.readFileSync('src/lib/liekan/contracts/feature-pages.json', 'utf8'));
assert.deepEqual(
  Object.keys(navigationBaseline.pages)
    .filter(id => id !== 'help')
    .sort(),
  manifest.pages.map(p => p.id).sort(),
  'Every feature scenario requires independent navigation expectations',
);
const aiReference = JSON.parse(fs.readFileSync('config/liekan/ai-ui.json', 'utf8'));
const incrementalPages = manifest.pages.filter(page =>
  navigationBaseline.incrementalVisualPages.includes(page.id),
);
assert.deepEqual(
  incrementalPages.map(page => page.id),
  navigationBaseline.incrementalVisualPages,
  'Every approved incremental page must run',
);
const originalPages = manifest.pages.filter(
  page =>
    !aiReference.scope.includes(page.id) &&
    !navigationBaseline.incrementalVisualPages.includes(page.id),
);
assert.equal(originalPages.length, 66, 'Preserve all original supplemental page checks');
for (const page of originalPages)
  assert(featureReference.files[page.id + '.html'], `Missing original reference: ${page.id}`);
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const out = 'test-results/liekan-features';
fs.mkdirSync(out, { recursive: true });
let adminToken;
async function api(method, url, data, token = adminToken) {
  const response = await fetch(base + '/api' + url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  assert.equal(response.status, 200, `${method} ${url}: HTTP ${response.status}`);
  return body;
}
adminToken = (await api('POST', '/auth/login', seed.admin, '')).token;
const board = await api('POST', '/boards', {
  name: 'UI 验收 · 隔离看板',
  type: 'website',
  parameters: {
    websiteId: seed.website.id,
    rows: [
      {
        id: 'visual-row',
        columns: [
          {
            id: 'visual-trend',
            size: 50,
            component: {
              title: '访客趋势',
              type: 'WebsiteChart',
              entityType: 'website',
              entityId: seed.website.id,
            },
          },
          {
            id: 'visual-source',
            size: 50,
            component: {
              title: '访问来源',
              type: 'MetricsTable',
              entityType: 'website',
              entityId: seed.website.id,
              props: { type: 'channel', liekanDisplay: 'bar' },
            },
          },
        ],
      },
    ],
  },
});
const goal = await api('POST', `/websites/${seed.website.id}/goals`, {
  name: 'UI 验收 · 预约演示',
  parameters: { type: 'event', value: seed.data.eventNames[0] },
});
const share = await api('POST', '/share', {
  name: 'UI 验收 · 公开页面',
  entityId: seed.website.id,
  shareType: 1,
  parameters: {
    overview: true,
    events: true,
    utm: true,
    goals: true,
    funnels: true,
    allowFilter: true,
  },
});
const identity = await api('POST', '/users', {
  username: 'visual-' + Date.now(),
  password: 'visual-fixture-only',
  role: 'user',
});
const userAuth = await api(
  'POST',
  '/auth/login',
  { username: identity.username, password: 'visual-fixture-only' },
  '',
);
const setup = await api('POST', '/2fa/setup/initiate', {}, userAuth.token);
if (30 - (Math.floor(Date.now() / 1000) % 30) < 5)
  await new Promise(resolve => setTimeout(resolve, 5000));
await api(
  'POST',
  '/2fa/setup/confirm',
  { token: generateSync({ secret: setup.manualKey }) },
  userAuth.token,
);
const partial = (
  await api(
    'POST',
    '/auth/login',
    { username: identity.username, password: 'visual-fixture-only' },
    '',
  )
).partialToken;
const journey = await api(
  'GET',
  `/liekan/websites/${seed.website.id}/journeys?` +
    new URLSearchParams({
      ...seed.range,
      endAt: Date.now(),
      steps: 3,
      type: 'all',
      timezone: 'UTC',
    }),
);
const browser = await chromium.launch({
  headless: true,
  ...(!process.env.CI ? { channel: 'chrome' } : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: 'zh-CN',
  reducedMotion: 'reduce',
});
const authContext = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: 'zh-CN',
  reducedMotion: 'reduce',
});
const actual = await context.newPage(),
  reference = await context.newPage(),
  auth = await authContext.newPage();
const root = path.resolve('design/prototypes/liekan-ui-v1');
const mime = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};
await context.route(base + '/__prototype/**', async route => {
  const file = path.resolve(
    root,
    decodeURIComponent(new URL(route.request().url()).pathname.slice('/__prototype/'.length)),
  );
  if (!file.startsWith(root + path.sep)) return route.fulfill({ status: 404 });
  try {
    await route.fulfill({
      contentType: mime[path.extname(file)] || 'application/octet-stream',
      body: fs.readFileSync(file),
    });
  } catch {
    await route.fulfill({ status: 404 });
  }
});
const errors = [];
actual.on('pageerror', error => errors.push(error.message));
auth.on('pageerror', error => errors.push(error.message));
for (const page of [actual, auth])
  page.on('response', response => {
    if (response.url().includes('/api/') && response.status() >= 500)
      errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`);
  });
await auth.addInitScript(token => sessionStorage.setItem('umami.partial-token', token), partial);
const results = [];
const incrementalResults = [];
const contextResults = [];
const report = {
  head,
  passed: false,
  navigationBaseline: navigationBaseline.baselineVersion,
  originalReferenceHashesVerified: Object.keys(featureReference.files).length,
  pages: originalPages.length,
  widths: [1440, 1280, 375, 320],
  checks: results,
  incrementalChecks: incrementalResults,
  contextChecks: contextResults,
  errors,
};
async function navigationAcceptance(page, expected, width) {
  assertLanguageHeader(await page.evaluate(languageHeaderGeometry), 'zh-CN');
  return checkNavigation(page, expected, width, navigationBaseline);
}

async function geometry(page) {
  return page.evaluate(() => {
    const scope = document.querySelector('[data-liekan-features]') || document.body;
    const style = getComputedStyle(scope),
      main = document.querySelector('#main-content') || document.querySelector('main');
    const rect = main?.getBoundingClientRect();
    const select = [...scope.querySelectorAll('select')]
      .filter(el => !el.closest('[data-language-placement="header"]'))
      .map(el => {
        const s = getComputedStyle(el);
        const wrap = el.closest('.select-wrap,.context-select'),
          arrow = wrap?.querySelector('svg');
        return {
          right: s.backgroundPosition,
          padding: parseFloat(s.paddingRight),
          inset: arrow
            ? wrap.getBoundingClientRect().right - arrow.getBoundingClientRect().right
            : null,
        };
      });
    const panels = [...scope.querySelectorAll('.panel,[data-liekan-report-panel]')]
      .slice(0, 4)
      .map(el => {
        const s = getComputedStyle(el);
        return { radius: s.borderRadius, border: s.borderColor, bg: s.backgroundColor };
      });
    const arrows = [...scope.querySelectorAll('.btn')].flatMap(el => {
      const icon = el.lastElementChild;
      if (icon?.tagName.toLowerCase() !== 'svg') return [];
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return [];
      const i = icon.getBoundingClientRect();
      return [r.right - i.right];
    });
    return {
      font: style.fontFamily,
      brand: style.getPropertyValue('--brand').trim().toLowerCase(),
      canvas: style.getPropertyValue('--canvas').trim().toLowerCase(),
      ink: style.getPropertyValue('--ink').trim().toLowerCase(),
      overflow: document.documentElement.scrollWidth - innerWidth,
      main: rect ? { left: rect.left, width: rect.width } : null,
      select,
      panels,
      contentCount:
        main?.querySelectorAll('.panel,[data-liekan-report-panel],.state-box,.notice,form,table')
          .length ||
        scope.querySelectorAll('.auth-form,form').length ||
        0,
      arrows,
      title: (main?.querySelector('h1') || document.querySelector('h1'))?.textContent,
      charts: scope.querySelectorAll('canvas').length,
      bodyText: document.body.innerText,
    };
  });
}
async function ready(page, requireCanvas = false) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-liekan-features]', { timeout: 30000 });
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('.state-box')].some(el => el.textContent.includes('正在加载')),
    {},
    { timeout: 30000 },
  );
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  if (requireCanvas)
    await page.locator('canvas').first().waitFor({ state: 'attached', timeout: 15000 });
  await page.waitForFunction(
    () => [...document.querySelectorAll('.chart')].every(el => el.querySelector('canvas,svg')),
    {},
    { timeout: 15000 },
  );
  await page.evaluate(
    () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}
function params(id) {
  const value = {
    websiteId: seed.website.id,
    date: `range:${seed.range.startAt}:${seed.range.endAt}:day`,
    unit: 'day',
  };
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
  if (ids[id]) value.id = ids[id];
  if (id === 'share-preview') value.slug = share.slug;
  if (id === 'event-detail') value.eventName = seed.data.eventNames[0];
  if (id === 'path-detail') {
    value.sequence = JSON.stringify(journey.rows[0]?.nodes || []);
    value.steps = '3';
    value.type = 'all';
  }
  return new URLSearchParams(value);
}
try {
  await actual.goto(base + '/login');
  await actual.locator('input[name="username"]').fill(seed.admin.username);
  await actual.locator('input[name="password"]').fill(seed.admin.password);
  await actual.getByRole('button', { name: '登录', exact: true }).click();
  await actual.waitForURL(url => !url.pathname.includes('/login'));
  for (const width of report.widths) {
    // These are isolated contexts; no user browser window is resized.
    await actual.setViewportSize({ width, height: 1000 });
    await reference.setViewportSize({ width, height: 1000 });
    await auth.setViewportSize({ width, height: 1000 });
    for (const p of incrementalPages) {
      await actual.goto(base + `/liekan/${p.id}?${params(p.id)}`);
      await ready(actual);
      const current = await geometry(actual);
      assert(current.contentCount > 0, `${p.id} has no rendered content`);
      assert.equal(current.overflow, 0, `${p.id} viewport overflow`);
      assert.equal(current.title, navigationBaseline.pages[p.id].title, `${p.id} visible title`);
      assert(!current.bodyText.includes('读取失败'), `${p.id} failed to read actual data`);
      const navigation = await navigationAcceptance(actual, navigationBaseline.pages[p.id], width);
      await actual.screenshot({
        path: `${out}/${p.id}-${width}-actual.png`,
        fullPage: true,
        animations: 'disabled',
      });
      incrementalResults.push({ id: p.id, width, passed: true, navigation });
    }
    for (const p of originalPages) {
      const authPage = ['login', 'login-2fa', 'sso'].includes(p.id),
        page = authPage ? auth : actual;
      const target =
        p.id === 'share-preview'
          ? '/share/' + encodeURIComponent(share.slug)
          : p.id === 'login'
            ? '/login'
            : p.id === 'login-2fa'
              ? '/login/two-factor'
              : p.id === 'sso'
                ? '/sso'
                : `/liekan/${p.id}?${params(p.id)}`;
      try {
        await page.goto(base + target);
        await ready(page);
        if (p.id === 'attribution') {
          await page.locator('input[name=step]').fill(seed.data.eventNames[0]);
          await page.getByRole('button', { name: '应用归因设置', exact: true }).click();
          await ready(page);
        }
        await reference.goto(base + '/__prototype/' + p.id + '.html');
        await reference.waitForSelector('h1:visible,.public-brand', { timeout: 15000 });
        await reference.evaluate(() => document.fonts.ready);
        await reference.waitForFunction(
          () =>
            [...document.querySelectorAll('.chart')].every(el => el.querySelector('canvas,svg')),
          {},
          { timeout: 15000 },
        );
        // Prototype-only review controls have no production counterpart.
        await reference.evaluate(() =>
          document.querySelectorAll('.preview-tools,.route-summary').forEach(el => el.remove()),
        );
        const expected = await geometry(reference);
        const navigation = await navigationAcceptance(page, navigationBaseline.pages[p.id], width);
        const chartStates = {
          funnels: 'No saved funnel fixture',
          heatmaps: 'Collected page selection required',
          'backup-codes': 'One-time codes require setup flow',
        };
        await ready(page, expected.charts > 0 && !chartStates[p.id]);
        const current = await geometry(page);
        assert(current.contentCount > 0, `${p.id} has no rendered content`);
        if (expected.panels.length && p.id !== 'backup-codes')
          assert(current.panels.length > 0, `${p.id} missing approved panel structure`);
        if (expected.charts > 0 && !chartStates[p.id])
          assert(current.charts > 0, `${p.id} missing rendered statistical chart`);
        assert.equal(
          current.overflow,
          0,
          `${p.id} ${width}px overflows viewport by ${current.overflow}px`,
        );
        for (const key of ['brand', 'canvas', 'ink'])
          assert.equal(
            current[key],
            expected[key],
            `${p.id} ${width}px ${key} differs from approved VI`,
          );
        assert.equal(
          current.font,
          expected.font,
          `${p.id} ${width}px font differs from approved VI`,
        );
        for (const panel of current.panels) {
          assert.equal(panel.radius, '14px', `${p.id} panel radius`);
          if (expected.panels.length) {
            assert.equal(panel.border, expected.panels[0].border, `${p.id} panel border VI`);
            assert.equal(panel.bg, expected.panels[0].bg, `${p.id} panel background VI`);
          }
        }
        for (const select of current.select) {
          assert(select.padding >= 38, `${p.id} select text needs arrow spacing`);
          assert(
            select.inset == null ? select.right.includes('12px') : Math.abs(select.inset - 12) < 1,
            `${p.id} select arrow needs 12px right inset`,
          );
        }
        for (const gap of current.arrows)
          assert(gap >= 10, `${p.id} arrow/icon touches the right border (${gap}px)`);
        const approvedTitle =
          navigationBaseline.standaloneHeadings[p.id] || navigationBaseline.pages[p.id].title;
        if (p.id !== 'share-preview')
          assert.equal(current.title, approvedTitle, `${p.id} approved visible title`);
        assert(!current.bodyText.includes('读取失败'), `${p.id} failed to read actual data`);
        if (
          expected.main &&
          current.main &&
          !['auth', 'public'].includes(navigationBaseline.pages[p.id].scope)
        ) {
          assert(
            Math.abs(current.main.left - expected.main.left) < 2,
            `${p.id} content left differs`,
          );
          assert(
            Math.abs(current.main.width - expected.main.width) < 2,
            `${p.id} content width differs`,
          );
        }
        await page.screenshot({
          path: `${out}/${p.id}-${width}-actual.png`,
          fullPage: true,
          animations: 'disabled',
        });
        await reference.screenshot({
          path: `${out}/${p.id}-${width}-reference.png`,
          fullPage: true,
          animations: 'disabled',
        });
        results.push({
          id: p.id,
          width,
          passed: true,
          title: current.title,
          charts: current.charts,
          navigation,
          geometry: { main: current.main, select: current.select },
          scope:
            'Approved VI, shell geometry, control spacing and viewport containment; actual data and permission/setup states preserved',
        });
      } catch (error) {
        console.error(`${p.id} ${width}px: ${error.message}`);
        await page
          .screenshot({ path: `${out}/${p.id}-${width}-failed.png`, fullPage: true })
          .catch(() => {});
        results.push({ id: p.id, width, passed: false, error: error.message });
      }
    }
    for (const approved of navigationBaseline.contextCases) {
      const target = approved.route
        .replace('{websiteId}', seed.website.id)
        .replace('{teamId}', seed.team.id);
      try {
        await actual.goto(base + target);
        await ready(actual);
        const current = await geometry(actual);
        const navigation = await navigationAcceptance(actual, approved, width);
        assert.equal(current.title, approved.title, `${approved.id} context title`);
        assert.equal(current.overflow, 0, `${approved.id} ${width}px overflow`);
        assert(current.contentCount > 0, `${approved.id} has no context content`);
        assert(
          !current.bodyText.includes('读取失败'),
          `${approved.id} failed to read actual context data`,
        );
        await actual.screenshot({
          path: `${out}/${approved.id}-${width}-actual.png`,
          fullPage: true,
          animations: 'disabled',
        });
        contextResults.push({ id: approved.id, width, passed: true, navigation });
      } catch (error) {
        console.error(`${approved.id} ${width}px: ${error.message}`);
        await actual
          .screenshot({ path: `${out}/${approved.id}-${width}-failed.png`, fullPage: true })
          .catch(() => {});
        contextResults.push({ id: approved.id, width, passed: false, error: error.message });
      }
    }
  }
  assert.equal(
    contextResults.length,
    navigationBaseline.contextCases.length * report.widths.length,
    'All explicit context cases must run',
  );
  assert(
    contextResults.every(r => r.passed),
    contextResults
      .filter(r => !r.passed)
      .map(r => `${r.id} ${r.width}: ${r.error}`)
      .join('\n'),
  );
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(incrementalResults.length, incrementalPages.length * report.widths.length);
  assert(
    results.length === originalPages.length * report.widths.length && results.every(r => r.passed),
    results
      .filter(r => !r.passed)
      .map(r => `${r.id} ${r.width}: ${r.error}`)
      .join('\n'),
  );
  report.mobile = await checkMobileExperience({
    base,
    seed,
    board,
    share,
    partial,
    journey,
    token: adminToken,
  });
  const fixtureWebsite = await api('GET', '/websites/' + seed.website.id);
  assert.equal(fixtureWebsite.id, seed.website.id, 'English routes address the fixture website');
  const fixtureWebsiteHandle = fixtureWebsite.siteNumber ?? fixtureWebsite.id;
  const geoRoutes = [
    '',
    '/ai',
    '/ai/bots',
    '/ai/pages',
    '/ai/preference',
    '/human',
    '/human/geo',
    '/human/sources',
    '/human/search-engines',
    '/human/keywords',
    '/content',
    '/conversions',
    '/logs',
  ];
  const titleAst = ts.createSourceFile(
    'navigation.ts',
    fs.readFileSync('src/lib/liekan/contracts/navigation.ts', 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const titleOverrides = {};
  const collectTitles = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(titleAst) === 'titles') {
      assert(ts.isObjectLiteralExpression(node.initializer));
      for (const property of node.initializer.properties) {
        assert(ts.isPropertyAssignment(property) && ts.isStringLiteral(property.initializer));
        titleOverrides[property.name.text || property.name.getText(titleAst)] =
          property.initializer.text;
      }
    }
    ts.forEachChild(node, collectTitles);
  };
  collectTitles(titleAst);
  assert(Object.keys(titleOverrides).length > 0, 'Approved navigation document titles loaded');
  const geoExpectedKeys = [
    'index',
    'ai',
    'ai-bots',
    'ai-pages',
    'ai-preference',
    'human',
    'human-geo',
    'human-source',
    'human-search-engines',
    'human-keywords',
    'content',
    'funnel',
    'logs',
  ];
  const englishRoutes = manifest.pages.map(p => ({
    id: p.id,
    heading:
      navigationBaseline.standaloneHeadings[p.id] ||
      navigationBaseline.pages[p.id]?.title ||
      p.title,
    documentTitle: titleOverrides[p.id] || p.title,
    shareName: p.id === 'share-preview' ? share.name : undefined,
    previewPath: p.id === 'share-preview' ? `/liekan/share-preview?${params(p.id)}` : undefined,
    path:
      p.id === 'share-preview'
        ? '/share/' + encodeURIComponent(share.slug)
        : p.id === 'login'
          ? '/login'
          : p.id === 'login-2fa'
            ? '/login/two-factor'
            : p.id === 'sso'
              ? '/sso'
              : `/liekan/${p.id}?${params(p.id)}`,
  }));
  englishRoutes.push(
    ...geoRoutes.map((suffix, index) => ({
      id: `geo-${index}`,
      heading: navigationBaseline.geo[geoExpectedKeys[index]].title,
      documentTitle: navigationBaseline.geo[geoExpectedKeys[index]].title,
      path: `/websites/${fixtureWebsiteHandle}/geo${suffix}?${params('overview')}`,
    })),
    {
      id: 'help',
      path: '/liekan/help',
      heading: navigationBaseline.pages.help.title,
      documentTitle: titleOverrides.help,
    },
  );
  report.english = await checkEnglishExperience({
    browser,
    base,
    seed,
    token: adminToken,
    partial,
    routes: englishRoutes,
  });
  report.passed = true;
} catch (error) {
  report.error = error.message;
  throw error;
} finally {
  fs.writeFileSync(out + '/report.json', JSON.stringify(report, null, 2));
  await browser.close();
  await api('DELETE', '/share/id/' + share.id);
  await api('DELETE', '/boards/' + board.id);
  await api('DELETE', '/reports/' + goal.id);
  await api('DELETE', '/admin/users/' + identity.id + '/2fa');
  await api('DELETE', '/users/' + identity.id);
}
console.log(
  JSON.stringify({
    head,
    passed: true,
    pages: originalPages.length,
    widths: report.widths,
    checks: results.length,
    contextChecks: contextResults.length,
    report: out + '/report.json',
  }),
);
