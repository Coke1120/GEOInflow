import { test, expect } from './fixtures';

test('traffic governance reads complete pages and rejects invalid or anonymous actions', async ({
  admin,
  api,
  seed,
}) => {
  const path = `/api/liekan/websites/${seed.website.id}/traffic-quality/exclusions`;
  const read = await admin.get(path);
  expect(read.status).toBe(200);
  expect(read.body).toMatchObject({
    revision: expect.any(String),
    epoch: expect.any(String),
    collections: expect.any(Array),
    nextCursor: null,
  });
  expect((await admin.get(path, { params: { cursor: 'invalid' } })).status).toBe(400);
  expect((await api.get(path)).status).toBe(401);
  expect(
    (
      await api.post(path, {
        action: 'revoke',
        collectionId: seed.website.id,
        expectedRevision: '0',
      })
    ).status,
  ).toBe(401);
  expect((await admin.post(path, { action: 'invalid' })).status).toBe(400);
});
