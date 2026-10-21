// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkRangeSource,
  isQualifiedRangeContent,
  parseRangeFeed,
  RangeCheckError,
  type RangeObservation,
  rangeBaselines,
  rangeCheckErrorCode,
} from './range-check';
import { rangeSources } from './range-sources';
import { crawlerRegistry } from './registry';

const now = () => new Date('2026-10-15T02:00:00Z');

describe('reviewed official crawler range sources', () => {
  it('checks all 23 bundled sources through their fixed feed shapes', async () => {
    expect(rangeSources).toHaveLength(23);
    for (const source of rangeSources) {
      const baseline = rangeBaselines[source.id];
      expect(baseline.content.prefixes.length).toBeGreaterThan(0);
      const feed = {
        creationTime: baseline.content.publishedAt,
        prefixes: baseline.content.prefixes.map(prefix => ({
          [prefix.includes(':') ? 'ipv6Prefix' : 'ipv4Prefix']: prefix,
        })),
      };
      const fetcher = async () =>
        source.parserVersion === 'amazon-code-json-v1'
          ? new Response(`<pre><code>${JSON.stringify(feed)}</code></pre>`)
          : Response.json(feed);
      const checked = await checkRangeSource(source, undefined, {
        fetcher,
        now: () => new Date('2026-10-21T02:00:00Z'),
      });
      expect(checked.status).toBe('unchanged');
      expect(checked.content.version).toBe(baseline.content.version);
      expect(checked.observedAt).toBe('2026-10-21T02:00:00.000Z');
      expect(Object.isFrozen(checked.content.prefixes)).toBe(true);
    }
  });
});

const source = rangeSources[0];
const baseline = rangeBaselines[source.id];
const jsonFeed = (prefixes: string[], creationTime?: string) => ({
  prefixes: prefixes.map(prefix => ({
    [prefix.includes(':') ? 'ipv6Prefix' : 'ipv4Prefix']: prefix,
  })),
  ...(creationTime ? { creationTime } : {}),
});
const fetchFeed = (prefixes: string[], creationTime?: string) =>
  vi.fn<typeof fetch>(async () => Response.json(jsonFeed(prefixes, creationTime)));
async function approved(prefixes: string[]): Promise<RangeObservation> {
  const result = await checkRangeSource(source, undefined, { fetcher: fetchFeed(prefixes), now });
  return { content: result.content, observedAt: result.observedAt };
}
const check = (prefixes: string[], previous?: RangeObservation) =>
  checkRangeSource(source, previous, { fetcher: fetchFeed(prefixes), now });
afterEach(() => vi.useRealTimers());

