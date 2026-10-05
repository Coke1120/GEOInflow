import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { isolatedAcceptanceTarget, acceptanceSeedFile } from './liekan-acceptance-target.mjs';

const base = process.env.LIEKAN_URL || 'http://127.0.0.1:3305';
const target = isolatedAcceptanceTarget(base, { aiPreview: true });
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const seed = JSON.parse(fs.readFileSync(acceptanceSeedFile(target), 'utf8'));
const login = await fetch(base + '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(seed.admin),
});
assert.equal(login.status, 200);
const { token } = await login.json();
const catalogResponse = await fetch(base + '/api/liekan/ai/catalog', {
  headers: { authorization: 'Bearer ' + token },
});
assert.equal(catalogResponse.status, 200);
const catalog = await catalogResponse.json(),
  site = catalog.websites.find(value => value.id === seed.website.id);
assert(site, 'Use an explicitly isolated acceptance website');
const fixture = {
  siteId: site.id,
  connectionId: randomUUID(),
  conversationId: randomUUID(),
  contextId: randomUUID(),
};
const checks = [],
  errors = [],
  out = 'test-results/liekan-ai-conversation';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(!process.env.CI ? { channel: 'chrome' } : {}),
});
try {
  const context = await browser.newContext({
    locale: 'zh-CN',
    reducedMotion: 'reduce',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  // Synthetic supplier responses stay inside this isolated browser. No model or test database writes.
  await context.addInitScript(
    ({ token, fixture }) => {
      localStorage.setItem('umami.auth', JSON.stringify(token));
      const nativeFetch = window.fetch.bind(window),
        runs = new Map(),
        conversations = new Set();
      const json = value => Promise.resolve(Response.json(value));
      const row = {
        id: fixture.connectionId,
        name: 'DeepSeek（交互验收模拟）',
        provider: 'deepseek',
        protocol: 'openai-chat',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-flash',
        enabled: true,
        isDefault: true,
        hasKey: true,
        rowVersion: 1,
        configVersion: 1,
        testState: 'connected',
        testedAt: null,
        capabilities: { keyVerified: { text: true, stream: true }, documented: { stream: true } },
      };
      window.fetch = async (input, init) => {
        const url = new URL(
            typeof input === 'string' ? input : input instanceof Request ? input.url : input.href,
            location.origin,
          ),
          method = init?.method || 'GET';
        if (url.pathname === '/api/liekan/ai/connections' && method === 'GET')
          return json({ items: [row], nextCursor: null });
        if (url.pathname === '/api/liekan/ai/conversations') {
          if (method === 'POST') {
            const id = crypto.randomUUID();
            conversations.add(id);
            return json({ id, websiteId: fixture.siteId });
          }
          return json({ items: [], nextCursor: null });
        }
        const conversationMatch = url.pathname.match(
          /^\/api\/liekan\/ai\/conversations\/([a-f0-9-]+)(?:\/(messages))?$/,
        );
        if (conversationMatch && conversations.has(conversationMatch[1]) && !conversationMatch[2])
          return json({ id: conversationMatch[1], websiteId: fixture.siteId });
        if (conversationMatch && conversations.has(conversationMatch[1]) && conversationMatch[2]) {
          if (method !== 'POST') return json({ items: [], nextCursor: null });
          const body = JSON.parse(init.body),
            runId = crypto.randomUUID();
          const run = {
            protocolVersion: 1,
            id: runId,
            clientRequestId: body.clientRequestId,
            operation: 'analysis',
            state: 'calling',
            connectionId: fixture.connectionId,
            configVersion: 1,
            startedAt: new Date().toISOString(),
            completedAt: null,
            error: null,
            callAttempted: true,
            ttftMs: 850,
            latencyMs: null,
            usage: null,
          };
          runs.set(runId, run);
          const encoder = new TextEncoder();
          let sequence = 0,
            timer,
            closed = false;
          const response = new ReadableStream({
            start(controller) {
              const emit = (type, data) => {
                if (!closed)
                  controller.enqueue(
                    encoder.encode(
                      `event: ${type}\ndata: ${JSON.stringify({ protocolVersion: 1, runId, sequence: ++sequence, type, data })}\n\n`,
                    ),
                  );
              };
              emit('started', { state: 'accepted' });
              emit('stage', { stage: 'preparing' });
              emit('stage', { stage: 'calling' });
              emit('delta', {
                text: '{"summary":"这是交互验收模拟回答，统计来源和分析状态会保持清晰。","observations":[',
              });
              const finish = () => {
                if (closed) return;
                if (body.question.includes('模拟失败')) {
                  Object.assign(run, {
                    state: 'failed',
                    error: { code: 'oversize', message: 'AI 请求或响应超过允许大小。' },
                    latencyMs: 3100,
                  });
                  emit('error', { ...run.error, state: 'failed' });
                } else {
                  Object.assign(run, {
                    state: 'completed',
                    completedAt: new Date().toISOString(),
                    latencyMs: 3100,
                    usage: { inputTokens: 300, outputTokens: 120, totalTokens: 420 },
                    result: {
                      origin: 'provider',
                      summary: '这是交互验收模拟回答，统计来源和分析状态会保持清晰。',
                      observations: [
                        {
                          text: '这段文字仅用于检验回答排版，正式回答来自当前网站的授权统计。',
                          refs: [{ contextId: fixture.contextId, factId: 'summary' }],
                        },
                      ],
                      possibleCauses: [],
                      suggestions: [{ text: '继续补充你希望分析的页面或日期范围。', refs: [] }],
                      limitations: ['交互验收模拟，不代表实际网站分析。'],
                      actions: [],
                      contextId: fixture.contextId,
                    },
                  });
                  emit('stage', { stage: 'validating' });
                  emit('done', run);
                }
                closed = true;
                controller.close();
              };
              timer = setTimeout(finish, 3100);
              init.signal?.addEventListener(
                'abort',
                () => {
                  clearTimeout(timer);
                  if (!closed) {
                    closed = true;
                    controller.close();
                  }
                },
                { once: true },
              );
            },
            cancel() {
              closed = true;
              clearTimeout(timer);
            },
          });
          return new Response(response, { headers: { 'Content-Type': 'text/event-stream' } });
        }
        const match = url.pathname.match(/^\/api\/liekan\/ai\/runs\/([a-f0-9-]+)(?:\/(cancel))?$/);
        if (match && runs.has(match[1])) {
          const run = runs.get(match[1]);
          if (match[2])
            Object.assign(run, {
              state: 'cancelled',
              completedAt: new Date().toISOString(),
              error: null,
              latencyMs: 900,
            });
          return json(run);
        }
        return nativeFetch(input, init);
      };
    },
    { token, fixture },
  );
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [1440, 1280, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + '/liekan/ai-chat?aiSite=' + site.id);
    const input = page.getByLabel('分析问题');
    await expect(page.getByLabel('分析模型')).toHaveValue(fixture.connectionId);
    const homeHeight = await input.evaluate(element => element.getBoundingClientRect().height);
    await input.fill('分析最近 7 天的趋势，交互验收模拟');
    await page.getByRole('button', { name: '发起分析', exact: true }).click();
    await expect(page.getByText('正在分析网站数据', { exact: true })).toBeVisible();
    await expect(page.getByText('生成中，内容待核验')).toBeVisible();
    assert.equal(await input.getAttribute('rows'), '1');
    await input.fill('继续分析页面，保留的草稿');
    await page.screenshot({ path: `${out}/loading-${width}.png`, fullPage: true });
    await expect(page.getByText('AI 分析 · 已校验', { exact: true })).toBeVisible();
    await expect(input).toHaveValue('继续分析页面，保留的草稿');
    await page.getByRole('button', { name: '复制回答', exact: true }).click();
    await expect(page.getByRole('button', { name: '已复制', exact: true })).toBeVisible();
    await page.getByText('运行详情 · 3.1 秒', { exact: true }).click();
    await expect(page.getByText('420', { exact: true })).toBeVisible();
    const dateSummary = page
      .locator('[data-ai-composer-dock] details')
      .filter({ has: page.getByLabel('分析开始日期') })
      .locator('summary');
    await dateSummary.click();
    const dateBox = await page.getByLabel('分析开始日期').evaluate(element => {
      const box = element.getBoundingClientRect();
      return {
        top: box.top,
        bottom: box.bottom,
        right: box.right,
        height: innerHeight,
        width: innerWidth,
      };
    });
    assert(
      dateBox.top >= 0 && dateBox.bottom <= dateBox.height && dateBox.right <= dateBox.width,
      'Bottom composer opens dates inside visible viewport',
    );
    await page.screenshot({ path: `${out}/answer-${width}.png`, fullPage: true });
    await dateSummary.click();
    const dock = await page.locator('[data-ai-composer-dock]').evaluate(element => {
      const box = element.getBoundingClientRect();
      return { height: box.height, bottom: box.bottom, viewport: innerHeight };
    });
    assert(dock.height < (width >= 650 ? 190 : 280), 'Continuation composer stays compact');
    assert(dock.bottom <= dock.viewport + 1, 'Continuation input is visible');
    await page.getByRole('button', { name: '新建对话', exact: true }).click();
    await page.waitForURL(url => !url.searchParams.has('aiConversation'));
    await expect(page.locator('[data-ai-welcome]')).toBeVisible();
    await expect(input).toBeEnabled();
    const returnedHomeHeight = await input.evaluate(
      element => element.getBoundingClientRect().height,
    );
    assert(
      Math.abs(returnedHomeHeight - homeHeight) <= 1,
      'New conversation restores homepage textarea height',
    );
    await input.fill('模拟失败');
    await page.getByRole('button', { name: '发起分析', exact: true }).click();
    await expect(page.getByText('本次分析未完成', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '重新填写问题', exact: true })).toBeVisible();
    assert.equal(await page.getByRole('button', { name: '回查原任务', exact: true }).count(), 0);
    await page.screenshot({ path: `${out}/failure-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: '重新填写问题', exact: true }).click();
    await expect(input).toHaveValue('模拟失败');
    await input.fill('检查停止交互，交互验收模拟');
    await page.getByRole('button', { name: '发起分析', exact: true }).click();
    await expect(page.getByText('正在分析网站数据', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '停止分析', exact: true }).click();
    await expect(page.getByText('分析已停止', { exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.equal(overflow, 0, 'Conversation has no horizontal overflow');
    checks.push({
      width,
      homeHeight,
      returnedHomeHeight,
      dockHeight: dock.height,
      dateBox,
      overflow,
      states: ['loading', 'answer', 'copy', 'date', 'failure', 'stop', 'new-conversation'],
    });
  }
} finally {
  await browser.close();
}
const report = {
  head,
  passed: errors.length === 0,
  isolated: true,
  supplierCalls: 0,
  checks,
  errors,
};
fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
assert.deepEqual(errors, []);
console.log(`AI conversation verified at ${checks.length} widths; 0 supplier calls.`);
