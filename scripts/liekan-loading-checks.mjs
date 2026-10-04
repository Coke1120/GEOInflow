import assert from 'node:assert/strict';

const businessRead = request =>
  request.method() === 'GET' &&
  new URL(request.url()).pathname.includes('/api/') &&
  !/\/api\/(config|auth|heartbeat)(\/|$)/.test(new URL(request.url()).pathname);
const frame = page =>
  page.evaluate(() => {
    const box = el => {
      if (!el) return null;
      const { x, y, width, height } = el.getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      navigation: box(document.querySelector('#liekan-navigation')),
      heading: box(document.querySelector('h1')),
      headingText: document.querySelector('h1')?.textContent,
      charts: [...document.querySelectorAll('.chart,[id][role="img"]')].map((el, index) => ({
        id: el.id || `${el.getAttribute('aria-label')}:${index}`,
        ...box(el),
      })),
      busy:
        !!document.querySelector('[aria-busy="true"]') ||
        [...document.querySelectorAll('.state-box')].some(el =>
          el.textContent.includes('正在加载'),
        ),
      canvasCount: document.querySelectorAll('canvas').length,
    };
  });

// Delays are confined to the isolated browser. No production data or app settings change.
export async function beginLoadingEntry(page, id) {
  let reads = 0;
  const handler = async route => {
    if (businessRead(route.request())) {
      reads++;
      await new Promise(resolve => setTimeout(resolve, 900));
    }
    await route.fallback().catch(() => {});
  };
  await page.route('**/api/**', handler);
  let first, completed, completedAt;
  const started = performance.now();
  return {
    async capture() {
      await page.locator('h1').first().waitFor({ state: 'visible', timeout: 30000 });
      first = await frame(page);
    },
    async loaded() {
      completed = await frame(page);
      completedAt = performance.now();
    },
    async finish(ready) {
      const complete = completed || (await frame(page));
      const asynchronous = new Set([
        'realtime',
        'events',
        'event-detail',
        'sessions',
        'session-detail',
        'retention',
        'journeys',
        'path-detail',
        'utm',
        'breakdown',
        'compare',
        'annotations',
        'performance',
        'revenue',
        'heatmaps',
        'replays',
        'links',
        'pixels',
        'link-detail',
        'pixel-detail',
        'websites',
        'teams',
        'admin-users',
        'admin-websites',
        'boards',
        'goals',
        'funnels',
      ]);
      if (asynchronous.has(id) || id?.startsWith('geo:')) {
        assert(reads > 0, `${id}: no actual read exercised`);
        assert(first?.busy, `${id}: pending state was never observed`);
      }
      assert(first?.heading && complete.heading, 'Loaded heading frame missing');
      let maxStableGeometryDelta = 0;
      if (first?.navigation && complete.navigation) {
        for (const axis of ['x', 'width', 'height'])
          maxStableGeometryDelta = Math.max(
            maxStableGeometryDelta,
            Math.abs(first.navigation[axis] - complete.navigation[axis]),
          );
      }
      if (first?.heading && first.headingText === complete.headingText) {
        for (const axis of ['x', 'width', 'height'])
          maxStableGeometryDelta = Math.max(
            maxStableGeometryDelta,
            Math.abs(first.heading[axis] - complete.heading[axis]),
          );
      }
      for (const chart of first?.charts || []) {
        const loaded = complete.charts.find(candidate => candidate.id === chart.id);
        assert(loaded, `Pending chart ${chart.id} disappeared`);
        if (loaded)
          maxStableGeometryDelta = Math.max(
            maxStableGeometryDelta,
            Math.abs(chart.height - loaded.height),
          );
      }
      const dynamicLayout = ['dashboard', 'board-view', 'share-preview'].includes(id);
      if (!dynamicLayout)
        for (const chart of complete.charts)
          assert(
            first?.charts.some(candidate => candidate.id === chart.id),
            `Chart ${chart.id} has no pending frame`,
          );
      assert(maxStableGeometryDelta <= 1, `Loading frame shifted ${maxStableGeometryDelta}px`);
      const cold = {
        milliseconds: (completedAt || performance.now()) - started,
        reads,
        pendingObserved: first?.busy || false,
        maxStableGeometryDelta,
      };
      await page.unroute('**/api/**', handler);
      const warmStarted = performance.now();
      await page.reload();
      await ready(page);
      return { cold, warm: { milliseconds: performance.now() - warmStarted }, passed: true };
    },
    async cleanup() {
      await page.unroute('**/api/**', handler);
    },
  };
}

