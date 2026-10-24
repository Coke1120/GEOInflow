// @vitest-environment node
import { createHash } from 'node:crypto';
import { isbot } from 'isbot';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VerificationSnapshots } from '../rules/verify';
import { getIpAddress } from '@/lib/ip';
import { ALL_BOT_RULES } from '../rules/bots';
import { getBundledPublishedCatalog } from '../crawlers/catalog-seed';
import { installPublishedCatalogResolver } from '../crawlers/published';
import { rangeSources } from '../crawlers/range-sources';
const authority = vi.hoisted(() => vi.fn(() => true));
vi.mock('./crawler-registry-context', () => ({ collectionRegistryIsCurrent: authority }));
import {
  COLLECTION_RULE_VERSION,
  classifyCollection,
  collectionSource,
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
    source: 'https://openai.com/gptbot.json',
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
afterEach(() => {
  vi.unstubAllEnvs();
  installPublishedCatalogResolver(() => undefined);
});
beforeEach(() => {
  authority.mockReturnValue(true);
  vi.stubEnv('CLIENT_IP_HEADER', '');
  vi.stubEnv('CLOUD_MODE', '');
  vi.stubEnv('DISABLE_BOT_CHECK', '');
});

describe('collection quality evidence', () => {
  it('excludes the observed unregistered YisouSpider without needing an official crawler identity', () => {
    expect(classifyCollection(input({ userAgent: 'YisouSpider' }))).toMatchObject({
      classification: 'automated',
      reasons: ['ua_bot'],
    });
    const request = new Request('https://collector.test/api/send', {
      headers: { 'user-agent': 'YisouSpider' },
    });
    expect(classifyCollection(input({ request, payload: { userAgent: browser } }))).toMatchObject({
      classification: 'automated',
      reasons: ['request_ua_bot'],
    });
  });

  it.each(ALL_BOT_RULES.map(rule => [rule.name, rule.pattern]))(
    'excludes the registered %s crawler when it also advertises Chrome',
    (_name, token) => {
      const ua = `${browser} ${token}/1.0`;
      expect(classifyCollection(input({ userAgent: ua })).classification).toBe('automated');
      const request = new Request('https://collector.test/api/send', {
        headers: { 'user-agent': ua },
      });
      expect(
        classifyCollection(input({ request, payload: { userAgent: browser } })).classification,
      ).toBe('automated');
    },
  );

  it.each([browser, `${browser} NotClaude-User/1.0`, `${browser} Claude-User-Unofficial/1.0`])(
    'retains ordinary browsers and non-token crawler mentions: %s',
    ua => {
      expect(classifyCollection(input({ userAgent: ua })).classification).toBe('browser');
    },
  );

  it('keeps named-crawler transport separate for authorized server collection', () => {
    const request = new Request('https://collector.test/api/liekan/collect', {
      headers: { 'user-agent': `${browser} Claude-User/1.0` },
    });
    expect(
      classifyCollection(input({ request, authenticated: true, snapshots: {} })).classification,
    ).toBe('browser');
  });

  it('preserves automation evidence from conflicting tokens when checks are disabled', () => {
    const userAgent = `${browser} Claude-User/1.0 ChatGPT-User/1.0`;
    expect(classifyCollection(input({ userAgent }))).toMatchObject({
      classification: 'automated',
      reasons: ['crawler_ua_token'],
    });
    vi.stubEnv('DISABLE_BOT_CHECK', '1');
    expect(classifyCollection(input({ userAgent }))).toMatchObject({
      classification: 'automated',
      reasons: ['crawler_ua_token'],
    });
  });
  it('excludes an automation-controlled browser even when its UA is ordinary Chrome', () => {
    expect(classifyCollection(input({ payload: { webdriver: true } }))).toMatchObject({
      classification: 'automated',
      reasons: ['browser_webdriver'],
    });
  });

  it('retains public request bot evidence when the payload declares a browser UA', () => {
    const request = new Request('https://collector.test/api/send', {
      headers: { 'user-agent': 'python-requests/2.31.0' },
    });
    expect(classifyCollection(input({ request, payload: { userAgent: browser } }))).toMatchObject({
      classification: 'automated',
      reasons: ['request_ua_bot'],
    });
  });

  it('keeps an authenticated collector transport UA separate from its visitor UA', () => {
    const request = new Request('https://collector.test/api/liekan/collect', {
      headers: { 'user-agent': 'python-requests/2.31.0' },
    });
    expect(
      classifyCollection(input({ request, authenticated: true, snapshots: {} })),
    ).toMatchObject({ classification: 'browser', source: 'authenticated_server' });
  });

  it.each([false, undefined, 'true', 1])(
    'does not infer automation from webdriver=%j',
    webdriver => {
      expect(classifyCollection(input({ payload: { webdriver } })).classification).toBe('browser');
    },
  );

  it('preserves webdriver evidence when bot checks are disabled', () => {
    vi.stubEnv('DISABLE_BOT_CHECK', '1');
    expect(classifyCollection(input({ payload: { webdriver: true } }))).toMatchObject({
      classification: 'automated',
      reasons: ['browser_webdriver'],
    });
  });

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

  it.each(['userAgent', 'ip', 'browser', 'os', 'device', 'timestamp'])(
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

  it('uses current receipt time for public historical timestamp overrides', () => {
    vi.stubEnv('CLIENT_IP_HEADER', 'x-forwarded-for');
    const quality = classifyCollection(
      input({ payload: { timestamp: +new Date('2026-09-01T12:00:00Z') / 1000 } }),
    );
    expect(quality).toMatchObject({
      classification: 'automated',
      source: 'legacy_override',
      rangeStatus: 'fresh',
    });
    expect(classifyCollection(input({ payload: { timestamp: +now / 1000 } })).classification).toBe(
      'automated',
    );
  });

  it('keeps invalid authenticated historic event time from trusted range classification', () => {
    vi.stubEnv('CLIENT_IP_HEADER', 'x-forwarded-for');
    expect(
      classifyCollection(input({ authenticated: true, payload: { timestamp: Infinity } })),
    ).toMatchObject({
      classification: 'browser',
      source: 'authenticated_server',
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
        snapshots: {
          ...ranges(),
          'OAI-SearchBot': ranges({
            prefixes: ['invalid'],
            source: 'https://openai.com/searchbot.json',
          }).GPTBot,
        },
      }),
    );
    expect(quality).toMatchObject({ classification: 'automated', rangeStatus: 'fresh' });
  });

  it('hashes sorted matching versions and does not name an overlapping provider', () => {
    vi.stubEnv('CLIENT_IP_HEADER', 'x-forwarded-for');
    const snapshots = {
      ...ranges(),
      'OAI-SearchBot': ranges({
        version: 'fixture-v2',
        source: 'https://openai.com/searchbot.json',
      }).GPTBot,
    };
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

  it.each([false, true])(
    'preserves strong evidence with disabled checks, trusted range = %s',
    trusted => {
      vi.stubEnv('DISABLE_BOT_CHECK', '1');
      vi.stubEnv('CLIENT_IP_HEADER', trusted ? 'x-forwarded-for' : '');
      const quality = classifyCollection(input({ userAgent: trusted ? browser : 'GPTBot/1.0' }));
      expect(quality.classification).toBe('automated');
      expect(quality.reasons).toContain(trusted ? 'official_range_match' : 'ua_bot');
      if (trusted) expect(quality.rangeStatus).toBe('fresh');
    },
  );

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

describe('published browser range bindings', () => {
  it.each(rangeSources.flatMap(source => source.names))(
    'excludes a normal browser within the reviewed %s feed',
    name => {
      vi.stubEnv('CLIENT_IP_HEADER', 'x-forwarded-for');
      const source = rangeSources.find(source => source.names.includes(name))!;
      expect(
        classifyCollection(
          input({
            snapshots: { [name]: { ...ranges().GPTBot, source: source.url } },
          }),
        ),
      ).toMatchObject({ classification: 'automated', rangeStatus: 'fresh' });
    },
  );

  it('uses a newly published dedicated source and ignores revoked approval', () => {
    vi.stubEnv('CLIENT_IP_HEADER', 'x-forwarded-for');
    const catalog = structuredClone(getBundledPublishedCatalog());
    const source = catalog.payload.rangeSources.find(source => source.id === 'kimi-bot')!;
    source.url = 'https://www.kimi.ai/policies/reviewed-v2.json';
    Object.assign(source, { browserExclusion: 'dedicated_crawler' });
    installPublishedCatalogResolver(() => catalog);
    const snapshots = { KimiBot: { ...ranges().GPTBot, source: source.url } };
    expect(classifyCollection(input({ snapshots })).classification).toBe('automated');
    Object.assign(source, { browserExclusion: 'unsupported' });
    expect(classifyCollection(input({ snapshots })).classification).toBe('browser');
  });

  it('does not treat AI referrers, short visits or missing tracker metadata as automation', () => {
    for (const payload of [
      {},
      { referrer: 'https://kimi.com/chat/1' },
      { duration: 0 },
      { webdriver: false },
    ]) {
      expect(classifyCollection(input({ payload, snapshots: {} })).classification).toBe('browser');
    }
  });
});

it('uses the original timestamp declaration only to label legacy input', () => {
  expect(collectionSource({}, false)).toBe('browser');
  expect(collectionSource({ timestamp: 0 }, false)).toBe('legacy_override');
  expect(collectionSource({ timestamp: 0 }, true)).toBe('authenticated_server');
});

it('uses independent receivedAt for ordinary browser ranges and preserves historic server event time', () => {
  vi.stubEnv('CLIENT_IP_HEADER', 'x-forwarded-for');
  const receivedAt = now;
  expect(classifyCollection(input({ receivedAt, now: new Date('2000-01-01') }))).toMatchObject({
    classification: 'automated',
    source: 'browser',
    rangeStatus: 'fresh',
  });
  expect(
    classifyCollection(
      input({
        authenticated: true,
        receivedAt,
        payload: { timestamp: +new Date('2020-01-01') / 1000 },
      }),
    ),
  ).toMatchObject({
    classification: 'browser',
    source: 'authenticated_server',
    rangeStatus: 'stale',
  });
});

it('keeps strong automation evidence when a legacy event time is stale', () => {
  expect(
    classifyCollection(
      input({
        userAgent: 'YisouSpider',
        payload: { timestamp: 0 },
      }),
    ),
  ).toMatchObject({ classification: 'automated', source: 'legacy_override' });
});

it('requires current authority for registered tokens while retaining independent generic bot evidence', () => {
  vi.stubEnv('CLIENT_IP_HEADER', 'x-forwarded-for');
  const tokenUa = `${browser} Kimi-User/1.0`;
  expect(isbot(tokenUa)).toBe(false);
  expect(classifyCollection(input({ userAgent: tokenUa, snapshots: {} }))).toMatchObject({
    classification: 'automated',
    reasons: ['crawler_ua_token'],
  });
  const tokenRequest = new Request('https://collector.test/api/send', {
    headers: { 'user-agent': tokenUa },
  });
  expect(classifyCollection(input({ request: tokenRequest, snapshots: {} }))).toMatchObject({
    classification: 'automated',
    reasons: ['request_crawler_ua_token'],
  });
  authority.mockReturnValue(false);
  expect(classifyCollection(input())).toMatchObject({
    classification: 'browser',
    rangeStatus: 'untrusted',
  });
  expect(classifyCollection(input({ userAgent: tokenUa }))).toMatchObject({
    classification: 'browser',
    reasons: ['browser_compatible'],
  });
  expect(classifyCollection(input({ request: tokenRequest }))).toMatchObject({
    classification: 'browser',
    reasons: ['browser_compatible'],
  });
  expect(classifyCollection(input({ userAgent: 'YisouSpider' }))).toMatchObject({
    classification: 'automated',
    reasons: ['ua_bot'],
  });
  expect(
    classifyCollection(
      input({
        request: new Request('https://collector.test/api/send', {
          headers: { 'user-agent': 'YisouSpider' },
        }),
      }),
    ),
  ).toMatchObject({ classification: 'automated', reasons: ['request_ua_bot'] });
});

it.each([0, +new Date('2020-01-01') / 1000, +new Date('2030-01-01') / 1000])(
  'keeps public timestamp=%s separate from current CIDR evidence',
  timestamp => {
    vi.stubEnv('CLIENT_IP_HEADER', 'x-forwarded-for');
    const receivedAt = now;
    expect(classifyCollection(input({ receivedAt, payload: { timestamp } }))).toMatchObject({
      classification: 'automated',
      source: 'legacy_override',
      rangeStatus: 'fresh',
      reasons: ['official_range_match'],
    });
    expect(
      classifyCollection(
        input({
          receivedAt,
          payload: { timestamp },
          snapshots: ranges({
            retrievedAt: '2026-10-06T11:59:59Z',
          }),
        }),
      ),
    ).toMatchObject({
      classification: 'suspected',
      source: 'legacy_override',
      rangeStatus: 'stale',
    });
  },
);

it.each(['missing', 'unsupported', 'disabled', 'observed', 'robots', 'inactive'])(
  'denies browser range exclusion for %s authority',
  change => {
    vi.stubEnv('CLIENT_IP_HEADER', 'x-forwarded-for');
    const catalog = structuredClone(getBundledPublishedCatalog());
    const source = catalog.payload.rangeSources.find(source => source.id === 'openai-gpt')!;
    const identity = catalog.payload.identities.find(identity => identity.id === 'gptbot')!;
    if (change === 'missing') delete source.browserExclusion;
    if (change === 'unsupported') source.browserExclusion = 'unsupported';
    if (change === 'disabled') source.enabled = false;
    if (change === 'observed') identity.metadata.evidence = 'observed';
    if (change === 'robots') identity.kind = 'robots_purpose';
    if (change === 'inactive') identity.status = 'inactive';
    installPublishedCatalogResolver(() => catalog);
    expect(classifyCollection(input())).toMatchObject({
      classification: 'browser',
      rangeStatus: 'untrusted',
    });
  },
);

it('requires the current exact source URL for anonymous browser ranges', () => {
  vi.stubEnv('CLIENT_IP_HEADER', 'x-forwarded-for');
  const snapshot = { ...ranges().GPTBot };
  delete snapshot.source;
  expect(classifyCollection(input({ snapshots: { GPTBot: snapshot } }))).toMatchObject({
    classification: 'browser',
    rangeStatus: 'untrusted',
  });
  expect(
    classifyCollection(
      input({
        snapshots: {
          Googlebot: {
            ...ranges().GPTBot,
            source: 'https://developers.google.com/static/search/apis/ipranges/googlebot.json',
          },
        },
      }),
    ),
  ).toMatchObject({ classification: 'browser', rangeStatus: 'untrusted' });
});
