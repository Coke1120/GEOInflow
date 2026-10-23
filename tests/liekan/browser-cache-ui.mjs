import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { isolatedAcceptanceTarget } from '../../scripts/liekan-acceptance-target.mjs';

/** Reopens a separate browser profile; the user's browser and viewport remain untouched. */
export async function verifyBrowserSnapshotUi({ base, token, websiteId, directory }) {
  isolatedAcceptanceTarget(base);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const profile = `${directory}/profile`;
  const open = () =>
    chromium.launchPersistentContext(profile, {
      headless: true,
      channel: 'chrome',
      viewport: { width: 1440, height: 1000 },
      locale: 'zh-CN',
      timezoneId: 'UTC',
      reducedMotion: 'reduce',
    });
  const end = Math.floor(Date.now() / 86400000) * 86400000 - 2 * 86400000;
  const start = end - 7 * 86400000;
  const path = `${base}/websites/${websiteId}/geo/human?date=range:${start}:${end}&timezone=UTC`;
  let context, page;
  const errors = [],
    reads = [],
    timings = [];
  const watch = page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname === `/api/liekan/websites/${websiteId}/page-report`) reads.push(url.href);
    });
  };
  const stored = page =>
    page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('liekan-private-aggregates-v1', 1);
        // A read probe must wait for the application's schema without creating an empty DB.
        request.onupgradeneeded = () => request.transaction.abort();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          request.error?.name === 'AbortError' ? resolve(null) : reject(request.error);
      });
      if (!db) return [];
      try {
        const values = await new Promise((resolve, reject) => {
          const request = db.transaction('snapshots').objectStore('snapshots').getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return values.flatMap(value => JSON.parse(value).clientState.queries);
      } finally {
        db.close();
      }
    });
  try {
    context = await open();
    await context.addCookies([{ name: 'liekan.locale', value: 'zh-CN', url: base }]);
    await context.addInitScript(
      token => localStorage.setItem('umami.auth', JSON.stringify(token)),
      token,
    );
    page = await context.newPage();
    watch(page);
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('正在读取统计数据', { exact: true })).toHaveCount(0, {
      timeout: 65000,
    });
    await expect
      .poll(async () => (await stored(page)).length, { timeout: 10000 })
      .toBeGreaterThan(0);
    const initial = await stored(page);
    assert(
      initial.some(
        query => query.queryKey.includes('human/overview') || query.queryKey.includes('human'),
      ),
      'a successful aggregate projection must exist in real IndexedDB',
    );
    await page.screenshot({ path: `${directory}/initial.png`, fullPage: true });
    const firstReads = reads.length;
    assert(firstReads > 0, 'first entry must exercise an actual aggregate read');
    await context.close();
    context = await open();
    page = await context.newPage();
    watch(page);
    await page.addInitScript(() => {
      const native = window.fetch;
      window.__cacheProbe = {};
      window.fetch = async (...args) => {
        const response = await native(...args);
        const url = new URL(String(args[0]), location.href);
        if (
          url.pathname.endsWith('/liekan/cache-manifest') &&
          url.searchParams.get('resources') !== '[]'
        )
          window.__cacheProbe.authorizedAt ||= performance.now();
        return response;
      };
      new MutationObserver(() => {
        const probe = window.__cacheProbe;
        if (
          probe.authorizedAt &&
          !probe.renderedAt &&
          [...document.querySelectorAll('[data-liekan-metric-label]')].some(
            node =>
              node.textContent.includes('访客数 UV') &&
              node.parentElement.getAttribute('aria-busy') !== 'true' &&
              node.nextElementSibling?.textContent.trim() === '0',
          ) &&
          ![...document.querySelectorAll('[role="status"]')].some(node =>
            node.textContent.includes('正在读取统计数据'),
          )
        )
          probe.renderedAt = performance.now();
      }).observe(document, { childList: true, subtree: true, attributes: true });
    });
    for (let round = 0; round < 10; round++) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('正在读取统计数据', { exact: true })).toHaveCount(0);
      assert.equal(
        reads.length,
        firstReads,
        'fresh reopened aggregate must come from the authorized browser cache',
      );
      const timing = await page.evaluate(() => window.__cacheProbe);
      if (timing.renderedAt >= timing.authorizedAt)
        timings.push(timing.renderedAt - timing.authorizedAt);
    }
    await page.screenshot({ path: `${directory}/restored.png`, fullPage: true });
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await expect.poll(() => reads.length).toBe(firstReads + 1);
    await page.waitForLoadState('networkidle');
    assert(
      new URL(reads.at(-1)).searchParams.get('refresh') === '1',
      'explicit refresh must reach the server',
    );
    // This page uses a historical range; advance the real expiry stored in IndexedDB to simulate reentry after expiry.
    await page.evaluate(async () => {
      const db = await new Promise(resolve => {
        const request = indexedDB.open('liekan-private-aggregates-v1', 1);
        request.onsuccess = () => resolve(request.result);
      });
      const transaction = db.transaction('snapshots', 'readwrite');
      const store = transaction.objectStore('snapshots');
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const value = JSON.parse(cursor.value);
        for (const query of value.clientState.queries)
          if (query.meta?.browserCache?.freshness)
            query.meta.browserCache.freshness.expiresAt =
              query.meta.browserCache.freshness.generatedAt + 1;
        cursor.update(JSON.stringify(value));
        cursor.continue();
      };
      await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = reject;
      });
      db.close();
    });
    await context.close();
    context = await open();
    page = await context.newPage();
    watch(page);
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expect.poll(() => reads.length).toBe(firstReads + 2);
    assert.equal(errors.length, 0, JSON.stringify(errors));
    const sorted = [...timings].sort((a, b) => a - b);
    assert.equal(sorted.length, 10, 'all authorized cache restores must record a visible result');
    assert(sorted[9] <= 100, `authorized cache restore P95 exceeds 100ms: ${sorted[9]}`);
    const result = {
      passed: true,
      realIndexedDB: true,
      browserRestart: true,
      freshReentries: 10,
      aggregateReadsOnFreshReentry: 0,
      explicitRefresh: true,
      expiredReentry: true,
      restoreRenderMs: sorted.length
        ? {
            samples: sorted.length,
            p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
            p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
            p99: sorted[Math.ceil(sorted.length * 0.99) - 1],
          }
        : null,
    };
    await writeFile(`${directory}/report.json`, JSON.stringify(result, null, 2), { mode: 0o600 });
    return result;
  } catch (error) {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: `${directory}/failure.png`, fullPage: true }).catch(() => {});
      await writeFile(
        `${directory}/failure.json`,
        JSON.stringify(
          {
            url: page.url(),
            errors,
            reads,
            text: (
              await page
                .locator('body')
                .innerText()
                .catch(() => '')
            ).slice(0, 10000),
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    }
    throw error;
  } finally {
    await context?.close();
  }
}
