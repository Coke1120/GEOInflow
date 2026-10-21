import { geoWeightResponseSchema } from '../../src/lib/liekan/contracts/geo-weight';
import { expect, test } from './fixtures';
import { createWebsite, deleteWebsite } from './helpers/entities';

test('keeps an empty GEO weight distinct and exports its pinned calculation', async ({
  admin,
  api,
  apiKey,
  user,
  share,
  seed,
}) => {
  const versionPath = '/api/liekan/catalog-version';
  expect((await api.get(versionPath)).status).toBe(401);
  expect((await apiKey.get(versionPath)).status).toBe(401);
  const version = await admin.get(versionPath);
  expect(version.status, version.text).toBe(200);
  if (seed.db === 'clickhouse') {
    expect(version.body.version).toBeNull();
    const unsupported = `/api/liekan/websites/${seed.website.id}/geo-weight`;
    expect((await admin.get(unsupported)).status).toBe(503);
    expect((await admin.post(unsupported + '/export', {})).status).toBe(503);
    return;
  }
  expect(version.body.version).toMatch(/^[a-f0-9-]{36}$/i);
  const website = await createWebsite(admin);
  const path = `/api/liekan/websites/${website.id}/geo-weight`;
  const params = {
    asOf: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    timezone: 'UTC',
    view: 'detail',
  };
  try {
    for (const client of [api, apiKey, await share()]) {
      expect((await client.get(path, { params })).status).toBe(401);
      expect((await client.post(path + '/export', {})).status).toBe(401);
    }
    expect((await user.get(path, { params })).status).toBe(404);
    const result = await admin.get(path, { params });
    expect(result.status, result.text).toBe(200);
    expect(geoWeightResponseSchema.safeParse(result.body).success, result.text).toBe(true);
    expect(result.body.readCatalogVersion).toBe(version.body.version);
    expect(result.body.current.state).toBe('missing');
    expect(result.body.current.level).toBeNull();
    const exported = await admin.post(path + '/export', {
      asOf: params.asOf,
      timezone: params.timezone,
      locale: 'en-US',
      catalogVersion: result.body.readCatalogVersion,
      snapshot: result.body.snapshot,
    });
    expect(exported.status, exported.text).toBe(200);
    expect(exported.headers['content-type']).toContain('text/csv');
    expect(exported.headers['cache-control']).toMatch(/private.*no-store/);
    expect(exported.text).toContain(result.body.snapshot);
    expect(exported.text).toContain('metadata');
  } finally {
    await deleteWebsite(admin, website.id);
  }
});
