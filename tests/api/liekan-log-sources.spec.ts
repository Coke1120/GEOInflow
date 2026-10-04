import { test, expect } from './fixtures';

const missingSource = '00000000-0000-4000-8000-000000000099';

test.describe('Liekan automatic log access boundaries', () => {
  test('lists owner sources and rejects unauthenticated and foreign website readers', async ({
    admin,
    api,
    user,
    seed,
  }) => {
    const path = `/api/liekan/websites/${seed.website.id}/log-sources`;
    const listed = await admin.get(path);
    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.body.sources)).toBe(true);
    expect((await api.get(path)).status).toBe(401);
    expect((await user.get(path)).status).toBe(403);
  });

  test('rejects foreign source management before changing state', async ({ user, admin, seed }) => {
    const base = `/api/liekan/websites/${seed.website.id}/log-sources`;
    const before = await admin.get(base);
    expect((await user.put(`${base}/${missingSource}`, { action: 'pause' })).status).toBe(403);
    expect((await user.del(`${base}/${missingSource}`)).status).toBe(403);
    expect((await admin.get(base)).body).toEqual(before.body);
  });

  test('rejects foreign pairing and Cloudflare setup before creating flows or contacting providers', async ({
    user,
    admin,
    seed,
  }) => {
    const base = `/api/liekan/websites/${seed.website.id}/log-sources`;
    const before = await admin.get(base);
    expect((await user.post(`${base}/server/pairing`, {})).status).toBe(403);
    expect((await user.post(`${base}/cloudflare/start`, {})).status).toBe(403);
    expect((await user.post(`${base}/cloudflare/finalize`, {})).status).toBe(403);
    expect((await admin.get(base)).body).toEqual(before.body);
  });

  test('rejects malformed collector pairing codes', async ({ api }) => {
    const response = await api.post('/api/liekan/collectors/pair', {});
    expect(response.status).toBe(400);
  });

  test('rejects batches and heartbeats without a source credential', async ({ api }) => {
    const base = `/api/liekan/log-sources/${missingSource}`;
    expect((await api.post(`${base}/batches`, {})).status).toBe(401);
    expect((await api.post(`${base}/heartbeat`, {})).status).toBe(401);
  });

  test('rejects incomplete Cloudflare callbacks without a redirect or provider exchange', async ({
    api,
  }) => {
    const response = await api.get('/api/liekan/oauth/cloudflare/callback');
    expect(response.status).toBe(400);
    expect(response.headers.location).toBeUndefined();
  });
});
