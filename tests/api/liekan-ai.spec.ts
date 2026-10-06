import { expect, test } from './fixtures';
import { getAiEndpoints } from './helpers/ai-endpoints';
import { aiCatalogSchema } from '../../src/lib/liekan/ai/api-contracts';

test('all private AI endpoints reject anonymous, API key and public share identities', async ({
  api,
  apiKey,
  share,
}) => {
  const endpoints = getAiEndpoints(),
    publicShare = await share();
  expect(endpoints.length).toBeGreaterThanOrEqual(16);
  for (const endpoint of endpoints) {
    for (const client of [api, apiKey, publicShare]) {
      const response = await client.request(endpoint.method, endpoint.path, {
        data: endpoint.method === 'GET' || endpoint.method === 'DELETE' ? undefined : {},
      });
      expect(response.status, `${endpoint.method} ${endpoint.path}: ${response.text}`).toBe(401);
      expect(response.body.error.code).toBe('session_required');
      expect(response.headers['cache-control']).toMatch(/private.*no-store/);
    }
  }
});
test('AI catalog exposes actual templates and authorized spaces to a full session', async ({
  admin,
  seed,
}) => {
  const response = await admin.get('/api/liekan/ai/catalog');
  expect(response.status, response.text).toBe(200);
  expect(aiCatalogSchema.safeParse(response.body).success).toBe(true);
  expect(response.body.templates).toHaveLength(8);
  expect(response.body.spaces).toContainEqual(
    expect.objectContaining({ kind: 'personal', id: seed.admin.id }),
  );
  expect(response.headers['cache-control']).toMatch(/private.*no-store/);
});
