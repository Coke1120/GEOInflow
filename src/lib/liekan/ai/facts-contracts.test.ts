import { describe, expect, it } from 'vitest';
import { normalizeAiRange, sanitizeAiFactsContext } from './facts-contracts';

const range = {
  startAt: '2026-10-01T00:00:00.000Z',
  endAt: '2026-10-07T23:59:59.999Z',
  timezone: 'Asia/Shanghai',
};
describe('AI effective range', () => {
  it('clamps future end and computes an immediately previous equal duration inclusive range', () => {
    expect(normalizeAiRange(range, new Date('2026-10-04T00:00:00.000Z'))).toMatchObject({
      currentRange: { startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-04T00:00:00.000Z' },
      previousRange: { startAt: '2026-09-27T23:59:59.999Z', endAt: '2026-09-30T23:59:59.999Z' },
      rangeNotes: { endClamped: true, originalEndAt: range.endAt, currentDayIncomplete: true },
    });
  });
  it('rejects future starts, reverse ranges, unknown timezones and more than 90 inclusive days', () => {
    const asOf = new Date('2026-10-04T00:00:00Z');
    for (const bad of [
      { ...range, startAt: '2026-10-05T00:00:00Z' },
      { ...range, endAt: '2026-09-30T00:00:00Z' },
      { ...range, timezone: 'Invalid/Area' },
      { ...range, startAt: '2026-01-01T00:00:00Z' },
    ])
      expect(() => normalizeAiRange(bad, asOf)).toThrow();
  });
});

it('projects nested outbound objects and sanitizes untrusted labels as well as paths', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const input = {
    protocolVersion: 1,
    id,
    website: {
      id,
      name: 'test-demo api_key=canaryKey alice@example.com 13800138000',
      domain: 'https://private.example.com/secret?canaryKey',
      rawUserAgent: 'canaryKey',
    },
    space: { kind: 'personal', id },
    websiteEpoch: id,
    currentRange: { startAt: range.startAt, endAt: '2026-10-03T23:59:59.999Z' },
    previousRange: { startAt: '2026-09-28T00:00:00.000Z', endAt: '2026-09-30T23:59:59.999Z' },
    timeZone: 'UTC',
    generatedAt: '2026-10-04T00:00:00.000Z',
    metricVersion: 'liekan-ai-facts-v1',
    catalogVersion: id,
    trafficPolicyVersion: 'traffic-quality-browser-source-v2',
    promptVersion: 'liekan-ai-prompt-v1',
    coverage: 'unverified',
    rangeNotes: { originalEndAt: range.endAt, endClamped: true, currentDayIncomplete: true },
    sourceStates: {
      human: 'not_connected',
      logs: 'available',
      catalog: 'not_connected',
      goals: 'not_connected',
      aiReferrals: 'not_connected',
    },
    businessProfile: { state: 'unconfigured', value: null },
    metrics: [],
    facts: [
      {
        id: 'pages',
        label: 'token=canaryKey',
        state: 'available',
        data: {
          total: 1,
          omitted: 0,
          truncated: false,
          scope:
            'browser paths and encoded imported AI request paths; union of current and previous periods ranked by current then previous counts; stored forms may differ; query and fragment excluded',
          rows: [
            {
              path: '/email/alice%2540example.com/ip/203.0.113.7/api_key/test-demo-secret?token=canaryKey',
              humanPageviews: null,
              previousHumanPageviews: null,
              aiRequests: 2,
              previousAiRequests: 0,
              sessionId: 'canaryKey',
            },
          ],
          cookies: 'canaryKey',
        },
      },
      {
        id: 'bots',
        label: 'test-demo',
        state: 'available',
        data: {
          total: 1,
          omitted: 0,
          truncated: false,
          requests: 2,
          previousRequests: 0,
          changePercent: null,
          scope: 'AI classes: 训练, 搜索, 用户触发; UA classification with verification states',
          rows: [
            {
              name: 'sk-canaryKey12345',
              vendor: 'email alice@example.com',
              class: '训练',
              verification: 'unverified',
              requests: 2,
              previousRequests: 0,
              changePercent: null,
              rawUA: 'canaryKey',
            },
          ],
        },
      },
      {
        id: 'goals',
        label: 'test-demo',
        state: 'available',
        data: {
          total: 1,
          omitted: 0,
          truncated: false,
          configured: 1,
          invalidDefinitions: 0,
          scope:
            'configured goal matching events; rates use converted browser visits divided by browser visits',
          rows: [
            {
              name: 'test-demo api_key=canaryKey goal /users/test-demo-alice /tokens/test-demo-secret',
              type: 'event',
              count: 2,
              previousCount: 0,
              convertedVisits: 1,
              previousConvertedVisits: 0,
              ratePercent: null,
              previousRatePercent: null,
              changePercent: null,
              conditions: 'canaryKey',
            },
          ],
        },
      },
    ],
    apiKey: 'canaryKey',
    ipMasked: '203.0.113.7',
    visitorUUID: 'canaryKey',
  };
  const safe = sanitizeAiFactsContext(input),
    serialized = JSON.stringify(safe);
  expect(safe.website.domain).toBeNull();
  expect(safe.catalogVersion).toBe(id);
  expect(safe.trafficPolicyVersion).toBe(input.trafficPolicyVersion);
  const { catalogVersion, trafficPolicyVersion, ...historical } = input;
  const legacy = sanitizeAiFactsContext(historical);
  expect(legacy).not.toHaveProperty('catalogVersion');
  expect(legacy).not.toHaveProperty('trafficPolicyVersion');
  for (const secret of [
    'canaryKey',
    'alice',
    '13800138000',
    '203.0.113.7',
    'rawUserAgent',
    'rawUA',
    'sessionId',
    'conditions',
    'cookies',
    'apiKey',
    'visitorUUID',
    'test-demo-secret',
    'test-demo-alice',
  ])
    expect(serialized).not.toContain(secret);
  expect(safe.facts.find(f => f.id === 'pages')?.data).toMatchObject({
    rows: [{ humanPageviews: null, aiRequests: 2 }],
  });
});
