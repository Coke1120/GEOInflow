import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

/** Uses an isolated headless context; no user browser viewport is changed. */
export async function measureCacheBrowser({
  base,
  token,
  site,
  siteHandle = site,
  slug,
  range,
  canonicalShareRange,
  samples,
  directory,
}) {
  assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    reducedMotion: 'reduce',
  });
  const outcomes = [];
  const publicOutcomes = [];
  const received = [];
  const jobEvents = [],
    jobOrigins = new Map();
  const issued = [];
  const errors = [];
  const apiResponses = [];
  const faultOutcomes = [];
  let faultProbe = false;
  const quantile = (values, q) =>
    [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1];
  try {
    await context.addInitScript(
      ({ token }) => {
        localStorage.setItem('umami.auth', JSON.stringify(token));
        localStorage.setItem('umami.timezone', JSON.stringify('Asia/Shanghai'));
        localStorage.setItem('umami.locale', JSON.stringify('zh-CN'));
      },
      { token },
    );
    const page = await context.newPage();
    const monitor = (page, name) => {
      page.on('pageerror', error =>
        errors.push({ kind: `${name}-page-error`, message: error.message.slice(0, 2000) }),
      );
      page.on('response', response => {
        const path = new URL(response.url()).pathname;
        if (path.startsWith('/api/'))
          apiResponses.push({ page: name, path, status: response.status() });
        if (path.startsWith('/api/') && response.status() >= 400)
          (faultProbe ? faultOutcomes : errors).push(`${name}-http-${response.status()}`);
      });
      page.on('requestfailed', request => {
        const reason = request.failure()?.errorText;
        if (reason !== 'net::ERR_ABORTED')
          (faultProbe ? faultOutcomes : errors).push(`${name}-request-${reason}`);
      });
    };
    monitor(page, 'private');
    const privateRange = { ...range, endAt: range.endAt - 2 * 86400000 };
    const suffix = `?date=range:${privateRange.startAt}:${privateRange.endAt}&dateMode=custom`;
    const observed = new Map();
    const capture = response => {
      void (async () => {
        const url = new URL(response.url());
        const task = /\/analytics-jobs\/([^/]+)\/result$/.exec(url.pathname);
        if (!task && !/\/(?:page-report|shared-report|stats)$/.test(url.pathname)) return;
        if (response.status() === 202) {
          const body = await response.json();
          assert(body.analysisJob?.id, 'accepted analytics response must identify a durable task');
          jobOrigins.set(body.analysisJob.id, {
            path: url.pathname,
            parameters: Object.fromEntries(url.searchParams),
          });
          jobEvents.push({
            id: body.analysisJob.id,
            phase: 'accepted',
            path: url.pathname,
            status: 202,
          });
          return;
        }
        const origin = task && jobOrigins.get(task[1]);
        if (task && !origin) return;
        const headers = response.headers();
        const record = {
          path: origin?.path || url.pathname,
          parameters: origin?.parameters || Object.fromEntries(url.searchParams),
          status: response.status(),
          tier: headers['x-liekan-cache-tier'],
          generatedAt: Number(headers['x-liekan-generated-at']),
          expiresAt: Number(headers['x-liekan-expires-at']),
          ...(task ? { jobId: task[1] } : {}),
        };
        if (task) jobEvents.push({ id: task[1], phase: 'result', status: response.status() });
        observed.set(record.path, record);
        received.push(record);
      })().catch(error => errors.push({ kind: 'capture', message: error.message }));
    };
    page.on('response', capture);
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname === `/api/liekan/websites/${site}/page-report`)
        issued.push({ path: url.pathname, parameters: Object.fromEntries(url.searchParams) });
    });
    const chartReady = async (page, selector) => {
      await page.waitForFunction(selector => {
        const root = document.querySelector(selector);
        if (!root?.getClientRects().length || root.getAttribute('aria-busy') === 'true')
          return false;
        const canvas = root.matches('canvas') ? root : root.querySelector('canvas');
        if (canvas?.width && canvas?.height) {
          const pixels = canvas
            .getContext('2d')
            ?.getImageData(0, 0, canvas.width, canvas.height).data;
          if (pixels) for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) return true;
        }
        return !!root.querySelector('svg path,svg line,svg rect,svg text');
      }, selector);
      await page.evaluate(
        () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
    };
    const validateRange = (parameters, expected) => {
      assert.equal(Number(parameters.startAt), expected.startAt);
      assert.equal(Number(parameters.endAt), expected.endAt);
      assert.equal(parameters.timezone, expected.timezone);
    };
    const validateRanges = (requests, expected) =>
      requests.forEach(record => {
        assert.equal(record.status, 200);
        validateRange(record.parameters, expected);
      });
    const human = `/websites/${site}/geo/human${suffix}`;
    const sourcePath = `/websites/${siteHandle}/geo/human/sources`;
    const humanPath = `/websites/${siteHandle}/geo/human`;
    const ready = async (heading, metric) => {
      await page.getByRole('heading', { name: heading, exact: true }).waitFor();
      await page.waitForFunction(
        label =>
          [...document.querySelectorAll('main .card')].some(
            card =>
              card.querySelector('p')?.textContent === label &&
              !card.hasAttribute('aria-busy') &&
              Number((card.querySelector('.num')?.textContent || '').replace(/[^0-9.-]/g, '')) > 0,
          ),
        metric,
      );
      await chartReady(page, heading.startsWith('渠道') ? '#s1' : '#h1');
    };
    const firstBegan = performance.now();
    await page.goto(base + human);
    await ready('访客趋势（UV / PV / 跳出率）', '浏览量 PV');
    const firstPrivate = {
      coreMs: performance.now() - firstBegan,
      navigation: await page.evaluate(() => {
        const entry = performance.getEntriesByType('navigation')[0];
        return { domContentLoadedMs: entry.domContentLoadedEventEnd, loadMs: entry.loadEventEnd };
      }),
      requests: received.slice(),
    };
    validateRanges(firstPrivate.requests, privateRange);
    const click = async (path, heading, metric, expectedReads = 0) => {
      await page.locator(`[data-navigation-primary] a[href^="${path}?"]`).waitFor();
      const responseStart = received.length;
      const requestStart = issued.length;
      await page.evaluate(
        ({ path, heading }) => {
          const link = [...document.querySelectorAll('a[href]')].find(
            a => new URL(a.href).pathname === path,
          );
          if (!link) throw new Error('Navigation link missing');
          const start = performance.now();
          window.__cacheProbe = { start };
          const observe = () => {
            if (
              document.querySelector('[data-navigation-pending]') ||
              [...document.querySelectorAll('h2')].some(node => node.textContent === heading)
            ) {
              window.__cacheProbe.structure ??= performance.now() - start;
            }
          };
          const observer = new MutationObserver(observe);
          observer.observe(document.body, { childList: true, subtree: true, attributes: true });
          window.__cacheProbe.stop = () => observer.disconnect();
          link.click();
          observe();
        },
        { path, heading },
      );
      await page.waitForURL(url => url.pathname === path);
      await ready(heading, metric);
      const result = await page.evaluate(() => {
        const result = {
          structure: window.__cacheProbe.structure,
          core: performance.now() - window.__cacheProbe.start,
        };
        window.__cacheProbe.stop();
        return result;
      });
      const requests = received.slice(responseStart);
      const initiated = issued.slice(requestStart);
      validateRanges(requests, privateRange);
      initiated.forEach(record => validateRange(record.parameters, privateRange));
      assert.equal(
        initiated.length,
        expectedReads,
        'fresh page reentry must reuse its authorized report; a first visit reads once',
      );
      initiated.forEach(record =>
        assert.equal(
          record.parameters.resource,
          path === sourcePath ? 'human/sources' : 'human/overview',
        ),
      );
      return { ...result, requests, initiated };
    };
    await click(sourcePath, '渠道趋势（AI 搜索引荐单列）', 'AI 搜索引荐', 1);
    await click(humanPath, '访客趋势（UV / PV / 跳出率）', '浏览量 PV');
    for (let index = 0; index < samples; index++) {
      const result =
        index % 2
          ? await click(humanPath, '访客趋势（UV / PV / 跳出率）', '浏览量 PV')
          : await click(sourcePath, '渠道趋势（AI 搜索引荐单列）', 'AI 搜索引荐');
      outcomes.push({ index, ...result });
    }
    await page.screenshot({ path: `${directory}/private-historical-cache.png`, fullPage: true });
    const [nativeResponse, nativeChartResponse] = await Promise.all([
      page.waitForResponse(
        response =>
          new URL(response.url()).pathname === `/api/websites/${site}/stats` &&
          response.status() === 200,
      ),
      page.waitForResponse(
        response =>
          new URL(response.url()).pathname === `/api/websites/${site}/pageviews` &&
          response.status() === 200,
      ),
      page.goto(
        `${base}/websites/${site}?legacy=1&date=range:${privateRange.startAt}:${privateRange.endAt}`,
      ),
    ]);
    const nativeParameters = Object.fromEntries(new URL(nativeResponse.url()).searchParams);
    validateRanges(
      [{ status: nativeResponse.status(), parameters: nativeParameters }],
      privateRange,
    );
    assert(Number((await nativeResponse.json()).pageviews) > 0);
    validateRanges(
      [
        {
          status: 200,
          parameters: Object.fromEntries(new URL(nativeChartResponse.url()).searchParams),
        },
      ],
      privateRange,
    );
    assert((await nativeChartResponse.json()).pageviews.some(point => Number(point.y) > 0));
    await chartReady(page, 'canvas');
    await page.screenshot({ path: `${directory}/legacy-statistics.png`, fullPage: true });
    const shared = await context.newPage();
    monitor(shared, 'public');
    shared.on('response', capture);
    const shareUrl = `${base}/share/${slug}`;
    const shareReady = async () => {
      await shared.waitForFunction(() =>
        [...document.querySelectorAll('.metric')].some(
          card =>
            card.getClientRects().length > 0 &&
            card.querySelector('.metric-label')?.textContent === '浏览量 PV' &&
            !card.hasAttribute('aria-busy') &&
            Number(
              (card.querySelector('.metric-value')?.textContent || '').replace(/[^0-9.-]/g, ''),
            ) > 0,
        ),
      );
      await chartReady(shared, '#h1');
    };
    const firstShareBegan = performance.now();
    const shareResponseStart = received.length;
    await shared.goto(shareUrl);
    await shareReady();
    const firstShare = {
      coreMs: performance.now() - firstShareBegan,
      requests: received
        .slice(shareResponseStart)
        .filter(entry => entry.path.endsWith('/shared-report')),
    };
    validateRanges(firstShare.requests, canonicalShareRange);
    const session = await context.newCDPSession(shared);
    await session.send('Network.enable');
    await session.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 100,
      downloadThroughput: 1250000,
      uploadThroughput: 1250000,
    });
    let transferred = 0;
    const urls = new Map();
    session.on('Network.responseReceived', event => urls.set(event.requestId, event.response.url));
    session.on('Network.loadingFinished', event => {
      if (urls.get(event.requestId)?.includes('/api/')) transferred += event.encodedDataLength;
    });
    for (let index = 0; index < samples; index++) {
      transferred = 0;
      const began = performance.now();
      const responseStart = received.length;
      await shared.goto(shareUrl);
      await shareReady();
      const requests = received
        .slice(responseStart)
        .filter(entry => entry.path.endsWith('/shared-report'));
      validateRanges(requests, canonicalShareRange);
      publicOutcomes.push({
        index,
        ms: performance.now() - began,
        coreTransferredBytes: transferred,
        requests,
      });
    }
    await shared.screenshot({ path: `${directory}/public-share-cache.png`, fullPage: true });
    const renewalBegan = performance.now();
    const renewal = await shared.waitForResponse(
      response =>
        new URL(response.url()).pathname === `/api/share/${slug}` && response.status() === 200,
      { timeout: 40000 },
    );
    assert((await renewal.json()).token);
    await shareReady();
    const renewalMs = performance.now() - renewalBegan;
    faultProbe = true;
    await session.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 100,
      downloadThroughput: 1250000,
      uploadThroughput: 1250000,
    });
    const offlineBegan = performance.now();
    await shared.waitForFunction(
      () =>
        [...document.querySelectorAll('.metric-value')].every(
          node => !node.getClientRects().length,
        ),
      undefined,
      { timeout: 40000 },
    );
    const offlineHideMs = performance.now() - offlineBegan;
    assert(
      offlineHideMs <= 31000,
      'expired public authorization must hide data within 30 seconds plus scheduling tolerance',
    );
    await session.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 100,
      downloadThroughput: 1250000,
      uploadThroughput: 1250000,
    });
    await shareReady();
    faultProbe = false;
    const [legacyShareResponse, legacyShareChartResponse] = await Promise.all([
      shared.waitForResponse(
        response =>
          new URL(response.url()).pathname.endsWith('/stats') && response.status() === 200,
      ),
      shared.waitForResponse(
        response =>
          new URL(response.url()).pathname.endsWith('/pageviews') && response.status() === 200,
      ),
      shared.goto(`${shareUrl}?legacy=1`),
    ]);
    assert(Number((await legacyShareResponse.json()).pageviews) > 0);
    assert((await legacyShareChartResponse.json()).pageviews.some(point => Number(point.y) > 0));
    await chartReady(shared, 'canvas');
    await shared.screenshot({ path: `${directory}/legacy-share-statistics.png`, fullPage: true });
    const accelerationViews = [];
    for (const layout of [
      {
        name: 'desktop-zh',
        locale: 'zh-CN',
        width: 1440,
        height: 1000,
        title: '统计加速',
        button: '开始构建',
      },
      {
        name: 'mobile-en',
        locale: 'en-US',
        width: 390,
        height: 844,
        title: 'Analytics acceleration',
        button: 'Start build',
      },
    ]) {
      const isolated = await browser.newContext({
        viewport: { width: layout.width, height: layout.height },
        locale: layout.locale,
        timezoneId: 'Asia/Shanghai',
        reducedMotion: 'reduce',
      });
      try {
        await isolated.addCookies([{ name: 'liekan.locale', value: layout.locale, url: base }]);
        await isolated.addInitScript(
          ({ token, locale }) => {
            localStorage.setItem('umami.auth', JSON.stringify(token));
            localStorage.setItem('umami.locale', JSON.stringify(locale));
            localStorage.setItem('umami.timezone', JSON.stringify('Asia/Shanghai'));
          },
          { token, locale: layout.locale },
        );
        const management = await isolated.newPage();
        monitor(management, layout.name);
        await management.goto(`${base}/settings/analytics-acceleration?websiteId=${site}`);
        await management.getByRole('heading', { name: layout.title, exact: true }).last().waitFor();
        await management.getByRole('button', { name: layout.button, exact: true }).waitFor();
        const bounds = await management.evaluate(() => ({
          width: innerWidth,
          body: document.documentElement.scrollWidth,
          loading: document.body.textContent.includes('正在读取加速状态'),
        }));
        assert(bounds.body <= bounds.width + 1, 'management page must fit the isolated viewport');
        await management.screenshot({
          path: `${directory}/analytics-acceleration-${layout.name}.png`,
          fullPage: true,
        });
        accelerationViews.push({ ...layout, ...bounds, controlsRendered: true });
      } finally {
        await isolated.close();
      }
    }
    const privateP95 = quantile(
      outcomes.map(o => o.core),
      0.95,
    );
    const structureP95 = quantile(
      outcomes.map(o => o.structure),
      0.95,
    );
    const shareP95 = quantile(
      publicOutcomes.map(o => o.ms),
      0.95,
    );
    return {
      isolatedContext: true,
      samples,
      network: { rttMs: 100, megabitsPerSecond: 10 },
      privateRange,
      shareRange: 'current canonical 30 days selected by the public page',
      firstPrivate,
      firstShare,
      authorization: {
        visibleRenewalStatus: renewal.status(),
        renewalMs,
        offlineHideMs,
        reconnected: true,
        legacyShareRendered: true,
        faultOutcomes,
      },
      lastKnownResponses: [...observed.values()],
      jobEvents,
      accelerationViews,
      errors,
      structureP95,
      privateP95,
      shareP95,
      outcomes,
      publicOutcomes,
      passed:
        errors.length === 0 &&
        structureP95 <= 100 &&
        privateP95 <= 200 &&
        // Both pages were read above; valid browser results require no repeated report request.
        outcomes.every(o => o.initiated.length === 0 && o.requests.length === 0) &&
        shareP95 <= 1000 &&
        publicOutcomes.every(o => o.coreTransferredBytes <= 512 * 1024),
    };
  } catch (error) {
    writeFileSync(
      `${directory}/browser-failure.json`,
      JSON.stringify(
        {
          privateOutcomes: outcomes,
          publicOutcomes,
          received,
          jobEvents,
          issued,
          errors,
          apiResponses,
          faultOutcomes,
          reason: error instanceof Error ? error.message : 'Error',
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    for (const [index, page] of context.pages().entries())
      await page
        .screenshot({ path: `${directory}/browser-failure-${index}.png`, fullPage: true })
        .catch(() => {});
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}
