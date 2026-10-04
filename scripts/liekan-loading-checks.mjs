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
      heading: box(document.querySelector('h1, .public-head')),
      headingText: document.querySelector('h1, .public-head')?.textContent,
      charts: [...document.querySelectorAll('.chart,[id][role="img"]')].map((el, index) => ({
        id: el.id || `feature-chart:${index}`,
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

export async function assertReadRegionLayout(page) {
  const layout = await page.evaluate(() => {
    const regions = [...document.querySelectorAll('[data-liekan-read-region]')];
    const stacks = regions.flatMap((region, index) => {
      const parent = getComputedStyle(region.parentElement);
      const children = [...region.children].filter(child => {
        const style = getComputedStyle(child);
        const box = child.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && !['absolute', 'fixed'].includes(style.position);
      });
      if (parent.display !== 'grid' || children.length < 2) return [];
      const style = getComputedStyle(region);
      return [{ index, display: style.display, rowGap: style.rowGap, parentRowGap: parent.rowGap }];
    });
    return { regions: regions.length, stacks };
  });
  for (const stack of layout.stacks) {
    assert.equal(stack.display, 'grid', `Read region ${stack.index} changed its inherited layout`);
    assert.equal(
      stack.rowGap,
      stack.parentRowGap,
      `Read region ${stack.index} lost its original spacing`,
    );
  }
  return layout;
}

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
  let first,
    completed,
    completedAt,
    pendingCharts = [],
    loadedLayout;
  const started = performance.now();
  return {
    async capture() {
      await page.locator('h1, .public-head').first().waitFor({ state: 'visible', timeout: 30000 });
      first = await frame(page);
      await page.evaluate(() => {
        const observation = { active: true, charts: {} };
        window.__liekanLoadingObservation = observation;
        const sample = () => {
          if (!observation.active) return;
          [...document.querySelectorAll('.chart,[id][role="img"]')].forEach((el, index) => {
            if (!el.closest('[aria-busy="true"]') || el.querySelector('canvas,svg')) return;
            const { x, y, width, height } = el.getBoundingClientRect();
            const id = el.id || `feature-chart:${index}`;
            const previous = observation.charts[id];
            observation.charts[id] = {
              id,
              x,
              y,
              width,
              height,
              minHeight: Math.min(previous?.minHeight ?? height, height),
              maxHeight: Math.max(previous?.maxHeight ?? height, height),
            };
          });
          requestAnimationFrame(sample);
        };
        sample();
      });
    },
    async loaded() {
      pendingCharts = await page.evaluate(() => {
        const observation = window.__liekanLoadingObservation;
        if (observation) observation.active = false;
        return Object.values(observation?.charts || {});
      });
      loadedLayout = await assertReadRegionLayout(page);
      completed = await frame(page);
      assert(!completed.busy, `${id}: data is still pending`);
      completedAt = performance.now();
    },
    async finish(ready) {
      const complete = completed || (await frame(page));
      assert(!complete.busy, `${id}: data is still pending`);
      const asynchronous = new Set([
        'api-keys',
        'admin-teams',
        'segments',
        'cohorts',
        'dashboard',
        'board-view',
        'board-design',
        'share-preview',
        'attribution',
        'team-detail',
        'sharing',
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
      for (const chart of pendingCharts) {
        const loaded = complete.charts.find(candidate => candidate.id === chart.id);
        assert(loaded, `Pending chart ${chart.id} disappeared`);
        if (loaded)
          maxStableGeometryDelta = Math.max(
            maxStableGeometryDelta,
            Math.abs(chart.minHeight - loaded.height),
            Math.abs(chart.maxHeight - loaded.height),
          );
      }
      const dynamicLayout = ['dashboard', 'board-view', 'share-preview'].includes(id);
      if (!dynamicLayout)
        for (const chart of complete.charts)
          assert(
            pendingCharts.some(candidate => candidate.id === chart.id),
            `Chart ${chart.id} has no pending frame`,
          );
      assert(maxStableGeometryDelta <= 1, `Loading frame shifted ${maxStableGeometryDelta}px`);
      const cold = {
        milliseconds: (completedAt || performance.now()) - started,
        reads,
        pendingObserved: first?.busy || false,
        pendingChartFrames: pendingCharts.length,
        maxStableGeometryDelta,
        loadedLayout,
      };
      await page.unroute('**/api/**', handler);
      const warmStarted = performance.now();
      await page.reload();
      await ready(page);
      return {
        cold,
        warm: {
          milliseconds: performance.now() - warmStarted,
          layout: await assertReadRegionLayout(page),
        },
        passed: true,
      };
    },
    async cleanup() {
      await page
        .evaluate(() => {
          if (window.__liekanLoadingObservation) window.__liekanLoadingObservation.active = false;
        })
        .catch(() => {});
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
  const steps = [
    ['实时', /\/realtime(?:\?|$)/],
    ['GEO', /\/geo(?:\?|$)/],
    ['AI 抓取总览', /\/geo\/ai(?:\/overview)?(?:\?|$)/],
    ['网站列表', /^\/(?:liekan\/)?websites(?:\?|$)/],
    ['数据总览', /^\/(?:liekan\/)?dashboard(?:\?|$)/],
    ['账户资料', /^\/(?:liekan\/account|settings\/profile)(?:\?|$)/],
    ['系统管理', /^\/(?:liekan\/admin-users|admin\/users)(?:\?|$)/],
    ['网站列表', /^\/(?:liekan\/)?websites(?:\?|$)/],
    ['数据看板', /^\/(?:liekan\/)?boards(?:\?|$)/],
    ['团队管理', /^\/(?:liekan\/)?teams(?:\?|$)/],
  ];
  for (const [label, pattern] of steps) {
    if (label === '账户资料')
      await page.getByRole('button', { name: '个人账户', exact: true }).click();
    const hrefs = await page
      .locator('#liekan-navigation a')
      .evaluateAll(elements => elements.map(el => el.getAttribute('href')));
    const href = hrefs.find(href => href && pattern.test(href));
    assert(href, `Missing ${label} navigation fixture`);
    const expected = new URL(href, page.url());
    assert.notEqual(expected.href, page.url(), `${label}: navigation must change route`);
    const started = performance.now();
    await page
      .locator(`#liekan-navigation a[href=${JSON.stringify(href)}]`)
      .first()
      .click();
    await page.waitForURL(expected.href, { timeout: 30000 });
    await ready(page);
    const completed = await frame(page);
    assert(completed.headingText && !completed.busy, `${label}: target content is not ready`);
    assert(
      await navigation.evaluate(el => el === document.querySelector('#liekan-navigation')),
      'Cross-page navigation replaced the sidebar',
    );
    results.push({
      label,
      destination: expected.pathname,
      heading: completed.headingText,
      milliseconds: performance.now() - started,
      navigationRetained: true,
      passed: true,
    });
  }
  return results;
}
