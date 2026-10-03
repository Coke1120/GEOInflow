import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.env.LIEKAN_URL || 'http://127.0.0.1:3302';
const target = new URL(base);
assert(
  ['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === '3302',
  'Use the isolated candidate on port 3302',
);
const seed = JSON.parse(fs.readFileSync('tests/api/.runtime/127.0.0.1-3302/seed.json', 'utf8'));
const out = 'test-results/liekan-feature-flows';
fs.mkdirSync(out, { recursive: true });
let token;
const created = [];
const result = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  passed: false,
  checks: [],
  errors: [],
};
async function api(method, url, data) {
  const r = await fetch(base + '/api' + url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  assert.equal(r.status, 200, method + ' ' + url + ' HTTP ' + r.status);
  return r.json();
}
token = (await api('POST', '/auth/login', seed.admin)).token;
const browser = await chromium.launch({
  headless: true,
  ...(!process.env.CI ? { channel: 'chrome' } : {}),
});
async function pageAt(path, slow = false) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: 'zh-CN',
  });
  await context.addInitScript(t => localStorage.setItem('umami.auth', JSON.stringify(t)), token);
  const page = await context.newPage();
  page.on('pageerror', e => result.errors.push(e.message));
  page.on('response', r => {
    if (r.url().includes('/api/') && r.status() >= 500) result.errors.push('HTTP ' + r.status());
  });
  if (slow)
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (
        path === '/api/me/websites' ||
        path === '/api/me/teams' ||
        /^\/api\/teams\/[^/]+\/websites$/.test(path)
      )
        await new Promise(r => setTimeout(r, 1200));
      await route.continue();
    });
  await page.goto(base + path);
  await page.waitForLoadState('networkidle');
  await page.locator('[data-liekan-features]').first().waitFor();
  return { page, context };
}
try {
  await api('POST', '/dashboard', {
    name: '隔离 review 工作台',
    description: '',
    parameters: { liekan: { siteIds: [seed.website.id], showAI: true, showCompare: true } },
  });
  let { page, context } = await pageAt('/liekan/dashboard-edit?websiteId=' + seed.website.id, true);
  const input = page
    .locator('.switch-row')
    .filter({ hasText: seed.website.name })
    .locator('input[type=checkbox]');
  await input.waitFor();
  const before = await input.isChecked();
  await page.getByRole('button', { name: '保存工作台', exact: true }).click();
  await page.waitForURL(u => u.pathname === '/dashboard');
  const saved = await api('GET', '/dashboard');
  result.checks.push({
    name: 'delayed website load preserves dashboard selection and save',
    passed: before && saved.parameters.liekan.siteIds.includes(seed.website.id),
  });
  await context.close();
  ({ page, context } = await pageAt('/liekan/board-editor?websiteId=' + seed.website.id, true));
  const options = await page
    .locator('select[name=entity] option')
    .evaluateAll(es => es.map(e => e.value));
  result.checks.push({
    name: 'cold board editor includes loaded websites',
    passed: options.includes(seed.website.id),
  });
  await page.screenshot({ path: out + '/board-editor.png', fullPage: true });
  await context.close();
  const share = await api('POST', '/share', {
    name: '隔离 review 分享 ' + Date.now(),
    entityId: seed.website.id,
    shareType: 1,
    parameters: { overview: true, events: true, allowFilter: true },
  });
  created.push(['/share/id/' + share.id]);
  ({ page, context } = await pageAt('/liekan/sharing?websiteId=' + seed.website.id, true));
  result.checks.push({
    name: 'cold sharing list includes website shares',
    passed: (await page.getByText(share.name, { exact: true }).count()) === 1,
  });
  await page.screenshot({ path: out + '/sharing.png', fullPage: true });
  await context.close();
  ({ page, context } = await pageAt('/liekan/goal-editor?websiteId=' + seed.website.id));
  const goalName = '隔离 review 目标 ' + Date.now();
  await page.locator('[name=name]').fill(goalName);
  await page.locator('[name=goalType]').selectOption('event');
  await page.locator('[name=value]').fill(seed.data.eventNames[0]);
  await page.getByRole('button', { name: '保存目标', exact: true }).click();
  await page.waitForURL(u => u.pathname.endsWith('/goals'));
  const goals = await api('GET', '/websites/' + seed.website.id + '/goals?pageSize=100');
  const goal = (goals.data || goals).find(g => g.name === goalName);
  assert(goal);
  created.push(['/reports/' + goal.id]);
  result.checks.push({
    name: 'goal creation persists event condition and redirects',
    passed: goal.parameters.type === 'event' && goal.parameters.value === seed.data.eventNames[0],
  });
  await context.close();
  ({ page, context } = await pageAt('/liekan/board-editor?websiteId=' + seed.website.id));
  const readyOptions = await page
    .locator('[name=entity] option')
    .evaluateAll(es => es.map(e => e.value));
  result.checks.push({
    name: 'board resources load with natural network timing',
    passed: readyOptions.includes(seed.website.id),
  });
  await context.close();
  const teamSite = await api('POST', '/websites', {
    name: '隔离交互团队网站',
    domain: 'team-flow.test',
    teamId: seed.team.id,
  });
  created.push(['/websites/' + teamSite.id]);
  await api('POST', '/dashboard', {
    name: '隔离交互工作台',
    description: '',
    parameters: { liekan: { siteIds: [seed.website.id, teamSite.id] } },
  });
  ({ page, context } = await pageAt(
    `/liekan/dashboard-edit?websiteId=${teamSite.id}&teamId=${seed.team.id}`,
    true,
  ));
  const personalPin = page
    .locator('.switch-row')
    .filter({ hasText: seed.website.name })
    .locator('input[type=checkbox]');
  await personalPin.waitFor();
  const personalSelected = await personalPin.isChecked();
  await page.getByRole('button', { name: '保存工作台', exact: true }).click();
  await page.waitForURL(u => u.pathname === '/dashboard');
  const globalDashboard = await api('GET', '/dashboard');
  result.checks.push({
    name: 'team entry preserves personal and team pins in the global dashboard',
    passed:
      personalSelected &&
      JSON.stringify(globalDashboard.parameters.liekan.siteIds) ===
        JSON.stringify([seed.website.id, teamSite.id]),
  });
  await context.close();
  const switchSite = await api('POST', '/websites', {
    name: '隔离交互切换网站',
    domain: 'switch-flow.test',
  });
  created.push(['/websites/' + switchSite.id]);
  const segment = await api('POST', `/websites/${seed.website.id}/segments`, {
    type: 'segment',
    name: '隔离交互分群',
    parameters: { filters: [{ name: 'path', operator: 'eq', value: '/' }], match: 'all' },
  });
  created.push([`/websites/${seed.website.id}/segments/${segment.id}`]);
  const date = `range:${seed.range.startAt}:${Date.now()}:day`;
  ({ page, context } = await pageAt(
    `/websites/${seed.website.id}/sessions?` +
      new URLSearchParams({
        segment: segment.id,
        retentionDate: '2026-09-01',
        retentionDay: '1',
        date,
      }),
  ));
  await page.locator('.site-switch').click();
  const switchDialog = page.getByRole('dialog', { name: '切换网站' });
  await switchDialog.locator('[name=site]').selectOption(switchSite.id);
  await switchDialog.getByRole('button', { name: '切换网站', exact: true }).click();
  await page.waitForURL(u => u.pathname === `/websites/${switchSite.id}/sessions`);
  await page.waitForLoadState('networkidle');
  const switched = new URL(page.url());
  const switchAlerts = await page
    .locator('[data-liekan-features]')
    .getByRole('alert')
    .allTextContents();
  result.checks.push({
    name: 'website switch clears saved audience and association while preserving dates',
    observed: {
      date: switched.searchParams.get('date'),
      expectedDate: date,
      segment: switched.searchParams.has('segment'),
      retentionDate: switched.searchParams.has('retentionDate'),
      retentionDay: switched.searchParams.has('retentionDay'),
      alerts: switchAlerts,
    },
    passed:
      switched.searchParams.get('date') === date &&
      !switched.searchParams.has('segment') &&
      !switched.searchParams.has('retentionDate') &&
      !switched.searchParams.has('retentionDay') &&
      switchAlerts.length === 0,
  });
  await context.close();
  ({ page, context } = await pageAt(
    `/liekan/funnel-editor?${new URLSearchParams({ websiteId: seed.website.id, date })}`,
  ));
  await page.getByRole('button', { name: '下移步骤 1', exact: true }).click();
  const editorUrl = page.url();
  async function chooseNextSite() {
    await page.locator('.site-switch').click();
    const picker = page.getByRole('dialog', { name: '切换网站', exact: true });
    await picker.locator('[name=site]').selectOption(switchSite.id);
    await picker.getByRole('button', { name: '切换网站', exact: true }).click();
    await page.getByRole('dialog', { name: '当前修改尚未保存', exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 1);
  }
  await chooseNextSite();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  assert.equal(page.url(), editorUrl, 'Continue editing must keep the original website and form');
  assert.equal(await page.locator('form[data-unsaved="true"]').count(), 1);
  await chooseNextSite();
  await page.getByRole('button', { name: '放弃修改并切换', exact: true }).click();
  await page.waitForURL(u => u.pathname === `/websites/${switchSite.id}/funnels`);
  await page.waitForLoadState('networkidle');
  result.checks.push({
    name: 'unsaved step reorder confirms website switch with one dialog and restores scrolling',
    passed:
      new URL(page.url()).searchParams.get('date') === date &&
      (await page.getByRole('dialog').count()) === 0 &&
      (await page.evaluate(() => document.body.style.overflow)) === '',
  });
  await context.close();
  result.passed = result.checks.every(c => c.passed) && result.errors.length === 0;
} finally {
  try {
    for (const [url] of created)
      try {
        await api('DELETE', url);
      } catch {
        result.passed = false;
        result.errors.push('Fixture cleanup failed');
      }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(out + '/report.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
assert(result.passed, 'UI flow checks failed');
