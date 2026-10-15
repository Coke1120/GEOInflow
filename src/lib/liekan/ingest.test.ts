import { afterEach, describe, expect, it, vi } from 'vitest';
import { legacyBundledVerificationSnapshots as snapshots } from './rules/verify';
import { BOT_RULES } from './rules/bots';
import { canonicalPath, parseCatalog, parseLogInput } from './ingest';

describe('Liekan ingestion public boundary', () => {
  afterEach(() => vi.useRealTimers());
  it('preserves a 500-character encoded path and rejects longer paths without merging identities', () => {
    const boundary = `/${'a'.repeat(499)}`;
    expect(canonicalPath(boundary, 'example.com')).toBe(boundary);
    expect(() => canonicalPath(`${boundary}b`, 'example.com')).toThrow('500');
    expect(() =>
      parseCatalog(
        {
          format: 'json',
          content: JSON.stringify([{ path: `${boundary}/one` }, { path: `${boundary}/two` }]),
        },
        'example.com',
      ),
    ).toThrow('500');
    const result = parseLogInput(
      {
        format: 'json',
        records: [{ time: '2026-01-01', ip: '203.0.113.1', path: `${boundary}b`, status: 200 }],
      },
      'example.com',
      'key',
    );
    expect(result).toMatchObject({ accepted: 0, rejected: 1, records: [] });
  });
  it('imports a combined request with masked IP and redacted query', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(snapshots.GPTBot.retrievedAt));
    const result = parseLogInput(
      {
        format: 'combined',
        content:
          '203.0.113.29 - - [02/Oct/2026:10:00:00 +0800] "GET /docs/?token=private HTTP/1.1" 200 128 "-" "Mozilla/5.0 GPTBot/1.2"',
      },
      'liekan.example',
      'key',
      BOT_RULES,
      snapshots,
    );
    expect(result.records[0]).toMatchObject({
      path: '/docs/',
      status: 200,
      ipMasked: '203.0.113.0/24',
      bot: 'GPTBot',
      verification: 'range_mismatch',
      verificationVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
      verificationObservedAt: new Date(snapshots.GPTBot.retrievedAt).toISOString(),
    });
    expect(JSON.stringify(result.records)).not.toContain('private');
    expect(JSON.stringify(result.records)).not.toContain('203.0.113.29');
  });
  it('rejects omitted URLs instead of creating a root-page observation', () => {
    expect(
      parseLogInput(
        { format: 'json', records: [{ time: '2026-01-01', ip: '203.0.113.1', status: 200 }] },
        'example.com',
        'key',
      ).rejected,
    ).toBe(1);
    expect(() =>
      parseCatalog({ format: 'json', content: '[{"title":"Missing URL"}]' }, 'example.com'),
    ).toThrow();
  });
  it('preserves repeated requests within a batch and deduplicates stable reimports', () => {
    const record = { time: '2026-01-01', ip: '203.0.113.1', path: '/a', status: 200 };
    const input = { format: 'json', records: [record, record] };
    const first = parseLogInput(input, 'example.com', 'key');
    expect(new Set(first.records.map(row => row.id)).size).toBe(2);
    expect(parseLogInput(input, 'example.com', 'key').records.map(row => row.id)).toEqual(
      first.records.map(row => row.id),
    );
  });
  it('limits normalized batches and validates supplied content evidence', () => {
    expect(() =>
      parseLogInput({ format: 'json', records: Array(1001).fill({}) }, 'example.com', 'key'),
    ).toThrow('1000');
    const input = {
      format: 'json',
      content: '[{"path":"/a","updatedAt":"2026-01-01","linkDepth":3,"source":"site export"}]',
    };
    expect(parseCatalog(input, 'example.com')[0]).toMatchObject({
      updatedAt: '2026-01-01T00:00:00.000Z',
      linkDepth: 3,
      source: 'site export',
    });
    expect(() =>
      parseCatalog({ format: 'json', content: '[{"path":"/a","linkDepth":-1}]' }, 'example.com'),
    ).toThrow();
  });
  it('reports malformed rows without retaining their raw contents', () => {
    expect(
      parseLogInput({ format: 'combined', content: 'bad secret line' }, 'example.com', 'key'),
    ).toMatchObject({ records: [], rejected: 1 });
  });
  it('rejects foreign domains and unsafe XML', () => {
    expect(() =>
      parseCatalog({ format: 'sitemap', content: '<!DOCTYPE x><urlset></urlset>' }, 'example.com'),
    ).toThrow();
    expect(() =>
      parseCatalog(
        { format: 'json', content: '[{"url":"https://evil.example/a"}]' },
        'example.com',
      ),
    ).toThrow();
  });
  it('accepts URL-list sitemaps and rejects indexes without creating content observations', () => {
    expect(
      parseCatalog(
        {
          format: 'sitemap',
          content:
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/a</loc></url></urlset>',
        },
        'example.com',
      )[0].path,
    ).toBe('/a');
    expect(() =>
      parseCatalog(
        {
          format: 'sitemap',
          content:
            '<sitemapindex><sitemap><loc>https://example.com/sitemap-posts.xml</loc></sitemap></sitemapindex>',
        },
        'example.com',
      ),
    ).toThrow('索引');
  });
  it('canonicalizes catalog URLs and retains supplied metadata', () => {
    expect(
      parseCatalog(
        {
          format: 'json',
          content: '[{"url":"https://example.com/a?token=x","type":"article","wordCount":600}]',
        },
        'example.com',
      )[0],
    ).toMatchObject({ path: '/a', type: 'article', wordCount: 600 });
  });
  it('identifies only supplied catalog metadata, including explicit clears', () => {
    expect(
      parseCatalog({ format: 'json', content: '["/a"]' }, 'example.com')[0].providedFields,
    ).toEqual([]);
    expect(
      parseCatalog(
        {
          format: 'sitemap',
          content: '<urlset><url><loc>https://example.com/a</loc></url></urlset>',
        },
        'example.com',
      )[0].providedFields,
    ).toEqual([]);
    expect(
      parseCatalog(
        {
          format: 'json',
          content: '[{"path":"/a","type":"文章","wordCount":null,"publishedAt":null,"extra":1}]',
        },
        'example.com',
      )[0],
    ).toMatchObject({
      providedFields: ['type', 'wordCount', 'publishedAt'],
      wordCount: null,
      publishedAt: null,
    });
    expect(
      parseCatalog({ format: 'csv', content: 'path,title,updatedAt\n/a,Title,' }, 'example.com')[0]
        .providedFields,
    ).toEqual(['title', 'updatedAt']);
  });
  it('rejects impossible calendar dates in JSON, combined logs and catalog evidence', () => {
    const record = { ip: '203.0.113.1', path: '/a', status: 200 };
    for (const time of [
      '2026-02-30T12:00:00Z',
      '2025-02-29',
      '2026-04-31',
      '2026-01-01T24:00:00Z',
      '2026-01-01T12:00:00',
    ]) {
      expect(
        parseLogInput({ format: 'json', records: [{ ...record, time }] }, 'example.com', 'key'),
        time,
      ).toMatchObject({ accepted: 0, rejected: 1 });
    }
    expect(
      parseLogInput(
        {
          format: 'combined',
          content:
            '203.0.113.1 - - [31/Sep/2026:12:00:00 +0000] "GET /a HTTP/1.1" 200 0 "-" "GPTBot"',
        },
        'example.com',
        'key',
      ),
    ).toMatchObject({ accepted: 0, rejected: 1 });
    for (const field of ['publishedAt', 'updatedAt']) {
      expect(() =>
        parseCatalog(
          {
            format: 'json',
            content: JSON.stringify([{ path: '/a', [field]: '2026-02-30T12:00:00Z' }]),
          },
          'example.com',
        ),
      ).toThrow('时间');
    }
    expect(
      parseLogInput(
        { format: 'json', records: [{ ...record, time: '2024-02-29T11:00:00+08:00' }] },
        'example.com',
        'key',
      ).records[0].time,
    ).toBe('2024-02-29T03:00:00.000Z');
  });
  it('accepts explicit millisecond timestamps and rejects ambiguous seconds', () => {
    const record = { ip: '203.0.113.1', path: '/a', status: 200 };
    expect(
      parseLogInput(
        { format: 'json', records: [{ ...record, timestamp: 1767225600000 }] },
        'example.com',
        'key',
      ).records[0].time,
    ).toBe('2026-01-01T00:00:00.000Z');
    expect(
      parseLogInput(
        { format: 'json', records: [{ ...record, timestamp: 1767225600 }] },
        'example.com',
        'key',
      ),
    ).toMatchObject({ accepted: 0, rejected: 1 });
    expect(
      parseLogInput({ format: 'json', records: [{ ...record, time: 0 }] }, 'example.com', 'key')
        .records[0].time,
    ).toBe('1970-01-01T00:00:00.000Z');
  });
});
