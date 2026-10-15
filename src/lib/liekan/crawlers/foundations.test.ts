import { describe, expect, it } from 'vitest';
import {
  crawlerConfirmInputSchema,
  crawlerConnectionInputSchema,
  crawlerPathSchema,
  crawlerPolicyInputSchema,
  crawlerPolicyUpdateSchema,
  crawlerPreviewInputSchema,
} from '../contracts/crawlers';
import { BOT_RULES } from '../rules/bots';
import {
  crawlerDirectory,
  crawlerIdForName,
  crawlerIdForRule,
  crawlerPlatformReferrals,
  getCrawler,
} from './directory';
import {
  buildCloudflareExpression,
  crawlerPathMatches,
  crawlerRuleRef,
  exportNginxPolicy,
} from './templates';

const policy = {
  name: 'Public docs',
  botIds: ['gptbot' as const, 'oai-searchbot' as const],
  paths: [{ value: '/docs', match: 'prefix' as const }],
  action: 'block' as const,
  expectedAccess: 'allow' as const,
};
const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
];

describe('crawler directory and contracts', () => {
  it('maps every unchanged existing rule to one historical stable identity', () => {
    expect(new Set(BOT_RULES.map(crawlerIdForRule)).size).toBe(53);
    for (const rule of BOT_RULES) {
      expect(getCrawler(crawlerIdForRule(rule)).uaSelector).toBe(rule.pattern);
      expect(crawlerIdForName(rule.name)).toBe(crawlerIdForRule(rule));
    }
    expect(crawlerIdForRule({ name: 'GPTBot', pattern: 'custom' })).toBeNull();
    expect(crawlerIdForRule({ name: 'Custom', pattern: 'GPTBot' })).toBeNull();
    expect(crawlerIdForName('Other')).toBeNull();
  });

  it('keeps Google-Extended exclusively in the robots purpose directory', () => {
    expect(getCrawler('google-extended')).toMatchObject({
      kind: 'robots_purpose',
      uaSelector: null,
      identityEvidence: 'no_http_identity',
    });
    expect(
      crawlerPolicyInputSchema.safeParse({ ...policy, botIds: ['google-extended'] }).success,
    ).toBe(false);
    expect(() =>
      buildCloudflareExpression('example.com', { ...policy, botIds: ['google-extended'] } as never),
    ).toThrow();
  });

  it('shares one independent referral total across all OpenAI spider links', () => {
    const platforms = crawlerPlatformReferrals([
      { platformId: 'openai', state: 'available', visits: 12 },
    ]);
    expect(platforms.filter(value => value.platformId === 'openai')).toHaveLength(1);
    expect(platforms.reduce((total, value) => total + (value.visits || 0), 0)).toBe(12);
    expect(crawlerDirectory.filter(value => value.platformId === 'openai')).toHaveLength(4);
    expect(() =>
      crawlerPlatformReferrals([
        { platformId: 'openai', state: 'available', visits: 12 },
        { platformId: 'openai', state: 'available', visits: 12 },
      ]),
    ).toThrow();
    expect(platforms.find(value => value.platformId === 'apple')).toMatchObject({
      visits: null,
      state: 'missing',
    });
  });

  it.each([
    '/x" or true',
    "/x'",
    '/x\nDisallow:/',
    '/x\u0000',
    '/x\\y',
    '/x;y',
    '/x?token=a',
    '/x#fragment',
    '/x y',
    '/x%2',
  ])('rejects unsafe path %j', value => {
    expect(crawlerPathSchema.safeParse({ value, match: 'exact' }).success).toBe(false);
  });

  it('preserves literal URL punctuation and encoding without accepting expressions', () => {
    for (const value of ['/x+y', '/x(a)[b]$*', '/x%252F', '/Case/', '/你好', '/😀']) {
      expect(crawlerPathSchema.parse({ value, match: 'exact' }).value).toBe(value);
    }
    expect(crawlerPolicyInputSchema.safeParse({ ...policy, expression: 'true' }).success).toBe(
      false,
    );
    expect(crawlerPathSchema.safeParse({ value: '/x', match: 'regex' }).success).toBe(false);
  });

  it('bounds policy selection, names, versions and secrets with strict schemas', () => {
    expect(crawlerPolicyInputSchema.parse(policy)).toEqual(policy);
    expect(crawlerPolicyInputSchema.safeParse({ ...policy, name: 'x'.repeat(81) }).success).toBe(
      false,
    );
    expect(
      crawlerPolicyInputSchema.safeParse({ ...policy, botIds: Array(11).fill('gptbot') }).success,
    ).toBe(false);
    expect(
      crawlerPolicyInputSchema.safeParse({ ...policy, paths: Array(11).fill(policy.paths[0]) })
        .success,
    ).toBe(false);
    expect(
      crawlerPolicyInputSchema.safeParse({
        ...policy,
        paths: [{ value: `/${'x'.repeat(512)}`, match: 'exact' }],
      }).success,
    ).toBe(false);
    expect(
      crawlerPolicyInputSchema.safeParse({ ...policy, botIds: ['gptbot', 'gptbot'] }).success,
    ).toBe(false);
    expect(crawlerPolicyUpdateSchema.safeParse({ ...policy, version: 0 }).success).toBe(false);
    expect(crawlerPolicyUpdateSchema.parse({ ...policy, version: 1 }).version).toBe(1);
    expect(
      crawlerConnectionInputSchema.parse({ zoneId: 'a'.repeat(32), token: 'secret' }).token,
    ).toBe('secret');
    expect(
      crawlerConnectionInputSchema.safeParse({ zoneId: 'x'.repeat(32), token: 'secret' }).success,
    ).toBe(false);
    expect(
      crawlerConnectionInputSchema.safeParse({ zoneId: 'a'.repeat(32), token: 'x'.repeat(513) })
        .success,
    ).toBe(false);
    expect(
      crawlerConnectionInputSchema.safeParse({ zoneId: 'a'.repeat(32), token: 'secret\ncanary' })
        .success,
    ).toBe(false);
    expect(crawlerPreviewInputSchema.safeParse({ operation: 'rollback' }).success).toBe(false);
    expect(crawlerPreviewInputSchema.parse({ operation: 'rollback', targetVersion: 1 })).toEqual({
      operation: 'rollback',
      targetVersion: 1,
    });
    expect(
      crawlerConfirmInputSchema.safeParse({ operationId: ids[0], previewId: 'not-a-uuid' }).success,
    ).toBe(false);
  });
});

