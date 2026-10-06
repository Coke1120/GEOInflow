import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from '@playwright/test';
import { isolatedAcceptanceTarget, acceptanceSeedFile } from './liekan-acceptance-target.mjs';

const base = process.env.LIEKAN_URL || 'http://127.0.0.1:3302';
const target = isolatedAcceptanceTarget(base);
const seed = JSON.parse(fs.readFileSync(acceptanceSeedFile(target), 'utf8'));
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
  page.setDefaultNavigationTimeout(30000);
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
async function waitForLoggedOut(page) {
  await page.waitForFunction(
    () =>
      location.pathname === '/login' &&
      document.querySelector('input[name="username"]')?.getBoundingClientRect().width > 0 &&
      localStorage.getItem('umami.auth') === null,
  );
}
try {
  let loginContext = await browser.newContext({ locale: 'zh-CN' });
  let loginPage = await loginContext.newPage();
  try {
    await loginPage.goto(base + '/login');
    await loginPage.locator('[name=username]').fill(seed.admin.username);
    await loginPage.locator('[name=password]').fill(seed.admin.password);
    await loginPage.getByRole('button', { name: '登录', exact: true }).click();
    await loginPage.waitForURL(u => u.pathname === '/dashboard');
    await loginPage.waitForLoadState('networkidle');
    const saved = await loginContext.storageState();
    assert(
      saved.origins.some(origin => origin.localStorage.some(item => item.name === 'umami.auth')),
    );
    await loginContext.close();
    loginContext = await browser.newContext({ locale: 'zh-CN', storageState: saved });
    loginPage = await loginContext.newPage();
    await loginPage.goto(base + '/login');
    await loginPage.waitForURL(u => u.pathname === '/dashboard');
    await loginPage.waitForLoadState('networkidle');
    await loginPage.getByRole('button', { name: /个人账户/ }).click();
    await loginPage.getByRole('button', { name: '退出登录', exact: true }).click();
    await loginPage.waitForURL(u => u.pathname === '/login');
    await waitForLoggedOut(loginPage);
    await loginPage.reload();
    await loginPage.getByRole('button', { name: '登录', exact: true }).waitFor();
    assert.equal(new URL(loginPage.url()).pathname, '/login');
    await loginPage.evaluate(() =>
      localStorage.setItem('umami.auth', JSON.stringify('expired-invalid')),
    );
    await loginPage.reload();
    await loginPage.getByRole('button', { name: '登录', exact: true }).waitFor();
    await waitForLoggedOut(loginPage);
    result.checks.push({
      name: 'saved login restores in a new browser context while logout and expired credentials keep the login form available',
      passed: true,
    });
  } finally {
    await loginContext.close();
  }
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
  const shareRow = page.getByRole('row').filter({ hasText: share.name });
  result.checks.push({
    name: 'cold sharing list includes website shares',
    passed:
      (await shareRow.count()) === 1 &&
      (await shareRow.isVisible()) &&
      (await shareRow.getByText(seed.website.name).count()) === 1,
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
    name: '隔离交互切换网站 ' + Date.now(),
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
  await page.getByRole('button', { name: /切换网站，当前/ }).click();
  const switchDialog = page.getByRole('dialog', { name: '切换网站' });
  await switchDialog
    .getByRole('button', { name: `选择网站 ${switchSite.name}`, exact: true })
    .click();
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
  ({ page, context } = await pageAt('/websites?date=range:bad:bad'));
  assert(await page.getByText('日期参数无效，当前使用默认日期范围。').isVisible());
  await page.getByRole('button', { name: '重置日期', exact: true }).click();
  await page.waitForURL(u => u.searchParams.get('date') === '30day');
  await page.waitForLoadState('networkidle');
  await context.close();
  ({ page, context } = await pageAt(
    `/liekan/funnel-editor?${new URLSearchParams({ websiteId: seed.website.id, date })}`,
  ));
  await page.getByRole('button', { name: '下移步骤 1', exact: true }).click();
  const editorUrl = page.url();
  async function chooseNextSite() {
    await page.getByRole('button', { name: /切换网站，当前/ }).click();
    const picker = page.getByRole('dialog', { name: '切换网站', exact: true });
    await picker.getByRole('button', { name: `选择网站 ${switchSite.name}`, exact: true }).click();
    await page.getByRole('dialog', { name: '放弃未保存的修改？', exact: true }).waitFor();
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
    name: 'date recovery and unsaved website switch preserve usable navigation and scrolling',
    passed:
      new URL(page.url()).searchParams.get('date') === date &&
      (await page.getByRole('dialog').count()) === 0 &&
      (await page.evaluate(() => document.body.style.overflow)) === '',
  });
  await context.close();
  for (const kind of ['link', 'pixel']) {
    ({ page, context } = await pageAt(`/liekan/${kind}-editor`));
    await page.locator('[name=owner]').selectOption(seed.team.id);
    await page.locator('[name=name]').fill(`隔离归属检查${kind} ${Date.now()}`);
    if (kind === 'link') await page.locator('[name=url]').fill('https://example.com/review');
    await page
      .getByRole('button', { name: kind === 'link' ? '保存链接' : '保存图片', exact: true })
      .click();
    await page.waitForURL(u => new RegExp(`^/${kind}s/[^/]+$`).test(u.pathname));
    const id = new URL(page.url()).pathname.split('/').pop();
    created.push([`/${kind}s/${id}`]);
    const savedResource = await api('GET', `/${kind}s/${id}`);
    result.checks.push({
      name: `${kind} creation honors the selected team destination`,
      passed: savedResource.teamId === seed.team.id,
    });
    await context.close();
  }
  const adminToken = token;
  let externalTeam;
  try {
    token = (await api('POST', '/auth/login', seed.user)).token;
    externalTeam = (await api('POST', '/teams', { name: `隔离非成员团队 ${Date.now()}` }))[0];
    created.push([`/teams/${externalTeam.id}`]);
  } finally {
    token = adminToken;
  }
  const memberships = await api('GET', '/me/teams?pageSize=100');
  assert(!(memberships.data || memberships).some(team => team.id === externalTeam.id));
  const externalSite = await api('POST', '/websites', {
    name: '隔离非成员团队网站',
    domain: 'external-team.test',
    teamId: externalTeam.id,
  });
  created.push([`/websites/${externalSite.id}`]);
  ({ page, context } = await pageAt(`/liekan/board-editor?teamId=${externalTeam.id}`, true));
  assert.equal(await page.locator('[name=owner]').inputValue(), externalTeam.id);
  await page.locator('[name=name]').fill(`隔离跨团队看板 ${Date.now()}`);
  await page.locator('[name=entity]').selectOption(externalSite.id);
  await page.getByRole('button', { name: '保存并编排', exact: true }).click();
  await page.waitForURL(u => /^\/boards\/[^/]+\/design$/.test(u.pathname));
  const externalBoardId = new URL(page.url()).pathname.split('/')[2];
  created.push([`/boards/${externalBoardId}`]);
  const externalBoard = await api('GET', `/boards/${externalBoardId}`);
  result.checks.push({
    name: 'administrator creates a website board in a non-member team',
    passed:
      externalBoard.teamId === externalTeam.id &&
      externalBoard.parameters.websiteId === externalSite.id,
  });
  await context.close();
  ({ page, context } = await pageAt(
    `/liekan/sharing?id=${externalBoardId}&teamId=${externalTeam.id}`,
  ));
  result.checks.push({
    name: 'cold board sharing retains a non-member team scope and its actual name',
    passed:
      (await page.getByRole('combobox', { name: '所属空间' }).inputValue()) === externalTeam.id &&
      (await page.getByRole('option', { name: externalTeam.name, exact: true }).count()) === 1,
  });
  await context.close();
  ({ page, context } = await pageAt(
    `/websites/${seed.website.id}/sessions/${seed.data.sessionId}`,
  ));
  await page
    .locator('.analysis-tools')
    .getByRole('link', { name: '高级筛选', exact: true })
    .click();
  await page.waitForURL(u => u.pathname === '/liekan/filters');
  await page
    .locator('.analysis-tools')
    .getByRole('link', { name: '图表注释', exact: true })
    .click();
  await page.waitForURL(u => u.pathname === '/liekan/annotations');
  const toolsUrl = new URL(page.url());
  const toolsParent = page.getByRole('tab', { name: '访问记录', exact: true });
  result.checks.push({
    name: 'detail-to-tool-to-tool keeps a reachable source list',
    passed:
      toolsUrl.searchParams.get('from') === 'sessions' &&
      (await toolsParent.getAttribute('href')).includes(`/websites/${seed.website.id}/sessions`),
  });
  await context.close();
  const readOnlyTeam = (await api('POST', '/teams', { name: `隔离只读团队 ${Date.now()}` }))[0];
  created.push([`/teams/${readOnlyTeam.id}`]);
  await api('POST', `/teams/${readOnlyTeam.id}/users`, {
    userId: seed.user.id,
    role: 'team-view-only',
  });
  try {
    token = (await api('POST', '/auth/login', seed.user)).token;
    ({ page, context } = await pageAt(`/liekan/board-editor?teamId=${readOnlyTeam.id}`, true));
    const owner = page.locator('[name=owner]');
    assert(await owner.isEnabled());
    assert.equal(await owner.locator(`option[value="${readOnlyTeam.id}"]`).count(), 0);
    await owner.selectOption('');
    await page.locator('[name=name]').fill(`隔离个人看板 ${Date.now()}`);
    await page.locator('[name=type]').selectOption('mixed');
    await page.getByRole('button', { name: '保存并编排', exact: true }).click();
    await page.waitForURL(u => /^\/boards\/[^/]+\/design$/.test(u.pathname));
    const personalBoardId = new URL(page.url()).pathname.split('/')[2];
    created.push([`/boards/${personalBoardId}`]);
    const personalBoard = await api('GET', `/boards/${personalBoardId}`);
    result.checks.push({
      name: 'read-only team entry can create a personal board with explicit ownership',
      passed: !personalBoard.teamId && personalBoard.userId === seed.user.id,
    });
    await context.close();
  } finally {
    token = adminToken;
  }
  const journeyConditions = {
    type: 'events',
    steps: '5',
    startStep: 'register',
    endStep: 'purchase',
  };
  ({ page, context } = await pageAt(
    `/liekan/path-detail?websiteId=${seed.website.id}&${new URLSearchParams(journeyConditions)}`,
  ));
  for (const [label, path] of [
    ['高级筛选', '/liekan/filters'],
    ['图表注释', '/liekan/annotations'],
  ]) {
    await page.locator('.analysis-tools').getByRole('link', { name: label, exact: true }).click();
    await page.waitForURL(u => u.pathname === path);
  }
  await page.getByRole('tab', { name: '访问旅程', exact: true }).click();
  await page.waitForURL(u => u.pathname.endsWith('/journeys'));
  const journeyUrl = new URL(page.url());
  result.checks.push({
    name: 'journey detail retains step conditions after successive tools and breadcrumb return',
    passed: Object.entries(journeyConditions).every(
      ([key, value]) => journeyUrl.searchParams.get(key) === value,
    ),
  });
  await context.close();
  result.passed = result.checks.every(c => c.passed) && result.errors.length === 0;
} finally {
  try {
    for (const [url] of [...created].reverse())
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
