// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bundledVerificationSnapshots, type VerificationSnapshots } from '../rules/verify';
import { getIpAddress } from '@/lib/ip';
import {
  COLLECTION_RULE_VERSION,
  classifyCollection,
  normalizeCollectionHostname,
} from './collection-quality';

const now = new Date('2026-10-13T12:00:00Z');

it('uses the actual shared quoted Forwarded parser before official range classification', () => {
  vi.stubEnv('CLIENT_IP_HEADER', 'forwarded');
  for (const [value, prefix] of [
    ['for="192.0.2.1:443";proto=https', '192.0.2.0/24'],
    ['for="[2001:db8::1]:443";proto=https', '2001:db8::/32'],
  ]) {
    const request = new Request('https://collector.test/api/send', {
      headers: { forwarded: value, 'user-agent': browser },
    });
    const quality = classifyCollection(
      input({
        request,
        ip: getIpAddress(request.headers),
        snapshots: ranges({ prefixes: [prefix] }),
      }),
    );
    expect(quality.classification).toBe('automated');
    expect(quality.rangeStatus).toBe('fresh');
  }
});
const browser =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const ranges = (changes: Record<string, unknown> = {}): VerificationSnapshots => ({
  GPTBot: {
    prefixes: ['192.0.2.0/24'],
    retrievedAt: now.toISOString(),
    version: 'fixture-v1',
    ...changes,
  },
});
const input = (changes: Partial<Parameters<typeof classifyCollection>[0]> = {}) => ({
  request: new Request('https://collector.test/api/send', {
    headers: { 'user-agent': browser, 'x-forwarded-for': '192.0.2.1' },
  }),
  payload: { url: 'https://WWW.Example.com:443/a?private=value' },
  authenticated: false,
  ip: '192.0.2.1',
  userAgent: browser,
  snapshots: ranges(),
  now,
  ...changes,
});
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.stubEnv('CLIENT_IP_HEADER', '');
  vi.stubEnv('CLOUD_MODE', '');
  vi.stubEnv('DISABLE_BOT_CHECK', '');
});

