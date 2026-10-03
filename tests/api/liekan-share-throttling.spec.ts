import { expect, test } from './fixtures';
import { createWebsite, uniqueName } from './helpers/entities';

test.describe('public share password request bounds', () => {
  test('wrong password attempts are bounded while the GET challenge and other shares remain usable', async ({
    admin,
    api,
  }) => {
    const website = await createWebsite(admin, { name: uniqueName('share-throttling') });
    let shareId: string | undefined;
    try {
      const created = await admin.post(`/api/websites/${website.id}/shares`, {
        name: 'Bounded share',
        parameters: { overview: true, password: 'fixture-password' },
      });
      expect(created.status, created.text).toBe(200);
      shareId = created.body.id;
      const path = `/api/share/${created.body.slug}`;
      expect(
        (await api.post(path, { password: 'fixture-password', extra: 'x'.repeat(2048) })).status,
      ).toBe(413);
      const valid = await api.post(path, { password: 'fixture-password' });
      expect(valid.status, valid.text).toBe(200);
      expect(valid.body.token).toBeTruthy();
      for (let i = 0; i < 4; i++)
        expect((await api.post(path, { password: 'wrong-password' })).status).toBe(401);
      const blocked = await api.post(path, { password: 'fixture-password' });
      expect(blocked.status, blocked.text).toBe(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      const challenge = await api.get(path);
      expect(challenge.status).toBe(200);
      expect(challenge.body.requiresPassword).toBe(true);
      expect(challenge.body.token).toBeUndefined();
      await admin.post(`/api/share/id/${shareId}`, {
        name: created.body.name,
        slug: created.body.slug,
        parameters: { overview: true, password: null },
      });
      const unprotected = await api.get(path);
      expect(unprotected.status, unprotected.text).toBe(200);
      expect(unprotected.body.token).toBeTruthy();
    } finally {
      if (shareId) await admin.del(`/api/share/id/${shareId}`);
      await admin.del(`/api/websites/${website.id}`);
    }
  });

  test('simultaneous public checks return an explicit retry response', async ({ admin, api }) => {
    const website = await createWebsite(admin, { name: uniqueName('share-concurrency') });
    try {
      const created = await admin.post(`/api/websites/${website.id}/shares`, {
        name: 'Concurrent share',
        parameters: { overview: true, password: 'fixture-password' },
      });
      expect(created.status, created.text).toBe(200);
      const path = `/api/share/${created.body.slug}`;
      const responses = await Promise.all(
        Array.from({ length: 12 }, () => api.post(path, { password: 'wrong-password' })),
      );
      expect(responses.every(response => [401, 429].includes(response.status))).toBe(true);
      expect(responses.filter(response => response.status === 401).length).toBeLessThanOrEqual(5);
      expect(responses.some(response => response.status === 429)).toBe(true);
      for (const response of responses.filter(response => response.status === 429))
        expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      await admin.del(`/api/websites/${website.id}`);
    }
  });
});
