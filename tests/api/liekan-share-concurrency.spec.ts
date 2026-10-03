import { expect, test } from './fixtures';
import { ENTITY_TYPE, SHARE_CONTEXT_HEADER, SHARE_TOKEN_HEADER } from './helpers/constants';
import { dateRange } from './helpers/dates';
import { uniqueName, uniqueSlug } from './helpers/entities';

test('concurrent metadata writes preserve password rotation and removal', async ({
  admin,
  api,
  seed,
}) => {
  const slug = uniqueSlug('atomic');
  const created = await admin.post('/api/share', {
    name: uniqueName('atomic-share'),
    slug,
    entityId: seed.website.id,
    shareType: ENTITY_TYPE.website,
    parameters: { overview: true, password: 'old-fixture' },
  });
  expect(created.status, created.text).toBe(200);
  try {
    const oldAccess = await api.post(`/api/share/${slug}`, { password: 'old-fixture' });
    expect(oldAccess.status, oldAccess.text).toBe(200);
    const stale = api.with({
      [SHARE_TOKEN_HEADER]: oldAccess.body.token,
      [SHARE_CONTEXT_HEADER]: '1',
    });
    const write = (parameters: Record<string, unknown>) =>
      admin.post(`/api/share/id/${created.body.id}`, {
        name: created.body.name,
        slug,
        parameters,
      });
    for (const password of ['new-fixture', null]) {
      const results = await Promise.all([
        ...Array.from({ length: 8 }, () => write({ overview: true })),
        write({ overview: true, password }),
        ...Array.from({ length: 8 }, () => write({ overview: true })),
      ]);
      for (const result of results) {
        expect(result.status, result.text).toBe(200);
        expect(result.body.parameters.hasPassword).toBeDefined();
        expect(result.body.parameters).not.toHaveProperty('passwordHash');
      }
      const latest = await admin.get(`/api/share/id/${created.body.id}`);
      expect(latest.body.parameters.hasPassword).toBe(password !== null);
      if (password) {
        expect((await api.post(`/api/share/${slug}`, { password: 'old-fixture' })).status).toBe(
          401,
        );
        expect((await api.post(`/api/share/${slug}`, { password })).status).toBe(200);
      } else {
        const opened = await api.get(`/api/share/${slug}`);
        expect(opened.status, opened.text).toBe(200);
        expect(opened.body.token).toBeTruthy();
        expect(opened.body.requiresPassword).toBeUndefined();
      }
      expect(
        (await stale.get(`/api/websites/${seed.website.id}/stats`, { params: dateRange(seed) }))
          .status,
      ).toBe(401);
    }
  } finally {
    await admin.del(`/api/share/id/${created.body.id}`);
  }
});
