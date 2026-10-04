import { expect, test } from './fixtures';
import { createWebsite } from './helpers/entities';

test('installation reads require private website access and retain truthful connection states', async ({
  api,
  user,
  viewer,
  share,
  seed,
}) => {
  const site = await createWebsite(user);
  const path = `/api/liekan/websites/${site.id}/installation`;
  try {
    expect((await api.get(path)).status).toBe(401);
    expect((await viewer.get(path)).status).toBe(403);
    expect((await viewer.post(path, { action: 'skip-browser' })).status).toBe(403);
    expect(
      (await (await share()).get(`/api/liekan/websites/${seed.website.id}/installation`)).status,
    ).toBe(401);
    const result = await user.get(path);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      canManage: true,
      progress: {
        method: 'cloudflare',
        lastStep: 'js',
        browserCheckDeferred: false,
        logCheckDeferred: false,
        completedAt: null,
      },
      logs: { total: 0, ai: 0, latestAt: null, latestImportAt: null, demo: false },
      capabilities: { cloudflare: false, server: false },
    });
  } finally {
    await user.del(`/api/websites/${site.id}`);
  }
});

test('saved installation progress survives reads without manufacturing collected data', async ({
  user,
}) => {
  const site = await createWebsite(user);
  const path = `/api/liekan/websites/${site.id}/installation`;
  try {
    expect((await user.post(path, { action: 'skip-browser' })).status).toBe(200);
    expect((await user.post(path, { action: 'skip-logs', method: 'server' })).status).toBe(200);
    const completed = await user.post(path, { action: 'finish', method: 'server' });
    expect(completed.status).toBe(200);
    expect(completed.body.progress.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const repeated = await user.post(path, { action: 'finish', method: 'server' });
    expect(repeated.body.progress.completedAt).toBe(completed.body.progress.completedAt);
    expect((await user.post(path, { action: 'finish', method: 'invalid' })).status).toBe(400);
    const read = await user.get(path);
    expect(read.status).toBe(200);
    expect(read.body.progress).toEqual(completed.body.progress);
    expect(read.body.progress).toMatchObject({
      browserCheckDeferred: true,
      logCheckDeferred: true,
      method: 'server',
    });
    expect(read.body.logs).toMatchObject({ total: 0, ai: 0, latestAt: null });
    expect(read.body.capabilities).toEqual({ cloudflare: false, server: false });
  } finally {
    await user.del(`/api/websites/${site.id}`);
  }
});