describe('source and reviewed baseline boundaries', () => {
  it('binds only the explicit HTTP identities and shares the Claude feed once', () => {
    expect(new Set(rangeSources.map(source => source.id)).size).toBe(23);
    expect(new Set(rangeSources.map(source => source.url)).size).toBe(23);
    for (const entry of rangeSources) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(entry.url.startsWith('https://')).toBe(true);
      expect(entry.names).toEqual(
        entry.crawlerIds.map(id => {
          const crawler = crawlerRegistry.find(crawler => crawler.id === id);
          expect(crawler.kind).toBe('http_crawler');
          return crawler.name;
        }),
      );
      expect(isQualifiedRangeContent(entry, rangeBaselines[entry.id].content)).toBe(true);
      expect(Object.isFrozen(rangeBaselines[entry.id].content.prefixes)).toBe(true);
      expect(Number.isFinite(Date.parse(rangeBaselines[entry.id].observedAt))).toBe(true);
    }
    expect(rangeSources.find(source => source.id === 'anthropic').names).toEqual([
      'ClaudeBot',
      'Claude-SearchBot',
      'Claude-User',
    ]);
    expect(rangeSources.find(source => source.id === 'google-common').crawlerIds).toHaveLength(9);
    const bound = rangeSources.flatMap(source => source.crawlerIds);
    for (const id of [
      'google-extended',
      'googlebot-news',
      'applebot-extended',
      'ahrefssiteaudit',
      'mistralai-training',
    ])
      expect(bound).not.toContain(id);
    expect(rangeSources.find(source => source.id === 'ahrefs').names).toEqual(['AhrefsBot']);
  });

  it.each([
    { url: 'https://127.0.0.1/private' },
    { url: 'http://openai.com/gptbot.json' },
    { names: ['Other'] },
    { crawlerIds: ['oai-searchbot'] },
    { parserVersion: 'other' },
    { reviewedAt: '2027-01-01' },
  ])('rejects altered source configuration before requesting %j', async mutation => {
    const fetcher = fetchFeed(['1.1.1.0/24']);
    await expect(
      checkRangeSource({ ...source, ...mutation }, undefined, { fetcher, now }),
    ).rejects.toMatchObject({ code: 'invalid_source' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects unknown sources without automatically creating a baseline', async () => {
    const fetcher = fetchFeed(['1.1.1.0/24']);
    await expect(
      checkRangeSource({ ...source, id: 'new-source' }, undefined, { fetcher, now }),
    ).rejects.toMatchObject({ code: 'missing_baseline' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('strict CIDR parsing and normalization', () => {
  it('normalizes host bits, IPv6 notation and duplicates with stable content identity', async () => {
    const first = await check([
      '8.8.8.7/24',
      '2606:4700:0000:0000:0000:0000:0000:0001/32',
      '1.1.1.1/24',
      '8.8.8.0/24',
    ]);
    expect(first.content.prefixes).toEqual(['1.1.1.0/24', '8.8.8.0/24', '2606:4700::/32']);
    const second = await checkRangeSource(source, first, {
      fetcher: fetchFeed(['2606:4700::/32', '8.8.8.0/24', '1.1.1.0/24'], '2026-10-15T01:59:00Z'),
      now: () => new Date('2026-10-15T02:01:00Z'),
    });
    expect(second.content.version).toBe(first.content.version);
    expect(second.content.publishedAt).toBe('2026-10-15T01:59:00.000Z');
    expect(second.status).toBe('unchanged');
    expect(second.observedAt).not.toBe(first.observedAt);
    expect(second.change).toEqual({ added: 0, removed: 0, oldCount: 3 });
  });

  it.each([
    '1.1.1.1',
    '1.1.1.1/33',
    '1.1.1.1/-1',
    '1.1.1.1/024',
    '01.1.1.1/24',
    '1.1.1/24',
    '0x08080808/24',
    '134744072/24',
    '8.8.8.8/24 ',
    '8.8.8.256/24',
    '2606:4700::/129',
    '2606:4700::%eth0/64',
    '2606:4700::1::2/64',
    '::ffff:8.8.8.8/120',
  ])('rejects malformed or mapped syntax %s', async prefix => {
    await expect(check([prefix])).rejects.toMatchObject({ code: 'invalid_cidr' });
  });

  it.each([
    '0.0.0.0/0',
    '0.0.0.0/8',
    '10.0.0.0/8',
    '100.64.0.0/10',
    '127.0.0.0/8',
    '169.254.0.0/16',
    '172.16.0.0/12',
    '192.0.0.0/24',
    '192.0.2.0/24',
    '192.88.99.0/24',
    '192.168.0.0/16',
    '198.18.0.0/15',
    '198.51.100.0/24',
    '203.0.113.0/24',
    '224.0.0.0/4',
    '240.0.0.0/4',
    '255.255.255.255/32',
    '8.0.0.0/6',
    '192.0.0.0/8',
    '198.0.0.0/8',
    '::/0',
    '::1/128',
    '::ffff:808:808/120',
    'fc00::/7',
    'fe80::/10',
    'ff00::/8',
    '2001:db8::/32',
    '2001::/23',
    '2001::/16',
    '2002::/16',
    '3fff::/20',
    '2000::/3',
    '4000::/3',
    '2620:4f:8000::/48',
  ])('rejects non-public CIDRs and enclosing ranges %s', async prefix => {
    await expect(check([prefix])).rejects.toMatchObject({ code: 'non_public_cidr' });
  });

  it('accepts 5000 raw entries and rejects 5001 before deduplication', async () => {
    expect((await check(Array(5000).fill('8.8.8.0/24'))).content.prefixes).toEqual(['8.8.8.0/24']);
    await expect(check(Array(5001).fill('8.8.8.0/24'))).rejects.toMatchObject({
      code: 'too_many_prefixes',
    });
  });
});

describe('bounded official feed requests', () => {
  it('uses the reviewed URL, explicit product headers, abort signal and redirect rejection', async () => {
    const fetcher = fetchFeed(baseline.content.prefixes);
    await checkRangeSource(source, undefined, { fetcher, now });
    expect(fetcher).toHaveBeenCalledWith(
      source.url,
      expect.objectContaining({
        redirect: 'error',
        signal: expect.any(AbortSignal),
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Liekan/0.2.4 (+https://www.liekan.com; crawler-source-check)',
        },
      }),
    );
  });

  it.each([
    ['', 'invalid_json'],
    ['<html>private body</html>', 'invalid_json'],
    ['{invalid', 'invalid_json'],
    ['null', 'invalid_shape'],
    ['[]', 'invalid_shape'],
    ['{}', 'invalid_shape'],
    ['{"prefixes":[]}', 'empty_prefixes'],
    ['{"prefixes":["8.8.8.0/24"]}', 'invalid_shape'],
    ['{"prefixes":[{"ipv4Prefix":"8.8.8.0/24","ipv6Prefix":"2606:4700::/32"}]}', 'invalid_shape'],
    ['{"prefixes":[{"ipv4Prefix":"2606:4700::/32"}]}', 'invalid_shape'],
    ['{"prefixes":[{"ipv6Prefix":"8.8.8.0/24"}]}', 'invalid_shape'],
  ])('rejects unsafe or empty response body %s', async (body, code) => {
    await expect(
      checkRangeSource(source, undefined, { now, fetcher: async () => new Response(body) }),
    ).rejects.toMatchObject({ code, message: code });
  });

  it.each([
    [403, 'http_403'],
    [429, 'http_429'],
    [500, 'http_error'],
    [302, 'redirect_rejected'],
  ])('rejects HTTP status %s without exposing response bodies', async (status, code) => {
    await expect(
      checkRangeSource(source, undefined, {
        now,
        fetcher: async () => new Response('secret upstream body', { status: Number(status) }),
      }),
    ).rejects.toMatchObject({ code, message: code });
  });

  it('rejects a followed redirect even if a fetch adapter returns HTTP 200', async () => {
    const response = Response.json(jsonFeed(baseline.content.prefixes));
    Object.defineProperty(response, 'redirected', { value: true });
    await expect(
      checkRangeSource(source, undefined, { now, fetcher: async () => response }),
    ).rejects.toMatchObject({ code: 'redirect_rejected' });
  });

  it('redacts network errors behind stable public codes', async () => {
    await expect(
      checkRangeSource(source, undefined, {
        now,
        fetcher: async () => {
          throw new Error('secret upstream network detail');
        },
      }),
    ).rejects.toMatchObject({ code: 'network_error', message: 'network_error' });
    expect(rangeCheckErrorCode(new RangeCheckError('http_429'))).toBe('http_429');
    expect(rangeCheckErrorCode(new Error('private'))).toBe('network_error');
  });

  it('limits declared and streamed bodies to 1 MiB', async () => {
    const prefix = JSON.stringify(jsonFeed(baseline.content.prefixes));
    const body = prefix.padEnd(1024 * 1024, ' ');
    const valid = await checkRangeSource(source, undefined, {
      now,
      fetcher: async () => new Response(body),
    });
    expect(valid.status).toBe('unchanged');
    for (const response of [
      new Response(`${body} `),
      new Response(prefix, { headers: { 'content-length': '1048577' } }),
    ]) {
      await expect(
        checkRangeSource(source, undefined, { now, fetcher: async () => response }),
      ).rejects.toMatchObject({ code: 'response_too_large' });
    }
  });

  it.each(['headers', 'body'])(
    'bounds the entire fetch including stalled %s to 15 seconds',
    async phase => {
      vi.useFakeTimers();
      let signal: AbortSignal;
      const fetcher: typeof fetch = async (_url, options) => {
        signal = options.signal;
        if (phase === 'headers') return new Promise<Response>(() => {});
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{'));
            },
          }),
        );
      };
      const request = checkRangeSource(source, undefined, { now, fetcher });
      const assertion = expect(request).rejects.toMatchObject({ code: 'timeout' });
      await vi.advanceTimersByTimeAsync(15_000);
      await assertion;
      expect(signal.aborted).toBe(true);
    },
  );
});

describe('validated conditional observations', () => {
  it('rejects an unsolicited 304 without a previous observation', async () => {
    await expect(
      checkRangeSource(source, undefined, {
        now,
        fetcher: async () => new Response(null, { status: 304 }),
      }),
    ).rejects.toMatchObject({ code: 'not_modified_without_cache' });
  });

  it('refreshes observation and validators on a valid 304 while retaining the version', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 304, headers: { etag: '"new"' } }),
    );
    const result = await checkRangeSource(
      source,
      { ...baseline, etag: '"old"', lastModified: 'Wed, 14 Oct 2026 01:00:00 GMT' },
      { fetcher, now },
    );
    expect(result.status).toBe('unchanged');
    expect(result.notModified).toBe(true);
    expect(result.content).toEqual(baseline.content);
    expect(result.observedAt).toBe('2026-10-15T02:00:00.000Z');
    expect(result.etag).toBe('"new"');
    expect(result.lastModified).toBe('Wed, 14 Oct 2026 01:00:00 GMT');
    expect(fetcher.mock.calls[0][1].headers).toMatchObject({
      'If-None-Match': '"old"',
      'If-Modified-Since': 'Wed, 14 Oct 2026 01:00:00 GMT',
    });
  });

  it.each([
    { version: '0'.repeat(64) },
    { sourceUrl: 'https://evil.example' },
    { sourceId: 'openai-search' },
    { parserVersion: 'other' },
    { names: ['Other'] },
    { crawlerIds: ['other'] },
    { prefixes: ['10.0.0.0/8'] },
    { prefixes: [...baseline.content.prefixes].reverse() },
    { publishedAt: 'invalid' },
  ])('rejects tampered cache content before conditional observation %j', async mutation => {
    const content = { ...baseline.content, ...mutation };
    expect(isQualifiedRangeContent(source, content)).toBe(false);
    await expect(
      checkRangeSource(
        source,
        { ...baseline, content },
        {
          now,
          fetcher: async () => new Response(null, { status: 304 }),
        },
      ),
    ).rejects.toMatchObject({ code: 'invalid_cache' });
  });

  it.each(['2026-10-16T02:00:00Z', 'invalid', '2026-10-15'])(
    'rejects invalid cache observation %s',
    async observedAt => {
      await expect(
        checkRangeSource(
          source,
          { ...baseline, observedAt },
          {
            now,
            fetcher: async () => new Response(null, { status: 304 }),
          },
        ),
      ).rejects.toMatchObject({ code: 'invalid_cache' });
    },
  );

  it('rejects a future baseline and future publication dates', async () => {
    await expect(
      checkRangeSource(source, undefined, {
        now: () => new Date('2026-10-14T02:00:00Z'),
        fetcher: async () => new Response(null, { status: 304 }),
      }),
    ).rejects.toMatchObject({ code: 'invalid_cache' });
    await expect(
      checkRangeSource(source, undefined, {
        now,
        fetcher: fetchFeed(baseline.content.prefixes, '2026-10-16T02:00:00Z'),
      }),
    ).rejects.toMatchObject({ code: 'invalid_timestamp' });
    await expect(
      checkRangeSource(
        source,
        { ...baseline, content: { ...baseline.content, publishedAt: '2026-10-16T02:00:00Z' } },
        { now, fetcher: async () => new Response(null, { status: 304 }) },
      ),
    ).rejects.toMatchObject({ code: 'invalid_cache' });
  });
});

