import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium, expect } from '@playwright/test';
import { isolatedAcceptanceTarget, acceptanceSeedFile } from './liekan-acceptance-target.mjs';
import {
  manualReadInventory,
  manualPageReads,
  assertManualPageReads,
} from './liekan-manual-read-contract.mjs';

const base = process.env.LIEKAN_URL || 'http://127.0.0.1:3302';
const target = isolatedAcceptanceTarget(base);
const seed = JSON.parse(fs.readFileSync(acceptanceSeedFile(target), 'utf8'));
const inventory = manualReadInventory();
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
let token;
async function api(method, path, body) {
  const response = await fetch(base + '/api' + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(response.status, 200, `${method} ${path}: ${response.status}`);
  return response.json();
}
token = (await api('POST', '/auth/login', seed.admin)).token;
const board = await api('POST', '/boards', {
  name: '手动读取验收 · 隔离看板',
  type: 'website',
  parameters: {
    websiteId: seed.website.id,
    rows: [
      {
        id: 'manual-row',
        columns: [
          {
            id: 'manual-component',
            size: 100,
            component: {
              title: '访客趋势',
              type: 'WebsiteChart',
              entityType: 'website',
              entityId: seed.website.id,
            },
          },
        ],
      },
    ],
  },
});
const share = await api('POST', '/share', {
  name: '手动读取验收 · 隔离分享',
  entityId: seed.website.id,
  shareType: 1,
  parameters: { overview: true, events: true, allowFilter: true },
});
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
const rows = data => (Array.isArray(data) ? data : data.data || []);
const goalDefinitions = rows(await api('GET', `/websites/${seed.website.id}/goals?pageSize=100`));
const funnelDefinitions = rows(
  await api('GET', `/websites/${seed.website.id}/funnels?pageSize=100`),
);
assert(journey.rows[0]?.nodes?.length, 'Journey detail requires an observed sequence fixture');
const browser = await chromium.launch({
  headless: true,
  ignoreDefaultArgs: ['--disable-back-forward-cache'],
  ...(!process.env.CI ? { channel: 'chrome' } : {}),
});
const out = 'test-results/liekan-manual-refresh';
fs.mkdirSync(out, { recursive: true });
const report = {
  head,
  passed: false,
  finalized: false,
  featureIds: inventory.features.map(page => page.id),
  routes: inventory.routes.map(route => route.source),
  pageFiles: inventory.files,
  definitionCounts: { goals: goalDefinitions.length, funnels: funnelDefinitions.length },
  checks: [],
  realIdle: [],
  errors: [],
  httpReads: [],
};
const save = () => fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
const describeRead = request => {
  const url = new URL(request.url());
  return {
    path: url.pathname,
    ...Object.fromEntries(
      ['kind', 'type', 'resource', 'eventName', 'sessionId']
        .filter(key => url.searchParams.has(key))
        .map(key => [key, url.searchParams.get(key)]),
    ),
  };
};
const ordinary = request => {
  const path = new URL(request.url()).pathname;
  return (
    path.startsWith('/api/') &&
    request.method() === 'GET' &&
    !['/api/auth/verify', '/api/2fa/status', '/api/auth/subscription'].includes(path) &&
    !/^\/api\/admin\/users\/[^/]+\/2fa$/.test(path) &&
    !/^\/api\/share\/[^/]+$/.test(path)
  );
};
let lastForcedRead = 0;
const forcedInFlight = new Set();
const forcedFailures = [];
async function waitForForcedReadCooldown() {
  await expect(() => assert.equal(forcedInFlight.size, 0, 'Forced reads still in flight')).toPass({
    timeout: 30000,
    intervals: [100, 250, 500],
  });
  assert.equal(forcedFailures.length, 0, 'Forced read was cancelled before completion');
  // The server starts its cooldown after authentication and permission checks.
  // HTTP completion provides a safe anchor across sequential pages sharing one actor.
  while (Date.now() - lastForcedRead < 5100)
    await new Promise(resolve => setTimeout(resolve, 5100 - (Date.now() - lastForcedRead)));
}
async function open(url, authenticated = true) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: 'zh-CN',
  });
  if (authenticated)
    await context.addInitScript(
      ({ origin, token }) => {
        if (location.origin !== origin || sessionStorage.getItem('manual.auth.seeded')) return;
        sessionStorage.setItem('manual.auth.seeded', '1');
        localStorage.setItem('umami.auth', JSON.stringify(token));
      },
      { origin: target.origin, token },
    );
  const page = await context.newPage();
  await context.addInitScript(() => {
    window.addEventListener('pageshow', event => {
      window.__manualPageShow = { trusted: event.isTrusted, persisted: event.persisted };
    });
  });
  const reads = [],
    successes = [],
    logouts = [];
  const requestDetails = new WeakMap();
  page.on('request', request => {
    if (ordinary(request)) {
      const url = new URL(request.url());
      reads.push(url.pathname);
      const detail = {
        ...describeRead(request),
        refresh: url.searchParams.get('refresh') === '1',
        startedAt: Date.now(),
      };
      requestDetails.set(request, detail);
      report.httpReads.push(detail);
      if (detail.refresh) forcedInFlight.add(request);
    }
  });
  page.on('response', response => {
    const detail = requestDetails.get(response.request());
    if (detail) {
      detail.status = response.status();
      detail.retryAfter = response.headers()['retry-after'] ?? null;
    }
    if (
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/auth/logout'
    )
      logouts.push(response.status());
    if (
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname.startsWith('/api/') &&
      response.ok()
    )
      successes.push(describeRead(response.request()));
  });
  page.on('requestfinished', request => {
    const detail = requestDetails.get(request);
    if (detail) detail.finishedAt = Date.now();
    if (forcedInFlight.delete(request)) lastForcedRead = Date.now();
  });
  page.on('requestfailed', request => {
    const detail = requestDetails.get(request);
    if (detail) {
      detail.finishedAt = Date.now();
      detail.failure = request.failure()?.errorText ?? 'Request failed';
    }
    if (forcedInFlight.delete(request)) forcedFailures.push(detail);
  });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(base + url);
  await ready(page);
  return { context, page, reads, successes, logouts };
}
async function ready(page) {
  await page.waitForLoadState('networkidle');
  // Legacy public reports use h2 headings and expose the shared refresh control.
  await page.waitForFunction(() => !!document.querySelector('main,h1,form,[data-manual-refresh]'));
  await page.waitForFunction(
    () => !document.querySelector('[data-manual-refresh]:disabled'),
    null,
    { timeout: 30000 },
  );
}
async function verifyPageReads(page, policy, successes, label, from = 0) {
  // SPA history changes the URL before React mounts the returning page and starts its reads.
  await expect(() => assertManualPageReads(policy, successes.slice(from), label)).toPass({
    timeout: 30000,
    intervals: [100, 250, 500],
  });
  await ready(page);
}
function parameters(id) {
  const value = {
    websiteId: seed.website.id,
    date: `range:${seed.range.startAt}:${Date.now()}:day`,
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
    'board-editor': board.id,
    'share-preview': share.id,
  };
  if (ids[id]) value.id = ids[id];
  if (id === 'share-preview') value.slug = share.slug;
  if (id === 'event-detail') value.eventName = seed.data.eventNames[0];
  if (id === 'path-detail')
    Object.assign(value, {
      sequence: JSON.stringify(journey.rows[0]?.nodes || []),
      steps: '3',
      type: 'all',
    });
  return new URLSearchParams(value);
}
const identities = new Set(['login', 'login-2fa', 'sso']);
const cases = inventory.features.map(feature => ({
  id: feature.id,
  featureId: feature.id,
  resourceId: parameters(feature.id).get('id'),
  url: identities.has(feature.id)
    ? feature.id === 'login-2fa'
      ? '/login/two-factor'
      : '/' + feature.id
    : `/liekan/${feature.id}?${parameters(feature.id)}`,
  authenticated: !identities.has(feature.id),
}));
const values = {
  websiteId: seed.website.id,
  teamId: seed.team.id,
  userId: seed.user.id,
  boardId: board.id,
  linkId: seed.link.id,
  pixelId: seed.pixel.id,
  sessionId: seed.data.sessionId,
  replayId: seed.data.replayVisitId,
  slug: share.slug,
};
for (const route of [...inventory.routes, ...inventory.geo]) {
  if (route.route.includes('[[...path]]')) continue;
  if (route.entry === '弹层拦截') continue; // Their direct detail and modal flows have separate UI acceptance.
  const url = route.route.replace(/\[([^\]]+)\]/g, (_, key) => values[key]);
  const geoResource = /resource="([^"]+)"/.exec(fs.readFileSync(route.source, 'utf8'))?.[1];
  const featureId = geoResource
    ? `geo:${geoResource}`
    : route.target === 'reference/index.html'
      ? 'geo:overview'
      : route.target.replace('.html', '');
  const resourceKey = [...route.route.matchAll(/\[([^\]]+)\]/g)]
    .map(match => match[1])
    .find(key => key !== 'websiteId');
  cases.push({
    id: route.source,
    featureId: route.route === '/boards/create' ? 'boards' : featureId,
    resourceId: resourceKey ? values[resourceKey] : null,
    url,
    authenticated: !['/login', '/login/two-factor', '/sso'].includes(url),
  });
}
cases.push(
  {
    id: 'public-share',
    featureId: 'public-share',
    url: `/share/${share.slug}`,
    authenticated: false,
  },
  {
    id: 'legacy-public-share',
    featureId: 'legacy-public-share',
    url: `/share/${share.slug}?legacy=1`,
    authenticated: false,
  },
  { id: 'help', featureId: 'help', url: '/liekan/help' },
  { id: 'dashboard', featureId: 'dashboard', url: '/dashboard' },
  { id: 'dashboard-edit', featureId: 'dashboard-edit', url: '/dashboard/edit' },
);
const seen = new Set();
const realCases = [
  '/websites',
  `/websites/${seed.website.id}/geo`,
  `/websites/${seed.website.id}/realtime`,
  `/websites/${seed.website.id}/geo/logs`,
];
let realSessions = [];
try {
  // These contexts run concurrently with route coverage, using real elapsed time.
  realSessions = await Promise.all(realCases.map(url => open(url)));
  const realPolicies = ['websites', 'geo:overview', 'realtime', 'geo:logs'].map(id =>
    manualPageReads(id, { websiteId: seed.website.id }),
  );
  await Promise.all(
    realSessions.map((session, index) =>
      verifyPageReads(
        session.page,
        realPolicies[index],
        session.successes,
        `${realCases[index]}: real idle entry`,
      ),
    ),
  );
  const realStarted = Date.now();
  const realBaselines = realSessions.map(session => session.reads.length);
  // This untouched clock context must exercise an actual BFCache return.
  const history = await open(`/share/${share.slug}`, false);
  try {
    // Native history navigation avoids Playwright's unsupported BFCache load lifecycle.
    const native = await history.context.newCDPSession(history.page);
    await native.send('Page.enable');
    const entries = await native.send('Page.getNavigationHistory');
    const entryId = entries.entries[entries.currentIndex].id;
    await history.page.evaluate(() => {
      window.__manualAcceptanceLifetime = 'cached-history';
    });
    await history.page.goto(base + '/liekan/help');
    await ready(history.page);
    const prior = history.successes.length;
    const read = history.page.waitForResponse(
      response =>
        response.ok() &&
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname.endsWith('/shared-report'),
    );
    await native.send('Page.navigateToHistoryEntry', { entryId });
    await read;
    await ready(history.page);
    const state = await native.send('Runtime.evaluate', {
      expression:
        'JSON.stringify({marker:window.__manualAcceptanceLifetime,event:window.__manualPageShow})',
      returnByValue: true,
    });
    const restored = JSON.parse(state.result.value);
    assert.equal(
      restored.marker,
      'cached-history',
      'History return did not preserve the cached document',
    );
    assert.deepEqual(
      restored.event,
      { trusted: true, persisted: true },
      'No actual BFCache pageshow was observed',
    );
    assertManualPageReads(
      manualPageReads('public-share', { websiteId: seed.website.id }),
      history.successes.slice(prior),
      'BFCache history return',
    );
    report.cachedHistory = {
      passed: true,
      driver: 'native-browser-history',
      restored,
      newReads: history.successes.length - prior,
    };
    save();
  } finally {
    await history.context.close();
  }
  for (const item of cases) {
    const key = `${item.authenticated !== false}:${item.url}`;
    if (seen.has(key)) {
      report.checks.push({ id: item.id, aliasOf: key });
      continue;
    }
    seen.add(key);
    const { context, page, reads, successes, logouts } = await open(
      item.url,
      item.authenticated !== false,
    );
    try {
      const policy = manualPageReads(item.featureId, {
        websiteId: seed.website.id,
        id: item.resourceId,
        eventName: seed.data.eventNames[0],
        goalId: goalDefinitions[0]?.id,
        funnelId: funnelDefinitions[0]?.id,
      });
      if (item.url === '/logout') {
        await page.waitForURL(url => url.pathname === '/login');
        assert.equal(
          await page.evaluate(() => localStorage.getItem('umami.auth') === null),
          true,
          'Logout retained client credentials',
        );
        assert.deepEqual(logouts, [200], 'Logout did not submit exactly one successful request');
        assert(
          reads.every(path => path === '/api/config'),
          'Logout read private page data',
        );
        policy.exception = '退出登录清理凭据并返回登录页面';
      }
      await verifyPageReads(page, policy, successes, `${item.id}: entry`);
      const initial = reads.length,
        successful = successes.length;
      const unresolved = page
        .getByRole('alert')
        .filter({ hasText: /读取失败|请求失败|当前页面数据无法读取/ });
      assert.equal(await unresolved.count(), 0, `${item.id}: ordinary entry failed`);
      const menuLink = page.locator('a[href^="/liekan/help"]').first();
      if (await menuLink.count()) {
        await menuLink.hover();
        await menuLink.focus();
        await ready(page);
        assert.equal(reads.length, initial, `${item.id}: menu hover or focus read`);
      }
      await page.clock.install({ time: new Date() });
      await page.clock.fastForward(600000);
      await ready(page);
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          value: 'visible',
        });
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      });
      await context.setOffline(true);
      await context.setOffline(false);
      await ready(page);
      assert.equal(reads.length, initial, `${item.id}: ordinary idle/focus/reconnect read`);
      const control = page.locator('[data-manual-refresh]').first();
      let refreshed = null;
      if (policy.endpoints.length) {
        assert(await control.isVisible(), `${item.id}: missing refresh control`);
        // Sequential page checks share one actor and respect the existing forced-read limit.
        await waitForForcedReadCooldown();
        const prior = successes.length;
        await control.click();
        await ready(page);
        await verifyPageReads(page, policy, successes, `${item.id}: manual refresh`, prior);
        refreshed = reads.length - initial;
      }
      let reentry = policy.exception;
      if (policy.endpoints.length) {
        const marker = `manual-${report.checks.length}`;
        await page.evaluate(marker => {
          window.__manualAcceptanceLifetime = marker;
        }, marker);
        const previousUrl = page.url();
        const native = await context.newCDPSession(page);
        await native.send('Page.enable');
        const entries = await native.send('Page.getNavigationHistory');
        const entryId = entries.entries[entries.currentIndex].id;
        let away = page.locator('a[href^="/liekan/help"]').first();
        if (!(await away.count())) away = page.locator('a[href*="/events"]').first();
        const publicLayout = ['public-share', 'legacy-public-share', 'share-preview'].includes(
          item.featureId,
        );
        if (publicLayout) await page.goto(base + '/liekan/help');
        else {
          assert(await away.count(), `${item.id}: no in-app navigation for reentry`);
          await away.click();
        }
        await page.waitForURL(url => url.href !== previousUrl);
        await ready(page);
        if (!publicLayout)
          assert.equal(
            await page.evaluate(() => window.__manualAcceptanceLifetime),
            marker,
            `${item.id}: navigation reloaded the document`,
          );
        const prior = successes.length;
        await native.send('Page.navigateToHistoryEntry', { entryId });
        await ready(page);
        if (!publicLayout)
          assert.equal(
            await page.evaluate(() => window.__manualAcceptanceLifetime),
            marker,
            `${item.id}: return reloaded the document`,
          );
        await verifyPageReads(page, policy, successes, `${item.id}: SPA reentry`, prior);
        reentry = publicLayout
          ? '整页导航离开后浏览器历史返回，页面数据重新读取'
          : 'SPA 同一文档历史返回，页面数据重新读取';
      }
      report.checks.push({
        id: item.id,
        featureId: item.featureId,
        url: item.url.split('?')[0],
        expected: policy.endpoints,
        exception: policy.exception,
        initial,
        successful,
        idleDelta: 0,
        refreshed,
        reentry,
        ...(item.url === '/logout' ? { logoutStatuses: logouts } : {}),
      });
      save();
    } finally {
      await context.close();
    }
  }
  // A valid tracker record proves recomputation, with no production data mutation.
  const session = realSessions[1];
  const metric = session.page.locator('[class*="metricValue"]');
  assert((await metric.count()) > 0, 'Real overview has no rendered metrics');
  const renderedBefore = await metric.allTextContents();
  const statsPath =
    `/websites/${seed.website.id}/stats?` +
    new URLSearchParams({
      ...seed.range,
      endAt: Date.now() + 60000,
      timezone: 'UTC',
      refresh: '1',
    });
  const before = await api('GET', statsPath);
  const beforeReadAt = Date.now();
  const userAgent = await session.page.evaluate(() => navigator.userAgent);
  await api('POST', '/send', {
    type: 'event',
    payload: {
      website: seed.website.id,
      hostname: seed.website.domain,
      url: '/manual-refresh-acceptance',
      title: 'Manual read acceptance',
      language: 'zh-CN',
      screen: '1440x1000',
      userAgent,
    },
  });
  // Respect the existing five-second forced-read limit.
  while (Date.now() - realStarted < 600000 || Date.now() - beforeReadAt < 5100)
    await new Promise(resolve =>
      setTimeout(
        resolve,
        Math.min(
          30000,
          Math.max(600000 - (Date.now() - realStarted), 5100 - (Date.now() - beforeReadAt)),
        ),
      ),
    );
  for (const [index, value] of realSessions.entries()) {
    assert.equal(
      value.reads.length,
      realBaselines[index],
      `${realCases[index]}: real ten-minute idle read`,
    );
    report.realIdle.push({
      url: realCases[index],
      seconds: (Date.now() - realStarted) / 1000,
      initial: realBaselines[index],
      idleDelta: 0,
    });
  }
  await session.page.locator('[data-manual-refresh]').first().click();
  await ready(session.page);
  const renderedAfter = await metric.allTextContents();
  assert.notDeepEqual(
    renderedAfter,
    renderedBefore,
    'Overview did not render the new tracker data after manual refresh',
  );
  const after = await api('GET', statsPath);
  assert(
    Number(after.pageviews?.value ?? after.pageviews) >
      Number(before.pageviews?.value ?? before.pageviews),
    'Forced statistics did not include the valid new event',
  );
  report.dataChange = {
    before: Number(before.pageviews?.value ?? before.pageviews),
    after: Number(after.pageviews?.value ?? after.pageviews),
    renderedBefore,
    renderedAfter,
  };
  assert.deepEqual(
    new Set(inventory.features.map(value => value.id)),
    new Set(
      report.checks
        .filter(value => inventory.features.some(page => page.id === value.id))
        .map(value => value.id),
    ),
  );
  assert.equal(report.errors.length, 0, 'Browser runtime errors');
  report.passed = true;
  report.finalized = true;
  save();
} finally {
  await Promise.all(realSessions.map(session => session.context.close()));
  await browser.close();
  save();
}
