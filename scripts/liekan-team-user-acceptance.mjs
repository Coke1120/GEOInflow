import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { isolatedAcceptanceTarget, acceptanceSeedFile } from './liekan-acceptance-target.mjs';
import { checkDialog } from './liekan-dialog-contract.mjs';

const base = process.env.LIEKAN_URL || 'http://127.0.0.1:3302';
const target = isolatedAcceptanceTarget(base);
const container = process.env.LIEKAN_TEAM_TEST_DB_CONTAINER;
assert(
  /^liekan-verify-[a-f0-9]{12}-\d+-db$/.test(container || ''),
  'Use the isolated acceptance database',
);
const seed = JSON.parse(fs.readFileSync(acceptanceSeedFile(target), 'utf8'));
const out = 'test-results/liekan-team-users';
fs.mkdirSync(out, { recursive: true });
const report = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  passed: false,
  checks: [],
  responsive: [],
  errors: [],
  cleanup: false,
};
const password = randomBytes(24).toString('hex');
const users = new Set(),
  teams = [];
let token,
  browser,
  trigger = false;
async function request(method, path, body, credential = token) {
  const response = await fetch(base + '/api' + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(credential ? { authorization: `Bearer ${credential}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, body: await response.json() };
}
async function api(method, path, body) {
  const result = await request(method, path, body);
  assert.equal(result.status, 200, `${method} ${path}: ${result.status}`);
  return result.body;
}
function sql(input, variables = {}) {
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      container,
      'psql',
      '-U',
      'liekan_verify',
      '-d',
      'liekan_empty',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
      ...Object.entries(variables).flatMap(([name, value]) => ['-v', `${name}=${value}`]),
    ],
    { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000 },
  ).trim();
}
const body = (role = 'team-view-only') => ({
  userId: randomUUID(),
  username: `team-acceptance-${randomUUID()}`,
  password,
  teamRole: role,
});
const endpoint = id => `/liekan/teams/${id}/users/create`;
try {
  token = (await request('POST', '/auth/login', seed.admin, '')).body.token;
  assert(token);
  for (let i = 0; i < 2; i++)
    teams.push((await api('POST', '/teams', { name: `新建用户（隔离验收 ${i + 1}）` }))[0]);
  const team = teams[0];
  const rollback = body();
  users.add(rollback.userId);
  // The trigger matches one synthetic ID across connections, with psql quoting the literal.
  sql(
    `CREATE FUNCTION liekan_team_user_test_failure() RETURNS trigger LANGUAGE plpgsql AS
    :'function_body';
    CREATE TRIGGER liekan_team_user_test_failure BEFORE INSERT ON team_user
      FOR EACH ROW EXECUTE FUNCTION liekan_team_user_test_failure();`,
    {
      function_body: `BEGIN IF NEW.user_id = '${rollback.userId}'::uuid THEN RAISE EXCEPTION 'isolated membership failure'; END IF; RETURN NEW; END;`,
    },
  );
  trigger = true;
  assert.equal((await request('POST', endpoint(team.id), rollback)).status, 500);
  assert.equal(
    sql(`SELECT count(*) FROM "user" WHERE user_id = :'user_id'::uuid;`, {
      user_id: rollback.userId,
    }),
    '0',
  );
  assert.equal(
    sql(`SELECT count(*) FROM team_user WHERE user_id = :'user_id'::uuid;`, {
      user_id: rollback.userId,
    }),
    '0',
  );
  sql(
    'DROP TRIGGER liekan_team_user_test_failure ON team_user; DROP FUNCTION liekan_team_user_test_failure();',
  );
  trigger = false;
  const retry = await api('POST', endpoint(team.id), rollback);
  assert.equal(retry.state, 'created');
  report.checks.push({
    name: 'membership failure rolls back account and same attempt can retry',
    passed: true,
  });

  const concurrent = body(),
    other = { ...concurrent, userId: randomUUID() };
  users.add(concurrent.userId);
  users.add(other.userId);
  const race = await Promise.all([
    request('POST', endpoint(team.id), concurrent),
    request('POST', endpoint(teams[1].id), other),
  ]);
  assert.deepEqual(race.map(result => result.status).sort(), [200, 409]);
  assert.equal(race.find(result => result.status === 409).body.error.code, 'username-conflict');
  report.checks.push({
    name: 'different teams classify real database username conflicts',
    passed: true,
  });

  while (
    Number(
      sql(`SELECT count(*) FROM team_user WHERE team_id = :'team_id'::uuid;`, { team_id: team.id }),
    ) < 20
  ) {
    const input = body();
    users.add(input.userId);
    await api('POST', endpoint(team.id), input);
  }
  browser = await chromium.launch({
    headless: true,
    ...(!process.env.CI ? { channel: 'chrome' } : {}),
  });
  for (const width of [1440, 900, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      locale: 'zh-CN',
      reducedMotion: 'reduce',
    });
    try {
      await context.addInitScript(
        value => localStorage.setItem('umami.auth', JSON.stringify(value)),
        token,
      );
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      page.on('pageerror', error => report.errors.push(error.message));
      await page.goto(
        `${base}/liekan/team-detail?${new URLSearchParams({ id: team.id, teamId: team.id })}`,
      );
      await page.getByRole('button', { name: '新建用户', exact: true }).click();
      const dialog = page.getByRole('dialog');
      assert.equal(await dialog.locator('select[name=teamRole]').inputValue(), 'team-view-only');
      await dialog.locator('select[name=teamRole]').selectOption('team-manager');
      assert(await dialog.getByText('管理团队成员及只读成员', { exact: true }).isVisible());
      await dialog.locator('select[name=teamRole]').selectOption('team-view-only');
      const geometry = await checkDialog(page);
      await page.screenshot({ path: `${out}/create-${width}.png`, fullPage: true });
      const input = body();
      users.add(input.userId);
      // The browser owns its request ID; capture it for fixture cleanup and metadata checks.
      const response = page.waitForResponse(
        value => value.url().endsWith(endpoint(team.id)) && value.request().method() === 'POST',
      );
      await dialog.locator('input[name=username]').fill(`  ${input.username.toUpperCase()}  `);
      await dialog.locator('input[name=password]').fill(password);
      await dialog.locator('input[name=confirmPassword]').fill(password);
      await dialog.getByRole('button', { name: '创建并加入团队', exact: true }).click();
      const result = await response;
      assert.equal(result.status(), 200);
      const created = await result.json();
      users.add(created.user.id);
      assert.equal(created.user.username, input.username);
      assert.equal(created.member.role, 'team-view-only');
      assert.equal(created.page, 2);
      await dialog.waitFor({ state: 'hidden' });
      await page.locator('tr[data-highlighted=true]').filter({ hasText: input.username }).waitFor();
      await page
        .getByText(`用户“${input.username}”已创建并加入团队，角色为团队只读。`, { exact: true })
        .waitFor();
      const login = await request(
        'POST',
        '/auth/login',
        { username: input.username, password },
        '',
      );
      assert.equal(login.status, 200);
      const member = await request('GET', `/teams/${team.id}`, undefined, login.body.token);
      assert.equal(member.status, 200);
      const denied = await request('GET', `/teams/${teams[1].id}`, undefined, login.body.token);
      assert.equal(denied.status, 401);
      await page.screenshot({ path: `${out}/created-${width}.png`, fullPage: true });
      report.responsive.push({
        width,
        passed: true,
        page: created.page,
        dialogWidth: geometry.width,
      });
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  try {
    if (trigger)
      sql(
        'DROP TRIGGER IF EXISTS liekan_team_user_test_failure ON team_user; DROP FUNCTION IF EXISTS liekan_team_user_test_failure();',
      );
    for (const team of teams.reverse()) await api('DELETE', `/teams/${team.id}`);
    for (const id of users) {
      const result = await request('DELETE', `/users/${id}`);
      assert([200, 404].includes(result.status), `Fixture cleanup: ${result.status}`);
    }
    report.cleanup = true;
  } finally {
    await browser?.close();
    fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  }
}
console.log(JSON.stringify(report));
