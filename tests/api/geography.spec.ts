import { expect, test } from './fixtures';
import { UNKNOWN_UUID } from './helpers/constants';
import { randomUUID } from 'node:crypto';

test('publishes geography provider credit without analytics or private configuration', async ({
  api,
}) => {
  const result = await api.get('/api/liekan/geography/attribution');
  expect(result.status).toBe(200);
  expect(Object.keys(result.body)).toEqual(['links']);
  expect(result.body.links.length).toBeGreaterThan(0);
  for (const link of result.body.links) {
    expect(Object.keys(link).sort()).toEqual(['href', 'label']);
    expect(link.label.length).toBeGreaterThan(0);
    expect([
      'https://db-ip.com',
      'https://www.maxmind.com',
      'https://github.com/lionsoul2014/ip2region',
      '/liekan/help?article=project-about',
    ]).toContain(link.href);
  }
});

test('collection persists the sanitized header city consistently without decoding it again', async ({
  admin,
  api,
  seed,
}) => {
  test.skip(seed.db === 'clickhouse', 'PostgreSQL event geography evidence');
  for (const [encoded, sanitized] of [
    ['223%252E5%252E5%252E5', '223%2E5%2E5%2E5'],
    ['2400%253A3200%253A%253A1', '2400%3A3200%3A%3A1'],
    ['Mozilla%252F5.0', 'Mozilla%2F5.0'],
  ]) {
    const created = await admin.post('/api/websites', {
      name: `Geography privacy fixture ${randomUUID()}`,
      domain: 'geography-fixture.example',
    });
    expect(created.status).toBe(200);
    const id = created.body.id;
    try {
      const sent = await api.post(
        '/api/send',
        {
          type: 'event',
          payload: { website: id, hostname: 'geography-fixture.example', url: '/fixture' },
        },
        {
          headers: {
            'x-real-ip': '223.6.6.6',
            'cf-ipcountry': 'CN',
            'cf-region-code': 'GD',
            'cf-ipcity': encoded,
          },
        },
      );
      expect(sent.status).toBe(200);
      expect(sent.body.sessionId).toBeTruthy();
      const session = await admin.get(`/api/websites/${id}/sessions/${sent.body.sessionId}`);
      expect(session.status).toBe(200);
      expect(session.body.country).toBe('CN');
      expect(session.body.city).toBe(sanitized);
      const diagnostics = await admin.get(`/api/liekan/websites/${id}/geography/diagnostics`);
      expect(diagnostics.status).toBe(200);
      expect(diagnostics.body.evidence).toEqual(
        expect.arrayContaining([expect.objectContaining({ source: 'ingress_header', events: 1 })]),
      );
    } finally {
      expect((await admin.del(`/api/websites/${id}`)).status).toBe(200);
    }
  }
});

test('scopes geography diagnostics and preserves the complete visit population', async ({
  admin,
  user,
  api,
  share,
  seed,
}) => {
  const path = `/api/liekan/websites/${seed.website.id}/geography/diagnostics`;
  const params = { ...seed.range, timezone: 'Asia/Shanghai' };
  expect((await api.get(path, { params })).status).toBe(401);
  expect((await (await share()).get(path, { params })).status).toBe(401);
  expect((await user.get(path, { params })).status).toBe(403);
  expect(
    (await admin.get(`/api/liekan/websites/${UNKNOWN_UUID}/geography/diagnostics`, { params }))
      .status,
  ).toBe(404);
  const result = await admin.get(path, { params });
  expect(result.status).toBe(200);
  if (seed.db === 'clickhouse') {
    expect(result.body.available).toBe(false);
    expect(result.body.reason).toBeTruthy();
    return;
  }
  expect(
    (await admin.get(path, { params: { ...params, timezone: 'invalid/timezone' } })).status,
  ).toBe(400);
  expect((await admin.get(path, { params: { ...params, endAt: params.startAt - 1 } })).status).toBe(
    400,
  );
  const native = await admin.get(`/api/websites/${seed.website.id}/stats`, { params });
  const report = await admin.get(`/api/liekan/websites/${seed.website.id}/report`, {
    params: { ...params, resource: 'human/geo' },
  });
  expect(native.status).toBe(200);
  expect(report.status).toBe(200);
  expect(result.body.available).toBe(true);
  expect(Object.keys(result.body).sort()).toEqual([
    'available',
    'configuration',
    'coverage',
    'evidence',
    'ingress',
    'range',
    'runtime',
    'versions',
  ]);
  const coverage = result.body.coverage;
  expect(coverage).toEqual(report.body.meta.geographyCoverage);
  expect(coverage.totalVisits).toBe(Number(native.body.visits));
  expect(coverage.cityKnownVisits + coverage.cityUnknownVisits).toBe(coverage.totalVisits);
  expect(coverage.cityCoverage).toBe(
    coverage.totalVisits
      ? Math.round((coverage.cityKnownVisits / coverage.totalVisits) * 10000) / 100
      : null,
  );
  expect(result.body.evidence.length).toBeGreaterThan(0);
  for (const evidence of result.body.evidence) {
    expect(Object.keys(evidence).sort()).toEqual([
      'dataVersion',
      'events',
      'ipFamily',
      'precision',
      'reason',
      'ruleVersion',
      'shadowPrecision',
      'shadowReason',
      'source',
      'trust',
    ]);
    expect(evidence.events).toBeGreaterThan(0);
  }
  expect(Object.keys(result.body.configuration).sort()).toEqual([
    'ignoreRuleCount',
    'invalidIgnoreRuleCount',
    'trustedIngressConfigured',
  ]);
  expect(result.body.runtime.chinaMode).toBe('shadow');
});