describe('review thresholds for changed official ranges', () => {
  const old = ['1.1.1.0/24', '1.1.2.0/24', '1.1.3.0/24', '1.1.4.0/24'];
  it('accepts exactly 50 percent churn and retains larger changes as candidates', async () => {
    const previous = await approved(old);
    const boundary = await check([...old.slice(0, 3), '1.1.5.0/24'], previous);
    expect(boundary.status).toBe('ok');
    expect(boundary.change).toEqual({ added: 1, removed: 1, oldCount: 4 });
    const candidate = await check([...old.slice(0, 2), '1.1.5.0/24', '1.1.6.0/24'], previous);
    expect(candidate.status).toBe('candidate');
    expect(candidate.candidateReason).toBe('prefix_churn');
    expect(candidate.content.prefixes).toEqual([
      '1.1.1.0/24',
      '1.1.2.0/24',
      '1.1.5.0/24',
      '1.1.6.0/24',
    ]);
    expect(previous.content.prefixes).toEqual(old);
  });

  it.each([
    [
      ['1.1.0.0/24', '1.1.0.0/25', '1.1.0.128/25', '1.1.0.0/26'],
      '1.1.0.0/22',
      '1.1.0.0/21',
      'ipv4_coverage_growth',
    ],
    [
      ['2606:4700::/64', '2606:4700::/65', '2606:4700:0:0:8000::/65', '2606:4700::/66'],
      '2606:4700::/62',
      '2606:4700::/61',
      'ipv6_coverage_growth',
    ],
  ])(
    'uses the interval union for exact 4x growth and rejects 8x growth',
    async (prefixes: string[], fourfold: string, eightfold: string, reason: string) => {
      const previous = await approved(prefixes);
      expect((await check([fourfold, ...prefixes.slice(1)], previous)).status).toBe('ok');
      const candidate = await check([eightfold, ...prefixes.slice(1)], previous);
      expect(candidate.status).toBe('candidate');
      expect(candidate.candidateReason).toBe(reason);
      expect(candidate.change).toEqual({ added: 1, removed: 1, oldCount: 4 });
    },
  );

  it('requires review when an existing IPv4-only source adds any IPv6 coverage', async () => {
    const result = await check([...old, '2606:4700::/64'], await approved(old));
    expect(result.change).toEqual({ added: 1, removed: 0, oldCount: 4 });
    expect(result.status).toBe('candidate');
    expect(result.candidateReason).toBe('ipv6_coverage_growth');
  });
});

