// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkDocumentSource, documentCheckErrorCode, normalizeDocument } from './document-check';
import { documentSources } from './document-sources';
import { checkSources } from '../../../../scripts/liekan-crawlers-check-sources';
import { rangeSources } from './range-sources';
import { rangeBaselines } from './range-check';
const source = documentSources[0];
const fetcher = (body: string, status = 200) =>
  vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;
afterEach(() => vi.useRealTimers());

describe('fixed crawler document checks', () => {
  it('deduplicates reviewed source URLs and retains the actual manual review date', () => {
    expect(new Set(documentSources.map(source => source.url)).size).toBe(documentSources.length);
    expect(documentSources.length).toBeGreaterThan(25);
    expect(documentSources.every(source => source.url.startsWith('https://'))).toBe(true);
    expect(documentSources[0].reviewedAt).toBe('2026-10-05');
  });
  it('hashes bounded normalized documentation and tracks baseline/unchanged/changed', async () => {
    const first = await checkDocumentSource(source, undefined, {
      fetcher: fetcher('<main>Documentation</main><script>alert(1)</script>'),
    });
    expect(first.status).toBe('baseline');
    expect(Object.keys(first)).not.toContain('body');
    const unchanged = await checkDocumentSource(source, first, {
      fetcher: fetcher(
        '<nav>changed menu</nav><main> Documentation </main><script>different</script>',
      ),
    });
    expect(unchanged.hash).toBe(first.hash);
    expect(unchanged.status).toBe('unchanged');
    const changed = await checkDocumentSource(source, first, {
      fetcher: fetcher('<main>Updated documentation</main>'),
    });
    expect(changed.status).toBe('changed');
    expect(changed.hash).not.toBe(first.hash);
    expect(normalizeDocument('<a href="https://example.org/a">link</a>')).not.toBe(
      normalizeDocument('<a href="https://example.org/b">link</a>'),
    );
  });
  it('allows conditional 304 only with a qualified prior body hash', async () => {
    const network = vi.fn<typeof fetch>(async () => new Response(null, { status: 304 }));
    await expect(
      checkDocumentSource(source, undefined, { fetcher: network }),
    ).rejects.toMatchObject({ code: 'not_modified_without_cache' });
    await expect(
      checkDocumentSource(source, { hash: 'invalid' }, { fetcher: network }),
    ).rejects.toMatchObject({ code: 'invalid_cache' });
    const result = await checkDocumentSource(
      source,
      { hash: 'a'.repeat(64), etag: '"safe"', lastModified: 'bad\nheader' },
      { fetcher: network },
    );
    expect(result).toMatchObject({ hash: 'a'.repeat(64), status: 'unchanged', notModified: true });
    expect(network.mock.lastCall?.[1]).toMatchObject({
      redirect: 'error',
      headers: { 'If-None-Match': '"safe"' },
    });
  });
  it.each([
    ['http://localhost/private', 'invalid_source'],
    ['https://evil.test/', 'invalid_source'],
  ])('rejects unregistered destination %s', async (url, code) => {
    const network = vi.fn();
    await expect(
      checkDocumentSource({ ...source, url }, undefined, { fetcher: network }),
    ).rejects.toMatchObject({ code });
    expect(network).not.toHaveBeenCalled();
  });
  it.each([
    [403, 'http_403'],
    [429, 'http_429'],
    [500, 'http_error'],
    [302, 'redirect_rejected'],
  ])('returns a safe error for HTTP %s', async (status, code) => {
    await expect(
      checkDocumentSource(source, undefined, {
        fetcher: fetcher('secret upstream body', status as number),
      }),
    ).rejects.toMatchObject({ code });
  });
  it('bounds body bytes and treats empty/script-only content as unavailable', async () => {
    await expect(
      checkDocumentSource(source, undefined, { fetcher: fetcher('a'.repeat(1024 * 1024 + 1)) }),
    ).rejects.toMatchObject({ code: 'response_too_large' });
    await expect(
      checkDocumentSource(source, undefined, { fetcher: fetcher('<script>secret</script>') }),
    ).rejects.toMatchObject({ code: 'empty_document' });
    expect(documentCheckErrorCode(new Error('credentials:secret'))).toBe('network_error');
  });
  it('applies the 15-second deadline to a stalled response body', async () => {
    vi.useFakeTimers();
    const check = checkDocumentSource(source, undefined, {
      fetcher: vi.fn(async () => new Response(new ReadableStream({ start() {} }))),
    });
    const assertion = expect(check).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(15001);
    await assertion;
  });
  it('keeps the standalone command read-only with two network requests at most', async () => {
    let active = 0,
      peak = 0;
    const network: typeof fetch = async input => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      const range = rangeSources.find(source => source.url === input);
      return new Response(
        range
          ? JSON.stringify({
              prefixes: rangeBaselines[range.id].content.prefixes.map(prefix => ({
                [prefix.includes(':') ? 'ipv6Prefix' : 'ipv4Prefix']: prefix,
              })),
            })
          : '<main>Fixed documentation</main>',
      );
    };
    const result = await checkSources(network);
    expect(peak).toBe(2);
    expect(result.readOnly).toBe(true);
    expect(result.results).toHaveLength(rangeSources.length + documentSources.length);
    expect(
      result.results.filter(row => row.kind === 'ip').every(row => row.status === 'unchanged'),
    ).toBe(true);
    expect(
      result.results.filter(row => row.kind === 'document').every(row => row.status === 'baseline'),
    ).toBe(true);
  });
});
