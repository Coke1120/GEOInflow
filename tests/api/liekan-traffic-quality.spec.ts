import { randomUUID } from 'node:crypto';
import { expect, test } from './fixtures';
import { createWebsite, deleteWebsite } from './helpers/entities';

const browserUa =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

test('authenticates server intake, deduplicates events and audits normalized policy changes', async ({
  admin,
  apiKey,
}) => {
  const website = await createWebsite(admin, { domain: 'traffic-quality.test' });
  const endpoint = `/api/liekan/websites/${website.id}/traffic-quality`;
  const body = {
    type: 'event',
    payload: {
      website: website.id,
      eventId: randomUUID(),
      hostname: 'WWW.Traffic-Quality.Test:443',
      url: '/quality-api',
    },
  };
  const options = { headers: { 'user-agent': browserUa } };
  try {
    for (let retry = 0; retry < 2; retry++) {
      const response = await admin.post('/api/liekan/collect', body, options);
      expect(response.status).toBe(200);
      expect(response.body.sessionId).toMatch(/^[a-f0-9-]{36}$/i);
      expect(response.headers).not.toHaveProperty('set-cookie');
    }
    expect(
      (
        await admin.post(
          '/api/liekan/collect',
          { ...body, payload: { ...body.payload, url: '/conflict' } },
          options,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await apiKey.post(
          '/api/liekan/collect',
          { ...body, payload: { ...body.payload, eventId: randomUUID(), url: '/api-key' } },
          options,
        )
      ).status,
    ).toBe(200);
    const raw = await admin.put(endpoint, { mode: 'raw', allowedHostnames: [] });
    expect(raw.status).toBe(200);
    const standard = await admin.put(endpoint, {
      mode: 'standard',
      allowedHostnames: ['WWW.Traffic-Quality.Test:443'],
    });
    expect(standard.status).toBe(200);
    expect(standard.body).toMatchObject({
      mode: 'standard',
      allowedHostnames: ['traffic-quality.test'],
    });
    expect(Number(standard.body.revision)).toBeGreaterThan(Number(raw.body.revision));
    const audit = await admin.get(endpoint, {
      params: { startAt: Date.now() - 60000, endAt: Date.now() + 1000 },
    });
    expect(audit.status).toBe(200);
    expect(audit.body.rows).toHaveLength(2);
    expect(
      audit.body.rows.every(
        row =>
          row.source === 'authenticated_server' &&
          row.normalizedHostname === 'traffic-quality.test' &&
          row.included,
      ),
    ).toBe(true);
    expect(audit.body.rows.map(row => row.path).sort()).toEqual(['/api-key', '/quality-api']);
    expect(audit.body.summary.reduce((sum, row) => sum + row.events, 0)).toBe(2);
  } finally {
    await deleteWebsite(admin, website.id);
  }
});

test('rejects public, share and unrelated identities for private collection quality controls', async ({
  admin,
  api,
  user,
  share,
}) => {
  const website = await createWebsite(admin);
  const endpoint = `/api/liekan/websites/${website.id}/traffic-quality`;
  const body = {
    type: 'event',
    payload: { website: website.id, url: '/denied', eventId: randomUUID() },
  };
  try {
    for (const [client, status] of [
      [api, 401],
      [await share(), 401],
      [user, 403],
    ] as const) {
      expect((await client.post('/api/liekan/collect', body)).status).toBe(status);
      expect((await client.get(endpoint)).status).toBe(status);
      expect((await client.put(endpoint, { mode: 'raw', allowedHostnames: [] })).status).toBe(
        status,
      );
    }
    const audit = await admin.get(endpoint);
    expect(audit.status).toBe(200);
    expect(audit.body.rows).toEqual([]);
    expect(audit.body.policy.mode).toBe('standard');
  } finally {
    await deleteWebsite(admin, website.id);
  }
});
