import { randomUUID } from 'node:crypto';
import { expect, test } from './fixtures';
import { createWebsite, deleteWebsite, createUser, deleteUser } from './helpers/entities';
import { login } from './helpers/auth';

const campaignId = 'traffic-quality-repair-20261022-v1';
const mutationBodies = () => {
  const common = { actionId: randomUUID(), runId: randomUUID(), expectedRevision: 1 };
  return {
    scan: { actionId: randomUUID(), timezone: 'Asia/Shanghai', locale: 'zh-CN' },
    preview: common,
    confirm: {
      ...common,
      generation: randomUUID(),
      previewDigest: 'a'.repeat(64),
      partialConfirmed: true,
    },
    action: { ...common, action: 'pause' },
    evidence: {
      ...common,
      action: 'append',
      uploadId: randomUUID(),
      sequence: 0,
      source: 'isolated API fixture',
      records: [{ eventId: randomUUID(), requestUserAgent: 'GPTBot/1.0' }],
    },
  };
};

test('keeps fresh websites outside the one-time campaign and requires an explicit scan', async ({
  admin,
  seed,
  api,
}) => {
  const website = await createWebsite(admin, { domain: 'repair-api.test' });
  const root = `/api/liekan/websites/${website.id}/history-repair`;
  let noticeUser: { id: string } | undefined;
  try {
    if (seed.db === 'clickhouse') {
      expect((await admin.get('/api/liekan/history-repair')).status).toBe(501);
      expect(
        (await admin.put('/api/liekan/history-repair', { campaignId, action: 'dismiss' })).status,
      ).toBe(501);
      expect((await admin.get(root)).status).toBe(501);
      expect(
        (await admin.get(`${root}/export`, { params: { generation: randomUUID() } })).status,
      ).toBe(501);
      for (const [suffix, body] of Object.entries(mutationBodies()))
        expect((await admin.post(`${root}/${suffix}`, body)).status, suffix).toBe(501);
      return;
    }
    const listing = await admin.get('/api/liekan/history-repair');
    expect(listing.status).toBe(200);
    expect(listing.body).toMatchObject({ campaignId, supported: true });
    const status = await admin.get(root);
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ campaignId, eligible: false, hasData: false, run: null });
    for (const [suffix, body] of Object.entries(mutationBodies())) {
      const result = await admin.post(`${root}/${suffix}`, body);
      expect(result.status, suffix).toBe(409);
      expect(result.body.error.code).toBe(
        suffix === 'scan' ? 'history-repair-ineligible' : 'history-repair-scan-required',
      );
    }
    const exported = await admin.get(`${root}/export`, { params: { generation: randomUUID() } });
    expect(exported.status).toBe(409);
    expect(exported.body.error.code).toBe('history-repair-scan-required');
    const temporaryUser = await createUser(admin);
    noticeUser = temporaryUser;
    const noticeClient = api.bearer(await login(api, temporaryUser));
    const notice = await noticeClient.put('/api/liekan/history-repair', {
      campaignId,
      action: 'dismiss',
    });
    expect(notice.status).toBe(200);
    expect((await noticeClient.get('/api/liekan/history-repair')).body.dismissed).toBe(true);
    expect((await admin.get(root)).body.run).toBeNull();
  } finally {
    if (noticeUser) await deleteUser(admin, noticeUser.id);
    await deleteWebsite(admin, website.id);
  }
});

test('rejects anonymous, API key, public share and unrelated users on every repair endpoint', async ({
  admin,
  api,
  apiKey,
  share,
  user,
  seed,
}) => {
  test.skip(
    seed.db === 'clickhouse',
    'PostgreSQL repair identity checks; unsupported responses are covered separately.',
  );
  const website = await createWebsite(admin);
  const root = `/api/liekan/websites/${website.id}/history-repair`;
  try {
    const shared = await share();
    for (const client of [api, apiKey, shared]) {
      expect((await client.get('/api/liekan/history-repair')).status).toBe(401);
      expect(
        (await client.put('/api/liekan/history-repair', { campaignId, action: 'dismiss' })).status,
      ).toBe(401);
    }
    for (const [client, status] of [
      [api, 401],
      [apiKey, 401],
      [shared, 401],
      [user, 403],
    ] as const) {
      expect((await client.get(root)).status).toBe(status);
      expect(
        (await client.get(`${root}/export`, { params: { generation: randomUUID() } })).status,
      ).toBe(status);
      for (const [suffix, body] of Object.entries(mutationBodies()))
        expect((await client.post(`${root}/${suffix}`, body)).status, suffix).toBe(status);
    }
    expect((await admin.get(root)).body.run).toBeNull();
  } finally {
    await deleteWebsite(admin, website.id);
  }
});