describe('collection quality evidence', () => {
  it('describes browser-compatible requests without persisting IP, UA or URL', () => {
    vi.stubEnv('CLIENT_IP_HEADER', '');
    vi.stubEnv('CLOUD_MODE', '');
    const quality = classifyCollection(input());
    expect(quality).toEqual({
      classification: 'browser',
      source: 'browser',
      reasons: ['browser_compatible'],
      ruleVersion: COLLECTION_RULE_VERSION,
      rangeVersion: null,
      rangeStatus: 'untrusted',
      hostname: 'example.com',
    });
    expect(JSON.stringify(quality)).not.toContain('192.0.2.1');
    expect(JSON.stringify(quality)).not.toContain(browser);
    expect(JSON.stringify(quality)).not.toContain('private=value');
  });

  it('identifies bot UAs without requiring trusted IP evidence', () => {
    expect(classifyCollection(input({ userAgent: 'GPTBot/1.0' }))).toMatchObject({
      classification: 'automated',
      reasons: ['ua_bot'],
    });
  });

  it.each(['userAgent', 'ip', 'browser', 'os', 'device'])(
    'treats public %s overrides as legacy evidence',
    field => {
      const quality = classifyCollection(input({ payload: { [field]: browser } }));
      expect(quality.source).toBe('legacy_override');
      expect(quality.classification).toBe('suspected');
      expect(quality.reasons).toContain('legacy_payload_override');
    },
  );

  it('uses authenticated server IP overrides as trusted evidence', () => {
    const quality = classifyCollection(
      input({ authenticated: true, payload: { ip: '192.0.2.1', browser: 'chrome' } }),
    );
    expect(quality).toMatchObject({
      classification: 'automated',
      source: 'authenticated_server',
      rangeStatus: 'fresh',
      reasons: ['official_range_match'],
    });
  });

  it('matches fresh official CIDRs even with a normal browser UA', () => {
    vi.stubEnv('CLIENT_IP_HEADER', 'x-forwarded-for');
    const quality = classifyCollection(input());
    expect(quality.classification).toBe('automated');
    expect(quality.rangeStatus).toBe('fresh');
    expect(quality.rangeVersion).toBe(
      createHash('sha256')
        .update(JSON.stringify(['fixture-v1']))
        .digest('hex'),
    );
  });

  it('accepts IPv4-mapped addresses from the configured trusted header', () => {
    vi.stubEnv('CLIENT_IP_HEADER', 'x-client-ip');
    const request = new Request('https://collector.test', {
      headers: { 'x-client-ip': '::ffff:192.0.2.1' },
    });
    expect(classifyCollection(input({ request })).classification).toBe('automated');
  });

  it('accepts the dedicated cloud-mode client header', () => {
    vi.stubEnv('CLIENT_IP_HEADER', '');
    vi.stubEnv('CLOUD_MODE', '1');
    const request = new Request('https://collector.test', {
      headers: { 'x-umami-client-ip': '192.0.2.1' },
    });
    expect(classifyCollection(input({ request })).classification).toBe('automated');
  });

  it.each([
    { headers: { 'cf-connecting-ip': '192.0.2.1' }, payload: {} },
    { headers: { 'x-forwarded-for': '192.0.2.2' }, payload: {} },
    { headers: { 'cf-connecting-ip': '192.0.2.1' }, payload: { ip: '192.0.2.1' } },
  ])('never promotes fallback headers or payload IP to trusted ranges: %j', fixture => {
    vi.stubEnv('CLIENT_IP_HEADER', 'x-forwarded-for');
    const quality = classifyCollection(
      input({ request: new Request('https://collector.test', fixture), payload: fixture.payload }),
    );
    expect(quality.classification).not.toBe('automated');
    expect(quality.rangeStatus).toBe('untrusted');
    expect(quality.rangeVersion).toBeNull();
  });

  it.each([
    { snapshots: {}, status: 'missing' },
    { snapshots: ranges({ retrievedAt: '2026-10-06T11:59:59Z' }), status: 'stale' },
    { snapshots: ranges({ retrievedAt: '2026-10-14T12:00:00Z' }), status: 'invalid' },
    { snapshots: ranges({ retrievedAt: 'invalid' }), status: 'invalid' },
    { snapshots: ranges({ prefixes: ['invalid'] }), status: 'invalid' },
    { snapshots: ranges({ prefixes: [] }), status: 'invalid' },
    { snapshots: { GPTBot: null }, status: 'invalid' },
    { snapshots: { GPTBot: 'malformed' } as unknown as VerificationSnapshots, status: 'invalid' },
  ])('keeps $status snapshots from hard exclusion', fixture => {
    vi.stubEnv('CLIENT_IP_HEADER', 'x-forwarded-for');
    const quality = classifyCollection(input({ snapshots: fixture.snapshots }));
    expect(quality.classification).toBe('browser');
    expect(quality.rangeStatus).toBe(fixture.status);
  });

  it('uses the seven-day freshness boundary exactly', () => {
    vi.stubEnv('CLIENT_IP_HEADER', 'x-forwarded-for');
    expect(
      classifyCollection(input({ snapshots: ranges({ retrievedAt: '2026-10-06T12:00:00Z' }) }))
        .classification,
    ).toBe('automated');
  });

  it('keeps historic imports outside the snapshot observation period from hard exclusion', () => {
    vi.stubEnv('CLIENT_IP_HEADER', 'x-forwarded-for');
    const quality = classifyCollection(
      input({ payload: { timestamp: +new Date('2026-09-01T12:00:00Z') / 1000 } }),
    );
    expect(quality).toMatchObject({ classification: 'browser', rangeStatus: 'stale' });
    expect(classifyCollection(input({ payload: { timestamp: +now / 1000 } })).classification).toBe(
      'automated',
    );
  });

  it('keeps invalid event time from trusted range classification', () => {
    vi.stubEnv('CLIENT_IP_HEADER', 'x-forwarded-for');
    expect(classifyCollection(input({ payload: { timestamp: Infinity } }))).toMatchObject({
      classification: 'browser',
      rangeStatus: 'invalid',
    });
  });

  it.each([
    { UnreviewedBot: ranges().GPTBot },
    { toString: ranges().GPTBot },
    ranges({ source: 'https://unreviewed.test/ranges' }),
  ])('does not trust unreviewed range sources: %j', snapshots => {
    vi.stubEnv('CLIENT_IP_HEADER', 'x-forwarded-for');
    const quality = classifyCollection(input({ snapshots }));
    expect(quality.classification).toBe('browser');
    expect(quality.rangeStatus).toBe('untrusted');
  });

  it('keeps independent valid range evidence when another snapshot is malformed', () => {
    vi.stubEnv('CLIENT_IP_HEADER', 'x-forwarded-for');
    const quality = classifyCollection(
      input({
        snapshots: { ...ranges(), 'OAI-SearchBot': ranges({ prefixes: ['invalid'] }).GPTBot },
      }),
    );
    expect(quality).toMatchObject({ classification: 'automated', rangeStatus: 'fresh' });
  });

  it('hashes sorted matching versions and does not name an overlapping provider', () => {
    vi.stubEnv('CLIENT_IP_HEADER', 'x-forwarded-for');
    const snapshots = { ...ranges(), 'OAI-SearchBot': ranges({ version: 'fixture-v2' }).GPTBot };
    const quality = classifyCollection(input({ snapshots }));
    const reordered = classifyCollection(
      input({ snapshots: Object.fromEntries(Object.entries(snapshots).reverse()) }),
    );
    expect(quality).toEqual(reordered);
    expect(quality.reasons).toContain('official_range_ambiguous');
    expect(quality.rangeVersion).toBe(
      createHash('sha256')
        .update(JSON.stringify(['fixture-v1', 'fixture-v2']))
        .digest('hex'),
    );
    expect(JSON.stringify(quality)).not.toContain('GPTBot');
    expect(JSON.stringify(quality)).not.toContain('OAI-SearchBot');
  });

  it.each([false, true])('preserves disabled bot filtering, trusted range = %s', trusted => {
    vi.stubEnv('DISABLE_BOT_CHECK', '1');
    vi.stubEnv('CLIENT_IP_HEADER', trusted ? 'x-forwarded-for' : '');
    const quality = classifyCollection(input({ userAgent: trusted ? browser : 'GPTBot/1.0' }));
    expect(quality.classification).toBe('unknown');
    expect(quality.reasons).toContain('bot_check_disabled');
    if (trusted) expect(quality.rangeStatus).toBe('fresh');
  });

  it('keeps unrecognized UA input unknown', () => {
    expect(classifyCollection(input({ userAgent: '' })).classification).toBe('unknown');
  });
});

