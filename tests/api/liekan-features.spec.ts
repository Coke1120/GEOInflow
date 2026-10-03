import JSZip from 'jszip';
import { expect, test } from './fixtures';
import { dateRange } from './helpers/dates';
import { ENTITY_TYPE, SHARE_CONTEXT_HEADER, SHARE_TOKEN_HEADER } from './helpers/constants';
import { uniqueName, uniqueSlug } from './helpers/entities';
import {
  featureAnalyticsResponse,
  goalAnalyticsResponse,
  journeyResponse,
} from '../../src/lib/liekan/contracts/feature-responses';
import { resourceSourcesResponse } from '../../src/lib/liekan/contracts/resource-sources';

test.describe('Liekan integrated feature contracts', () => {
  const kinds = [
    'events',
    'utm',
    'sources',
    'sessions',
    'session',
    'session-properties',
    'realtime',
    'performance',
    'revenue',
    'attribution',
    'heatmap-scroll',
    'replays',
  ];
  for (const kind of kinds)
    test(`real ${kind} data satisfies the UI contract`, async ({ admin, seed }) => {
      const response = await admin.get(`/api/liekan/websites/${seed.website.id}/analytics`, {
        params: {
          ...dateRange(seed),
          timezone: 'UTC',
          kind,
          sessionId: seed.data.sessionId,
          urlPath: seed.data.pages[0],
          currency: seed.data.currency,
          type: 'event',
          step: seed.data.eventNames[0],
          model: 'last-click',
        },
      });
      if (seed.db === 'clickhouse') {
        expect(response.status).toBe(501);
        return;
      }
      expect(response.status, response.text).toBe(200);
      expect(
        featureAnalyticsResponse.safeParse(response.body).success,
        JSON.stringify(response.body),
      ).toBe(true);
      if (kind === 'events') expect(response.body.totals.total).toBeGreaterThan(0);
      if (kind === 'sessions') expect(response.body.count).toBeGreaterThan(0);
      if (kind === 'performance') expect(response.body.lcpCount).toBeGreaterThan(0);
      if (kind === 'revenue') expect(response.body.count).toBeGreaterThan(0);
      if (kind === 'replays') expect(response.body.count).toBeGreaterThan(0);
    });
  test('journey aggregates and selected path sessions agree', async ({ admin, seed }) => {
    const path = `/api/liekan/websites/${seed.website.id}/journeys`;
    const response = await admin.get(path, {
      params: { ...dateRange(seed), timezone: 'UTC', steps: 3, type: 'all' },
    });
    if (seed.db === 'clickhouse') {
      expect(response.status).toBe(501);
      return;
    }
    expect(response.status, response.text).toBe(200);
    expect(journeyResponse.safeParse(response.body).success).toBe(true);
    expect(response.body.rows.length).toBeGreaterThan(0);
    const row = response.body.rows[0];
    const details = await admin.get(path + '/details', {
      params: {
        ...dateRange(seed),
        timezone: 'UTC',
        steps: 3,
        type: 'all',
        sequence: JSON.stringify(row.nodes),
      },
    });
    expect(details.status, details.text).toBe(200);
    expect(journeyResponse.safeParse(details.body).success).toBe(true);
    expect(details.body.count).toBe(row.visitors);
    expect(details.body.sessions.length).toBeGreaterThan(0);
  });
  test('saved goal real conversion series and native units remain compatible', async ({
    admin,
    seed,
  }) => {
    const goal = await admin.post(`/api/websites/${seed.website.id}/goals`, {
      name: uniqueName('预约验收'),
      parameters: { type: 'event', value: seed.data.eventNames[0] },
    });
    expect(goal.status, goal.text).toBe(200);
    try {
      const result = await admin.get(
        `/api/liekan/websites/${seed.website.id}/goals/${goal.body.id}/analytics`,
        { params: { ...dateRange(seed), timezone: 'UTC' } },
      );
      if (seed.db === 'clickhouse') expect(result.status).toBe(501);
      else {
        expect(result.status, result.text).toBe(200);
        expect(goalAnalyticsResponse.safeParse(result.body).success).toBe(true);
        expect(result.body.conversions).toBeGreaterThan(0);
      }
      const native = await admin.get(
        `/api/websites/${seed.website.id}/goals/${goal.body.id}/stats`,
        { params: { ...dateRange(seed), timezone: 'UTC', unit: 'minute' } },
      );
      expect(native.status, native.text).toBe(200);
      expect(native.body.num).toBeGreaterThan(0);
      if (seed.db === 'postgres')
        expect(native.body.conversions).toBeGreaterThanOrEqual(native.body.num);
    } finally {
      await admin.del(`/api/reports/${goal.body.id}`);
    }
  });
  test('joint link source and country counts sum to actual clicks', async ({ admin, seed }) => {
    const result = await admin.get(`/api/liekan/links/${seed.link.id}/sources`, {
      params: dateRange(seed),
    });
    expect(result.status, result.text).toBe(200);
    expect(resourceSourcesResponse.safeParse(result.body).success).toBe(true);
    const stats = await admin.get(`/api/websites/${seed.link.id}/stats`, {
      params: dateRange(seed),
    });
    expect(stats.status).toBe(200);
    expect(result.body.rows.reduce((sum: number, row: any) => sum + row.clicks, 0)).toBe(
      Number(stats.body.pageviews),
    );
  });
  test('complete ZIP contains real rows and masks visitor identifiers', async ({ admin, seed }) => {
    const result = await admin.post(`/api/liekan/websites/${seed.website.id}/exports`, {
      ...dateRange(seed),
      timezone: 'UTC',
      format: 'zip',
      sections: ['summary', 'dimensions', 'events', 'sessions', 'config'],
      filters: {},
    });
    if (seed.db === 'clickhouse') {
      expect(result.status).toBe(501);
      return;
    }
    expect(result.status, result.text.slice(0, 300)).toBe(200);
    expect(result.headers['content-type']).toContain('ndjson');
    const frames = result.text
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    expect(frames.at(-1)).toMatchObject({ type: 'complete' });
    expect(frames.some(frame => frame.type === 'error')).toBe(false);
    const bytes = Buffer.concat(
      frames
        .filter(frame => frame.type === 'chunk')
        .map(frame => Buffer.from(frame.data, 'base64')),
    );
    const zip = await JSZip.loadAsync(bytes);
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest.files.length).toBeGreaterThan(5);
    const sessions = await zip.file('sessions.csv')!.async('string');
    expect(sessions).toContain('visitor-');
    expect(sessions).not.toContain(seed.data.sessionId);
    const events = await zip.file('events.csv')!.async('string');
    expect(events).toContain(seed.data.eventNames[0]);
  });
  test('new endpoints reject anonymous, unrelated owner and public share credentials', async ({
    api,
    user,
    share,
    seed,
  }) => {
    const publicClient = await share();
    for (const [client, status] of [
      [api, 401],
      [user, 403],
      [publicClient, 401],
    ] as const) {
      const response = await client.get(`/api/liekan/websites/${seed.website.id}/analytics`, {
        params: { ...dateRange(seed), kind: 'sessions' },
      });
      expect(response.status).toBe(status);
    }
  });
  test('protected shares hide secrets, verify proof and revoke live access', async ({
    admin,
    api,
    seed,
  }) => {
    const slug = uniqueSlug('proof');
    const created = await admin.post('/api/share', {
      name: uniqueName('protected'),
      slug,
      entityId: seed.website.id,
      shareType: ENTITY_TYPE.website,
      parameters: { overview: true, password: 'verify-fixture' },
    });
    expect(created.status, created.text).toBe(200);
    try {
      expect(JSON.stringify(created.body)).not.toContain('verify-fixture');
      expect(JSON.stringify(created.body)).not.toContain('passwordHash');
      const challenge = await api.get(`/api/share/${slug}`);
      expect(challenge.body).toMatchObject({ requiresPassword: true });
      expect(challenge.body.token).toBeUndefined();
      const wrong = await api.post(`/api/share/${slug}`, { password: 'incorrect' });
      expect(wrong.status).toBe(401);
      const valid = await api.post(`/api/share/${slug}`, { password: 'verify-fixture' });
      expect(valid.status, valid.text).toBe(200);
      const publicClient = api.with({
        [SHARE_TOKEN_HEADER]: valid.body.token,
        [SHARE_CONTEXT_HEADER]: '1',
      });
      const before = await publicClient.get(`/api/websites/${seed.website.id}/stats`, {
        params: dateRange(seed),
      });
      expect(before.status).toBe(200);
      const changed = await admin.post(`/api/share/id/${created.body.id}`, {
        name: created.body.name,
        slug,
        parameters: { overview: true, password: 'rotated-fixture' },
      });
      expect(changed.status, changed.text).toBe(200);
      const stale = await publicClient.get(`/api/websites/${seed.website.id}/stats`, {
        params: dateRange(seed),
      });
      expect(stale.status).toBe(401);
      const fresh = await api.post(`/api/share/${slug}`, { password: 'rotated-fixture' });
      expect(fresh.status).toBe(200);
      const disabled = await admin.post(`/api/share/id/${created.body.id}`, {
        name: created.body.name,
        slug,
        parameters: { overview: true, enabled: false },
      });
      expect(disabled.status).toBe(200);
      const unavailable = await api.get(`/api/share/${slug}`);
      expect(unavailable.status).toBe(404);
      const revoked = await api
        .with({ [SHARE_TOKEN_HEADER]: fresh.body.token, [SHARE_CONTEXT_HEADER]: '1' })
        .get(`/api/websites/${seed.website.id}/stats`, { params: dateRange(seed) });
      expect(revoked.status).toBe(401);
    } finally {
      await admin.del(`/api/share/id/${created.body.id}`);
    }
  });
});
