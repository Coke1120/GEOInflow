import { cacheManifestResponseSchema } from '../../src/lib/liekan/contracts/cache-manifest';
import { expect, test } from './fixtures';
import { createWebsite, deleteWebsite } from './helpers/entities';

test('authorizes browser restoration against current resources and deployment identity', async ({
  admin,
  user,
  api,
  apiKey,
  share,
  seed,
}) => {
  const path = '/api/liekan/cache-manifest';
  const params = { resources: JSON.stringify([{ type: 'website', id: seed.website.id }]) };
  for (const client of [api, apiKey, await share()])
    expect((await client.get(path, { params })).status).toBe(401);
  if (seed.db === 'clickhouse') {
    expect((await admin.get(path, { params })).status).toBe(503);
    return;
  }
  const website = await createWebsite(admin);
  const scope = { resources: JSON.stringify([{ type: 'website', id: website.id }]) };
  let removed = false;
  try {
    const first = await admin.get(path, { params: scope });
    expect(first.status, first.text).toBe(200);
    expect(cacheManifestResponseSchema.safeParse(first.body).success, first.text).toBe(true);
    expect(first.body.resources[0]).toMatchObject({
      type: 'website',
      id: website.id,
      authorized: true,
    });
    expect(first.headers['cache-control']).toMatch(/private.*no-store/);
    const again = await admin.get(path, { params: scope });
    expect(again.body.instanceId).toBe(first.body.instanceId);
    expect(again.body.resources[0].strongVersion).toBe(first.body.resources[0].strongVersion);
    const denied = await user.get(path, { params: scope });
    expect(denied.status, denied.text).toBe(200);
    expect(denied.body.resources).toEqual([{ type: 'website', id: website.id, authorized: false }]);
    expect(
      (
        await admin.get(path, {
          params: {
            resources: JSON.stringify(
              Array.from({ length: 21 }, () => ({ type: 'website', id: website.id })),
            ),
          },
        })
      ).status,
    ).toBe(400);
    await deleteWebsite(admin, website.id);
    removed = true;
    const deleted = await admin.get(path, { params: scope });
    expect(deleted.body.resources).toEqual([
      { type: 'website', id: website.id, authorized: false },
    ]);
  } finally {
    if (!removed) await deleteWebsite(admin, website.id);
  }
});