describe('collection hostname normalization', () => {
  it.each([
    ['https://WWW.Example.COM:8443/path?private=value', 'example.com'],
    [' www.Example.com:3000 ', 'example.com'],
    ['EXAMPLE.COM.', 'example.com'],
    ['https://例子.测试/path', 'xn--fsqu00a.xn--0zwm56d'],
    ['localhost:3000', 'localhost'],
    ['https://[2001:db8::1]:3000/path', '[2001:db8::1]'],
    ['//WWW.Example.com:8443/path', 'example.com'],
    ['/home', null],
    ['/home/nested', null],
    ['https:///home', null],
    ['', null],
    ['bad host.example', null],
    ['javascript:alert(1)', null],
    [null, null],
  ])('normalizes %j to %j', (value, expected) => {
    expect(normalizeCollectionHostname(value)).toBe(expected);
  });

  it.each(['https://example.com/path', '//example.com/path'])(
    'uses URL authority %j before the separate hostname claim',
    url => {
      expect(classifyCollection(input({ payload: { url, hostname: 'other.test' } })).hostname).toBe(
        'example.com',
      );
    },
  );

  it.each(['/home', '/home/nested', 'home', 'home/nested', './home', '?path=home'])(
    'uses tracker hostname for relative URL %j',
    url => {
      expect(
        classifyCollection(input({ payload: { url, hostname: 'WWW.Example.com:3000' } })).hostname,
      ).toBe('example.com');
    },
  );

  it.each(['/home', '/home/nested', 'home', 'home/nested'])(
    'keeps relative URL %j without a hostname claim unknown',
    url => {
      expect(classifyCollection(input({ payload: { url } })).hostname).toBeNull();
    },
  );
});

it('configured ingress supplies independent range evidence when a public override is present', () => {
  vi.stubEnv('CLIENT_IP_HEADER', 'x-forwarded-for');
  const request = new Request('https://collector.test', {
    headers: { 'x-forwarded-for': '192.0.2.1' },
  });
  const quality = classifyCollection(
    input({ request, payload: { ip: '8.8.8.8' }, ip: getIpAddress(request.headers) }),
  );
  expect(quality.classification).toBe('automated');
  expect(quality.rangeStatus).toBe('fresh');
  const fallback = new Request('https://collector.test', {
    headers: { 'cf-connecting-ip': '192.0.2.1' },
  });
  expect(
    classifyCollection(input({ request: fallback, payload: { ip: '192.0.2.1' } })).rangeStatus,
  ).toBe('untrusted');
});

it('keeps crawler-only feeds outside the browser trust policy and its health diagnostics', () => {
  const current = new Date('2026-10-15T02:00:00Z');
  const original = Object.fromEntries(
    Object.entries(bundledVerificationSnapshots).filter(([name]) =>
      [
        'GPTBot',
        'OAI-SearchBot',
        'ChatGPT-User',
        'PerplexityBot',
        'Perplexity-User',
        'Googlebot',
      ].includes(name),
    ),
  );
  const selected = input({ authenticated: true, ip: '8.8.8.8', now: current, snapshots: original });
  const result = classifyCollection(selected);
  expect(result.rangeStatus).toBe('fresh');
  expect(classifyCollection({ ...selected, snapshots: bundledVerificationSnapshots })).toEqual(
    result,
  );
  expect(
    classifyCollection({
      ...selected,
      snapshots: { ClaudeBot: bundledVerificationSnapshots.ClaudeBot },
    }),
  ).toMatchObject({ classification: 'browser', rangeStatus: 'missing' });
});
