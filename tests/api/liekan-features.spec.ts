import JSZip from 'jszip';
import {
  featureAnalyticsResponse,
  goalAnalyticsResponse,
  journeyResponse,
} from '../../src/lib/liekan/contracts/feature-responses';
import { resourceSourcesResponse } from '../../src/lib/liekan/contracts/resource-sources';
import { expect, test } from './fixtures';
import {
  CACHE_HEADER,
  ENTITY_TYPE,
  SHARE_CONTEXT_HEADER,
  SHARE_TOKEN_HEADER,
} from './helpers/constants';
import { dateRange } from './helpers/dates';
import { uniqueName, uniqueSlug } from './helpers/entities';

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
  test('journey terminal nodes stay within the selected steps and detail membership', async ({
    admin,
    api,
    seed,
  }) => {
    // Supplemental journey queries explicitly support PostgreSQL.
    if (seed.db === 'clickhouse') return;
    const created = await admin.post('/api/websites', {
      name: uniqueName('journey-boundary'),
      domain: 'journey-boundary.test',
    });
    expect(created.status).toBe(200);
    const websiteId = created.body.id;
    const timestamp = Math.floor(Date.now() / 1000) - 600;
    const common = {
      startAt: (timestamp - 1) * 1000,
      endAt: (timestamp + 100) * 1000,
      timezone: 'UTC',
      type: 'pages',
      startStep: '/a',
      endStep: '/d',
    };
    const sessions: string[] = [];
    try {
      for (const [index, urls] of [
        ['/a', '/b', '/c', '/d'],
        ['/a', '/b', '/d', '/c', '/d'],
        ['/loop', '/between', '/loop'],
      ].entries()) {
        let cache: string | undefined;
        for (const [step, url] of urls.entries()) {
          const response = await api.post(
            '/api/send',
            {
              type: 'event',
              payload: {
                website: websiteId,
                hostname: 'journey-boundary.test',
                url,
                timestamp: timestamp + step,
                id: `journey-boundary-${websiteId}-${index}`,
                ip: '127.0.0.1',
                userAgent:
                  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              },
            },
            { headers: cache ? { [CACHE_HEADER]: cache } : undefined },
          );
          expect(response.status).toBe(200);
          expect(response.body.cache).toBeTruthy();
          cache = response.body.cache;
          if (step === 0) sessions.push(response.body.sessionId);
        }
      }
      const path = `/api/liekan/websites/${websiteId}/journeys`;
      for (const [steps, expected] of [
        [2, []],
        [3, [['/a', '/b', '/d']]],
        [
          4,
          [
            ['/a', '/b', '/c', '/d'],
            ['/a', '/b', '/d'],
          ],
        ],
      ] as const) {
        const result = await admin.get(path, { params: { ...common, steps } });
        expect(result.status).toBe(200);
        expect(result.body.rows.map((row: any) => row.nodes).sort()).toEqual([...expected].sort());
        expect(result.body.visitors).toBe(expected.length);
        for (const row of result.body.rows) {
          expect(row.nodes.at(-1)).toBe(common.endStep);
          const detail = await admin.get(path + '/details', {
            params: { ...common, steps, sequence: JSON.stringify(row.nodes) },
          });
          expect(detail.status).toBe(200);
          expect(detail.body.rows).toEqual([row]);
          expect(detail.body.count).toBe(row.visitors);
          expect(detail.body.sessions.map((session: any) => session.id)).toEqual([
            row.nodes.length === 4 ? sessions[0] : sessions[1],
          ]);
        }
      }
      const loopParams = { ...common, steps: 3, startStep: '/loop', endStep: '/loop' };
      const loop = await admin.get(path, { params: loopParams });
      expect(loop.status).toBe(200);
      expect(loop.body.rows.map((row: any) => row.nodes)).toEqual([['/loop', '/between', '/loop']]);
      expect(loop.body.visitors).toBe(1);
      const loopDetail = await admin.get(path + '/details', {
        params: { ...loopParams, sequence: JSON.stringify(loop.body.rows[0].nodes) },
      });
      expect(loopDetail.status).toBe(200);
      expect(loopDetail.body.rows).toEqual(loop.body.rows);
      expect(loopDetail.body.count).toBe(1);
      expect(loopDetail.body.sessions.map((session: any) => session.id)).toEqual([sessions[2]]);
      for (const [startStep, sequence] of [
        ['/missing', ['/a', '/b', '/d']],
        ['/a', ['/a', '/b', '/c']],
      ] as const) {
        const detail = await admin.get(path + '/details', {
          params: { ...common, steps: 3, startStep, sequence: JSON.stringify(sequence) },
        });
        expect(detail.status).toBe(200);
        expect(detail.body.rows).toEqual([]);
        expect(detail.body.count).toBe(0);
        expect(detail.body.sessions).toEqual([]);
      }
    } finally {
      const removed = await admin.del(`/api/websites/${websiteId}`);
      expect(removed.status).toBe(200);
    }
  });
  test('performance bounce exclusion agrees across cards, chart, summary and dimensions', async ({
    admin,
    api,
    seed,
  }) => {
    if (seed.db === 'clickhouse') return;
    const created = await admin.post('/api/websites', {
      name: uniqueName('performance-bounce'),
      domain: 'performance-bounce.test',
    });
    expect(created.status).toBe(200);
    const websiteId = created.body.id;
    const timestamp = Math.floor(Date.now() / 86400000) * 86400 - 86400 + 3600;
    const common = {
      startAt: (timestamp - 1) * 1000,
      endAt: (timestamp + 100) * 1000,
      timezone: 'UTC',
      unit: 'day',
      metric: 'lcp',
    };
    try {
      for (const [index, pageviews] of [1, 2].entries()) {
        let cache: string | undefined;
        for (let step = 0; step <= pageviews; step++) {
          const response = await api.post(
            '/api/send',
            {
              type: step === pageviews ? 'performance' : 'event',
              payload: {
                website: websiteId,
                hostname: 'performance-bounce.test',
                url: '/a',
                timestamp: timestamp + step,
                id: `performance-bounce-${websiteId}-${index}`,
                ip: '127.0.0.1',
                userAgent:
                  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                ...(step === pageviews ? { lcp: index === 0 ? 10000 : 1000 } : {}),
              },
            },
            { headers: cache ? { [CACHE_HEADER]: cache } : undefined },
          );
          expect(response.status).toBe(200);
          expect(response.body.cache).toBeTruthy();
          cache = response.body.cache;
        }
      }
      for (const [excludeBounce, count, p75] of [
        [false, 2, 7750],
        [true, 1, 1000],
      ] as const) {
        const params = { ...common, ...(excludeBounce ? { excludeBounce: '1' } : {}) };
        const card = await admin.get(`/api/liekan/websites/${websiteId}/analytics`, {
          params: { ...params, kind: 'performance' },
        });
        const base = `/api/websites/${websiteId}/performance`;
        const chart = await admin.get(base + '/chart', { params });
        const stats = await admin.get(base + '/stats', { params });
        const metrics = await admin.get(base + '/metrics', { params: { ...params, type: 'path' } });
        for (const response of [card, chart, stats, metrics]) expect(response.status).toBe(200);
        expect(card.body.lcpCount).toBe(count);
        expect(Number(card.body.lcpP75)).toBe(p75);
        expect(stats.body.count).toBe(count);
        expect(Number(stats.body.lcp.p75)).toBe(p75);
        expect(chart.body.chart).toHaveLength(1);
        expect(Number(chart.body.chart[0].p75)).toBe(p75);
        expect(metrics.body).toHaveLength(1);
        expect(metrics.body[0].name).toBe('/a');
        expect(metrics.body[0].count).toBe(count);
        expect(Number(metrics.body[0].p75)).toBe(p75);
      }
    } finally {
      expect((await admin.del(`/api/websites/${websiteId}`)).status).toBe(200);
    }
  });
  test('revenue bounce exclusion agrees across transactions, summary, chart and dimensions', async ({
    admin,
    api,
    seed,
  }) => {
    if (seed.db === 'clickhouse') return;
    const created = await admin.post('/api/websites', {
      name: uniqueName('revenue-bounce'),
      domain: 'revenue-bounce.test',
    });
    expect(created.status).toBe(200);
    const websiteId = created.body.id;
    const timestamp = Math.floor(Date.now() / 86400000) * 86400 - 86400 + 3600;
    const common = {
      startAt: (timestamp - 1) * 1000,
      endAt: (timestamp + 100) * 1000,
      timezone: 'UTC',
      unit: 'day',
      currency: 'USD',
    };
    try {
      // The collector supports a server purchase without a preceding pageview.
      for (const [index, pageviews] of [0, 2].entries()) {
        let cache: string | undefined;
        for (let step = 0; step <= pageviews; step++) {
          const purchase = step === pageviews;
          const response = await api.post(
            '/api/send',
            {
              type: 'event',
              payload: {
                website: websiteId,
                hostname: 'revenue-bounce.test',
                url: '/a',
                timestamp: timestamp + step,
                id: `revenue-bounce-${websiteId}-${index}`,
                ip: '127.0.0.1',
                userAgent:
                  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                ...(purchase
                  ? { name: 'purchase', data: { revenue: index === 0 ? 10 : 100, currency: 'USD' } }
                  : {}),
              },
            },
            { headers: cache ? { [CACHE_HEADER]: cache } : undefined },
          );
          expect(response.status).toBe(200);
          expect(response.body.cache).toBeTruthy();
          cache = response.body.cache;
        }
      }
      for (const [excludeBounce, count, sum] of [
        [false, 2, 110],
        [true, 1, 100],
      ] as const) {
        const params = { ...common, ...(excludeBounce ? { excludeBounce: '1' } : {}) };
        const transactions = await admin.get(`/api/liekan/websites/${websiteId}/analytics`, {
          params: { ...params, kind: 'revenue' },
        });
        const base = `/api/websites/${websiteId}/revenue`;
        const chart = await admin.get(base + '/chart', { params });
        const stats = await admin.get(base + '/stats', { params });
        for (const response of [transactions, chart, stats]) expect(response.status).toBe(200);
        expect(transactions.body.count).toBe(count);
        expect(transactions.body.rows).toHaveLength(count);
        expect(
          transactions.body.rows.reduce((total: number, row: any) => total + Number(row.amount), 0),
        ).toBe(sum);
        expect(stats.body.count).toBe(count);
        expect(Number(stats.body.sum)).toBe(sum);
        expect(chart.body.chart).toHaveLength(1);
        expect(chart.body.chart[0].count).toBe(count);
        expect(Number(chart.body.chart[0].y)).toBe(sum);
        for (const type of ['country', 'region', 'referrer', 'channel']) {
          const metrics = await admin.get(base + '/metrics', { params: { ...params, type } });
          expect(metrics.status).toBe(200);
          expect(metrics.body.length).toBeGreaterThan(0);
          expect(
            metrics.body.reduce((total: number, row: any) => total + Number(row.value), 0),
          ).toBe(sum);
        }
      }
    } finally {
      expect((await admin.del(`/api/websites/${websiteId}`)).status).toBe(200);
    }
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