describe('fixed access templates', () => {
  it('matches segment boundaries without changing case, encoding, query, or trailing slash', () => {
    const prefix = { value: '/docs', match: 'prefix' as const };
    for (const path of ['/docs', '/docs/', '/docs/page'])
      expect(crawlerPathMatches(path, prefix)).toBe(true);
    for (const path of ['/docs-private', '/Docs', '/%64ocs', '/docs?x=1'])
      expect(crawlerPathMatches(path, prefix)).toBe(false);
    expect(crawlerPathMatches('/docs', { value: '/docs/', match: 'prefix' })).toBe(false);
    expect(crawlerPathMatches('/docs/', { value: '/docs', match: 'exact' })).toBe(false);
    expect(crawlerPathMatches('/x%2F', { value: '/x%252F', match: 'exact' })).toBe(false);
  });

  it('builds exact-host, fixed literal UA, raw-path Cloudflare predicates', () => {
    const expression = buildCloudflareExpression('EXAMPLE.com', policy);
    expect(expression).toBe(
      '(http.host eq "example.com") and (lower(http.user_agent) contains "gptbot" or lower(http.user_agent) contains "oai-searchbot") and ((raw.http.request.uri.path eq "/docs" or starts_with(raw.http.request.uri.path, "/docs/")))',
    );
    expect(expression).not.toContain('matches');
    expect(() => buildCloudflareExpression('example.com" or true', policy)).toThrow();
    expect(() =>
      buildCloudflareExpression('example.com', { ...policy, action: 'observe' }),
    ).toThrow('local');
    expect(() =>
      buildCloudflareExpression('example.com', {
        ...policy,
        paths: Array.from({ length: 10 }, (_, index) => ({
          value: `/${index}${'x'.repeat(490)}`,
          match: 'exact' as const,
        })),
      }),
    ).toThrow('2 KiB');
  });

  it('binds ownership to all UUIDs and never names or version numbers', () => {
    const ref = crawlerRuleRef(ids[0], ids[1], ids[2]);
    expect(ref).toMatch(/^lk_[a-f0-9]{60}$/);
    expect(crawlerRuleRef(ids[0].toUpperCase(), ids[1], ids[2])).toBe(ref);
    expect(crawlerRuleRef(ids[1], ids[0], ids[2])).not.toBe(ref);
    expect(() => crawlerRuleRef('name', ids[1], ids[2])).toThrow();
  });

  it('exports scoped Nginx fragments with escaped literal paths in valid contexts', () => {
    const result = exportNginxPolicy(
      'example.com',
      {
        ...policy,
        paths: [{ value: '/price+$[x]', match: 'prefix' }],
      },
      { rateLimit: { requestsPerSecond: 2, burst: 5, dryRun: true } },
    );
    expect(result.kind).toBe('configuration_fragments');
    expect(result.httpContext).toContain('map $http_user_agent');
    expect(result.httpContext).toContain('map $request_uri');
    expect(result.httpContext).toContain('example.com:1:1');
    expect(result.httpContext).toContain('\\\\+');
    expect(result.serverContext).toContain('return 403');
    expect(result.serverContext).not.toContain('map ');
    expect(result.rateLimit.httpContext).toContain('limit_req_zone');
    expect(result.rateLimit.serverContext).toContain('limit_req_dry_run on;');
    expect(result.rateLimit.serverContext).not.toContain('limit_req_zone');
    expect(result.httpContext).not.toContain('ip_hash');
  });

  it('keeps local observe exports passive and forbids active observe rate limits', () => {
    const observe = { ...policy, action: 'observe' as const };
    expect(exportNginxPolicy('example.com', observe).serverContext).not.toContain('return 403');
    expect(() =>
      exportNginxPolicy('example.com', observe, {
        rateLimit: { requestsPerSecond: 1, burst: 5, dryRun: false },
      }),
    ).toThrow();
  });

  it('preserves case for exact Nginx path matches through a fixed escaped regex', () => {
    const result = exportNginxPolicy('example.com', {
      ...policy,
      paths: [{ value: '/Docs+a', match: 'exact' }],
    });
    expect(result.httpContext).toContain('~^/Docs\\\\+a$');
    expect(result.httpContext).not.toContain('~*^/Docs');
  });
});