describe('immutable checks across asynchronous network boundaries', () => {
  it('uses reviewed bindings and an immutable copy of the qualified cache across the fetch', async () => {
    const mutableSource = {
      ...source,
      names: [...source.names],
      crawlerIds: [...source.crawlerIds],
    };
    const mutablePrevious = {
      ...baseline,
      content: {
        ...baseline.content,
        names: [...baseline.content.names],
        crawlerIds: [...baseline.content.crawlerIds],
        prefixes: [...baseline.content.prefixes],
      },
    };
    const result = await checkRangeSource(mutableSource, mutablePrevious, {
      now,
      fetcher: async () => {
        mutableSource.names[0] = 'Other';
        mutableSource.crawlerIds[0] = 'other';
        mutablePrevious.content.prefixes[0] = '10.0.0.0/8';
        return new Response(null, { status: 304 });
      },
    });
    expect(result.content).toEqual(baseline.content);
    expect(isQualifiedRangeContent(source, result.content)).toBe(true);
  });

  it('cancels a stalled response body when the overall timeout expires', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const request = checkRangeSource(source, undefined, {
      now,
      fetcher: async () => new Response(new ReadableStream({ cancel })),
    });
    const assertion = expect(request).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects impossible calendar dates in cache observations', async () => {
    await expect(
      checkRangeSource(
        source,
        {
          ...baseline,
          observedAt: '2026-02-30T00:00:00Z',
          content: { ...baseline.content, publishedAt: null },
        },
        { now, fetcher: async () => new Response(null, { status: 304 }) },
      ),
    ).rejects.toMatchObject({ code: 'invalid_cache' });
  });
});