export async function checkRealtimeRefresh(page, ready) {
  const results = [];
  for (let sample = 0; sample < 10; sample++) {
    const before = await frame(page);
    const navigation = await page.locator('#liekan-navigation').elementHandle();
    const canvas = await page.locator('.chart canvas').first().elementHandle();
    assert(canvas, 'Realtime fixture must render a chart');
    let reads = 0;
    const delay = sample % 2 ? 3000 : 900;
    const handler = async route => {
      if (businessRead(route.request())) {
        reads++;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      await route.fallback().catch(() => {});
    };
    await page.route('**/api/**', handler);
    const started = performance.now();
    try {
      await page.getByRole('button', { name: '刷新', exact: true }).click();
      await page.waitForFunction(() => !!document.querySelector('[aria-busy="true"]'));
      const during = await frame(page);
      assert.equal(during.canvasCount, before.canvasCount, 'Refresh removed a rendered chart');
      assert(await canvas.evaluate(el => el.isConnected), 'Refresh replaced the chart canvas');
      assert(
        await navigation.evaluate(el => el === document.querySelector('#liekan-navigation')),
        'Refresh replaced navigation',
      );
      await ready(page);
      const after = await frame(page);
      for (const chart of before.charts) {
        const pending = during.charts.find(candidate => candidate.id === chart.id);
        const loaded = after.charts.find(candidate => candidate.id === chart.id);
        assert(pending && loaded, 'Chart frame missing');
        for (const axis of ['x', 'y', 'width', 'height']) {
          assert(Math.abs(chart[axis] - pending[axis]) <= 1, `Refresh changed ${axis}`);
          assert(Math.abs(chart[axis] - loaded[axis]) <= 1, `Refresh result changed ${axis}`);
        }
      }
      assert(reads >= 3 && reads <= 6, `Unexpected realtime read count: ${reads}`);
      results.push({
        sample,
        delay,
        reads,
        milliseconds: performance.now() - started,
        canvasRetained: true,
        navigationRetained: true,
        passed: true,
      });
    } finally {
      await page.unroute('**/api/**', handler);
    }
  }
  return results;
}

export async function checkNavigationPersistence(page, ready, websiteId) {
  await page.goto(`${new URL(page.url()).origin}/websites/${websiteId}/geo`);
  await ready(page);
  const navigation = await page.locator('#liekan-navigation').elementHandle();
  const results = [];
  for (const label of ['实时', 'GEO', '实时', 'GEO', '实时', 'GEO', '实时', 'GEO', '实时', 'GEO']) {
    const links = page.locator('#liekan-navigation a');
    const hrefs = await links.evaluateAll(elements => elements.map(el => el.getAttribute('href')));
    const href = hrefs.find(
      href =>
        href &&
        (label === '实时'
          ? /(?:\/realtime|\/liekan\/realtime)(?:\?|$)/.test(href)
          : /\/geo(?:\?|$)/.test(href)),
    );
    assert(href, `Missing ${label} navigation fixture`);
    const started = performance.now();
    await page
      .locator(`#liekan-navigation a[href=${JSON.stringify(href)}]`)
      .first()
      .click();
    await ready(page);
    assert(
      await navigation.evaluate(el => el === document.querySelector('#liekan-navigation')),
      'Cross-page navigation replaced the sidebar',
    );
    results.push({
      label,
      milliseconds: performance.now() - started,
      navigationRetained: true,
      passed: true,
    });
  }
  return results;
}
