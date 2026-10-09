import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  crawlerCloudflareApi,
  crawlerDesiredMatches,
  crawlerRemoteHash,
  crawlerZoneQuota,
  readCrawlerCloudflare,
  writeCrawlerCloudflare,
} from './cloudflare';
const zoneId = 'a'.repeat(32),
  rulesetId = 'b'.repeat(32),
  ruleId = 'c'.repeat(32);
const rule = {
  id: ruleId,
  ref: 'liekan_test',
  action: 'block',
  expression: 'http.host eq "example.com"',
  description: 'Liekan v1',
  enabled: true,
};
const snapshot = {
  rulesetId,
  rules: [rule],
  quota: 5,
  zone: { name: 'example.com', plan: 'Free' },
};
afterEach(() => vi.unstubAllGlobals());
describe('bounded Cloudflare crawler adapter', () => {
  it('uses a single-rule patch and preserves unrelated rule ordering', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ success: true, result: {} })));
    vi.stubGlobal('fetch', fetcher);
    await writeCrawlerCloudflare('private', zoneId, snapshot, rule, { ...rule, enabled: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/rulesets/${rulesetId}/rules/${ruleId}`,
    );
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ ...rule, id: undefined, enabled: false });
  });
  it('marks write timeouts uncertain and never retries', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('credential must never leak'));
    vi.stubGlobal('fetch', fetcher);
    await expect(
      writeCrawlerCloudflare('private', zoneId, snapshot, rule, { ...rule, enabled: false }),
    ).rejects.toMatchObject({ code: 'provider-network', uncertain: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('enforces the Free quota before making a create request', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(
      writeCrawlerCloudflare(
        'private',
        zoneId,
        { ...snapshot, rules: Array(5).fill(rule) },
        null,
        rule,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(['Free', 'Pro', 'Business', 'Enterprise'].map(crawlerZoneQuota)).toEqual([
      5, 20, 100, 1000,
    ]);
  });
  it('reads missing entrypoint as empty without creating anything', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: { name: 'example.com', plan: { name: 'Free' } },
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false }), { status: 404 }));
    vi.stubGlobal('fetch', fetcher);
    expect(await readCrawlerCloudflare('private', zoneId, 'www.example.com')).toMatchObject({
      rulesetId: null,
      rules: [],
      quota: 5,
    });
    expect(fetcher.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
  });
  it('rejects unrelated hostname and credential-bearing error bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ success: true, result: { name: 'example.com' } })),
        ),
    );
    await expect(
      readCrawlerCloudflare('private', zoneId, 'evil-example.com'),
    ).rejects.toMatchObject({ status: 400 });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, errors: [{ message: 'private' }] }), {
          status: 403,
        }),
      ),
    );
    await expect(crawlerCloudflareApi('private', `/zones/${zoneId}`)).rejects.toMatchObject({
      message: '供应商操作暂时失败',
      code: 'provider-permission',
      uncertain: false,
    });
  });
  it.each([
    {
      action_parameters: {
        response: { status_code: 451, content: 'manual', content_type: 'text/plain' },
      },
    },
    { logging: { enabled: true } },
    { unknown_provider_option: { enabled: true } },
  ])('detects added semantic rule fields during readback: %j', extra => {
    expect(crawlerDesiredMatches({ ...rule, ...extra }, rule)).toBe(false);
  });
  it('compares nested semantic fields canonically and excludes only provider transport metadata', () => {
    const target = {
      ...rule,
      logging: { enabled: true },
      action_parameters: { response: { status_code: 403, content: 'blocked' } },
    };
    expect(
      crawlerDesiredMatches(
        {
          ...target,
          id: 'd'.repeat(32),
          version: '3',
          last_updated: 'today',
          action_parameters: { response: { content: 'blocked', status_code: 403 } },
        },
        target,
      ),
    ).toBe(true);
    expect(crawlerDesiredMatches({ ...target, logging: { enabled: false } }, target)).toBe(false);
    expect(
      crawlerDesiredMatches(
        { ...target, action_parameters: { response: { status_code: 451, content: 'blocked' } } },
        target,
      ),
    ).toBe(false);
    expect(crawlerDesiredMatches({ ...target, action_parameters: {} }, target)).toBe(false);
  });
  it('detects manual changes while ignoring transport version metadata', () => {
    expect(crawlerRemoteHash(rule)).toBe(
      crawlerRemoteHash({ ...rule, version: '2', last_updated: 'today' }),
    );
    expect(crawlerRemoteHash(rule)).not.toBe(crawlerRemoteHash({ ...rule, description: 'manual' }));
    expect(crawlerDesiredMatches({ ...rule, version: '2' }, rule)).toBe(true);
    expect(crawlerDesiredMatches({ ...rule, enabled: false }, rule)).toBe(false);
  });
});