describe('Amazon inert code JSON feeds', () => {
  const amazon = rangeSources.find(source => source.id === 'amazonbot');
  const feed = (prefixes: unknown) =>
    JSON.stringify({ creationTime: '2026-09-08T05:24:10.610952+00:00', prefixes });
  const block = (value: string) => `<pre><code>${value}</code></pre>`;
  it('accepts the official SearchBot ip_prefix shape without changing JSON-only sources', () => {
    const source = rangeSources.find(source => source.id === 'amazon-search');
    const json = feed([{ ip_prefix: '3.82.67.224/32' }, { ip_prefix: '2606:4700::1/128' }]);
    expect(parseRangeFeed(source, block(json)).prefixes).toEqual([
      '3.82.67.224/32',
      '2606:4700::1/128',
    ]);
    expect(() =>
      parseRangeFeed(
        rangeSources.find(source => source.id === 'openai-gpt'),
        json,
      ),
    ).toThrow(RangeCheckError);
  });
  it('accepts a unique highlighted block and exact address families', () => {
    const json = feed([
      { ipv4Prefix: '8.8.8.8' },
      { ipv6Prefix: '2606:4700::1' },
      { ipv4Prefix: '1.1.1.0/24' },
    ]);
    const result = parseRangeFeed(
      amazon,
      `<script>ignored()</script>${block(json.replaceAll('"', '<span class="s">&quot;</span>'))}`,
    );
    expect(result.prefixes).toEqual(['8.8.8.8/32', '2606:4700::1/128', '1.1.1.0/24']);
    expect(result.publishedAt).toBe('2026-09-08T05:24:10.610Z');
  });
  it.each([
    '<script>{"creationTime":"2026-09-08","prefixes":[]}</script>',
    block(feed([{ ipv4Prefix: '8.8.8.8' }])).repeat(2),
    block(feed([{ ipv4Prefix: '127.0.0.1' }])),
    block(feed([{ ipv4Prefix: '2606:4700::1' }])),
    block(feed([{ ipv4Prefix: '8.8.8.8/033' }])),
    block(feed([{ ipv4Prefix: '8.8.8.8' }])).replace('8.8.8.8', '<script>8.8.8.8</script>'),
    block('{"creationTime":null,"prefixes":[{"ipv4Prefix":"8.8.8.8"}]}'),
  ])('rejects ambiguous, changed or invalid markup %s', html => {
    expect(() => parseRangeFeed(amazon, html)).toThrow(RangeCheckError);
  });
  it('keeps Amazon feeds isolated to their three identities', () => {
    expect(
      rangeSources
        .filter(source => source.parserVersion === 'amazon-code-json-v1')
        .map(source => source.crawlerIds),
    ).toEqual([['amazonbot'], ['amzn-searchbot'], ['amzn-user']]);
  });
});
