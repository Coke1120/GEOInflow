import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ auth: vi.fn(), relational: vi.fn(), website: vi.fn() }));
vi.mock('@/lib/auth', () => ({ checkAuth: h.auth }));
vi.mock('@/lib/db', () => ({ isRelationalOnly: h.relational }));
vi.mock('./ai-access', () => ({ authorizeAiWebsite: h.website }));
vi.mock('./ai-db', () => ({ aiTransaction: vi.fn() }));
import { authenticateCrawler, authorizeCrawler } from './crawler-access';
import { currentCacheContext, withQueryCacheHeaders } from './cache-context';

const actor = { id: 'a34cc481-2083-47ab-9a88-31459ede8081', role: 'user' };
beforeEach(() => {
  h.auth.mockResolvedValue({ authType: 'session', user: actor });
  h.relational.mockReturnValue(true);
  h.website.mockResolvedValue({
    id: 'cb23c895-d653-441a-9aad-607e37c930f9',
    role: 'user',
    teamRole: 'team-member',
    ownerUserId: null,
    canUse: true,
    canManage: false,
  });
});
describe('crawler production authorization', () => {
  it('binds an explicit analysis refresh to the authenticated actor and rechecks identity', async () => {
    await withQueryCacheHeaders(async () => {
      await authenticateCrawler(
        new Request('https://liekan.test/api/liekan/websites/site/crawler-analysis?refresh=1'),
      );
      expect(currentCacheContext()).toMatchObject({ refresh: true, actor: actor.id });
      expect(await currentCacheContext().reauthorize()).toBe(true);
      h.auth.mockResolvedValue({ authType: 'session', user: { ...actor, id: 'other' } });
      expect(await currentCacheContext().reauthorize()).toBe(false);
      return Response.json({});
    });
  });
  it.each(['api-key', 'share', undefined])('rejects %s identity', async authType => {
    h.auth.mockResolvedValue({ authType, user: actor });
    await expect(authenticateCrawler(new Request('https://liekan.test/api'))).rejects.toMatchObject(
      { status: 401 },
    );
  });
  it('rejects missing identity and mixed public share identity', async () => {
    h.auth.mockResolvedValue(null);
    await expect(authenticateCrawler(new Request('https://liekan.test/api'))).rejects.toMatchObject(
      { status: 401 },
    );
    h.auth.mockResolvedValue({
      authType: 'session',
      user: actor,
      shareToken: { websiteId: 'other' },
    });
    await expect(authenticateCrawler(new Request('https://liekan.test/api'))).rejects.toMatchObject(
      { status: 401 },
    );
  });
  it('supports a complete session and rejects cross-origin writes', async () => {
    await expect(authenticateCrawler(new Request('https://liekan.test/api'))).resolves.toEqual(
      actor,
    );
    await expect(
      authenticateCrawler(
        new Request('https://liekan.test/api', {
          method: 'POST',
          headers: { origin: 'https://other.test' },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it.each([
    { host: '127.0.0.1:3004', origin: 'http://127.0.0.1:3004', protocol: 'http' },
    { host: 'liekan.test', origin: 'https://liekan.test', protocol: 'https' },
    { host: 'liekan.test:443', origin: 'https://liekan.test', protocol: 'https' },
  ])('accepts the HTTP authority behind standalone Docker and TLS proxies: %j', async value => {
    await expect(
      authenticateCrawler(
        new Request('http://0.0.0.0:3000/api', {
          method: 'POST',
          headers: { host: value.host, origin: value.origin, 'x-forwarded-proto': value.protocol },
        }),
      ),
    ).resolves.toEqual(actor);
  });
  it.each([
    { host: 'liekan.test', origin: 'https://other.test', protocol: 'https' },
    { host: 'liekan.test', origin: 'http://liekan.test', protocol: 'https' },
    { host: 'liekan.test', origin: 'https://liekan.test:444', protocol: 'https' },
    { host: 'liekan.test', origin: 'null', protocol: 'https' },
    { host: 'liekan.test', origin: 'https://liekan.test', protocol: 'https,http' },
    { host: 'liekan.test/other', origin: 'https://liekan.test', protocol: 'https' },
    {
      host: 'liekan.test',
      origin: 'https://other.test',
      protocol: 'https',
      forwardedHost: 'other.test',
    },
  ])('rejects cross-origin and ambiguous proxy authority: %j', async value => {
    await expect(
      authenticateCrawler(
        new Request('http://0.0.0.0:3000/api', {
          method: 'POST',
          headers: {
            host: value.host,
            origin: value.origin,
            'x-forwarded-proto': value.protocol,
            ...(value.forwardedHost ? { 'x-forwarded-host': value.forwardedHost } : {}),
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('allows team members to draft and denies production control', async () => {
    await expect(authorizeCrawler({} as any, actor, 'site', 'draft')).resolves.toMatchObject({
      canDraft: true,
      canControl: false,
    });
    await expect(authorizeCrawler({} as any, actor, 'site', 'control')).rejects.toMatchObject({
      status: 403,
    });
  });
  it('honors account or team read-only restrictions before ownership', async () => {
    h.website.mockResolvedValue({
      role: 'view-only',
      ownerUserId: actor.id,
      canUse: false,
      canManage: false,
    });
    await expect(authorizeCrawler({} as any, actor, 'site', 'draft')).rejects.toMatchObject({
      status: 403,
    });
    await expect(authorizeCrawler({} as any, actor, 'site', 'control')).rejects.toMatchObject({
      status: 403,
    });
  });
  it('allows current authorized managers', async () => {
    h.website.mockResolvedValue({
      role: 'user',
      teamRole: 'team-manager',
      canUse: true,
      canManage: true,
    });
    await expect(authorizeCrawler({} as any, actor, 'site', 'control')).resolves.toMatchObject({
      canControl: true,
    });
  });
  it('declares ClickHouse unsupported', async () => {
    h.relational.mockReturnValue(false);
    await expect(authenticateCrawler(new Request('https://liekan.test/api'))).rejects.toMatchObject(
      { status: 503 },
    );
  });
});
