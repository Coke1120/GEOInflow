import type { HttpMethod } from './client';
import { expect, test } from './fixtures';
import { loadOperations } from './coverage/oracle';
import { createWebsite, deleteWebsite } from './helpers/entities';

test('all crawler endpoints require a full session before reading or accepting control input', async ({
  api,
  apiKey,
  share,
}) => {
  const endpoints = loadOperations().filter(operation =>
    /\/crawler-|\/control-connections/.test(operation.path),
  );
  const publicShare = await share();
  expect(endpoints).toHaveLength(27);
  for (const endpoint of endpoints) {
    const method = endpoint.method.toUpperCase() as HttpMethod;
    const path = endpoint.path.replace(/\{[^}]+\}/g, '11111111-1111-4111-8111-111111111111');
    for (const client of [api, apiKey, publicShare]) {
      const response = await client.request(method, path, {
        data: method === 'GET' ? undefined : {},
      });
      expect(response.status, `${method} ${path}: ${response.text}`).toBe(401);
      expect(response.body.error).toMatchObject({ status: 401, code: 'liekan-error' });
      expect(response.headers['cache-control']).toMatch(/private.*no-store/);
    }
  }
});

test.describe('crawler snapshots and local drafts', () => {
  test.describe.configure({ mode: 'serial' });
  let websiteId = '';
  const root = () => `/api/liekan/websites/${websiteId}`;
  test.beforeAll(async ({ admin }) => {
    websiteId = (await createWebsite(admin)).id;
  });
  test.afterAll(async ({ admin }) => {
    if (websiteId) await deleteWebsite(admin, websiteId);
  });

  test('manual analysis refresh preserves authorization and normal reads avoid the force throttle', async ({
    admin,
    user,
  }) => {
    const path = `${root()}/crawler-analysis`;
    const params = {
      startAt: Date.now() - 86400000,
      endAt: Date.now() - 60000,
      timezone: 'Asia/Shanghai',
    };
    expect((await user.get(path, { params: { ...params, refresh: 1 } })).status).toBe(403);
    const first = await admin.get(path, { params });
    expect(first.status, first.text).toBe(200);
    expect(first.body).toMatchObject({
      range: params,
      bots: [],
      pages: [],
      criticalPaths: [],
      permissions: { canDraft: true, canControl: true },
    });
    expect(Number(first.headers['x-liekan-generated-at'])).toBeGreaterThan(0);
    const refreshed = await admin.get(path, { params: { ...params, refresh: 1 } });
    expect(refreshed.status, refreshed.text).toBe(200);
    expect(refreshed.headers['cache-control']).toMatch(/private.*no-store/);
    const throttled = await admin.get(path, { params: { ...params, refresh: 1 } });
    expect(throttled.status, throttled.text).toBe(429);
    expect(Number(throttled.headers['retry-after'])).toBeGreaterThan(0);
    expect((await admin.get(path, { params })).status).toBe(200);

    const saved = await admin.request('PATCH', path, { data: { paths: ['/pricing'] } });
    expect(saved.status, saved.text).toBe(200);
    expect((await admin.get(path, { params })).body.criticalPaths).toEqual(['/pricing']);
  });

  test('reads controls and stores versioned drafts without provider authority', async ({
    admin,
    user,
  }) => {
    for (const endpoint of [
      'control-connections',
      'crawler-policies',
      'crawler-checks',
      'crawler-domain-verification',
    ]) {
      const path = `${root()}/${endpoint}`;
      expect((await user.get(path)).status).toBe(403);
      const response = await admin.get(path);
      expect(response.status, response.text).toBe(200);
      expect(response.headers['cache-control']).toMatch(/private.*no-store/);
    }
    const draft = {
      name: 'API snapshot draft',
      botIds: ['gptbot'],
      paths: [{ value: '/pricing', match: 'exact' }],
      action: 'observe',
      expectedAccess: 'allow',
    };
    const created = await admin.post(`${root()}/crawler-policies`, draft);
    expect(created.status, created.text).toBe(200);
    expect(created.body).toMatchObject({ websiteId, version: 1, state: 'draft' });
    const path = `${root()}/crawler-policies/${created.body.id}`;
    expect((await admin.get(path)).body.policy.id).toBe(created.body.id);
    const changed = await admin.request('PATCH', path, {
      data: { ...draft, name: 'Updated', version: 1 },
    });
    expect(changed.status, changed.text).toBe(200);
    expect(changed.body.version).toBe(2);
    expect((await admin.request('PATCH', path, { data: { ...draft, version: 1 } })).status).toBe(
      409,
    );
    const invalidConnection = await admin.post(`${root()}/control-connections`, {});
    expect(invalidConnection.status).toBe(400);
    const blockedCheck = await admin.post(`${root()}/crawler-checks`, { paths: ['/pricing'] });
    expect(blockedCheck.status, blockedCheck.text).toBe(409);
    expect((await admin.get(`${root()}/crawler-checks`)).body).toEqual([]);
    const policies = await admin.get(`${root()}/crawler-policies`);
    expect(policies.body.deployments).toEqual([]);
    expect(policies.body.connections).toEqual([]);
  });
});
