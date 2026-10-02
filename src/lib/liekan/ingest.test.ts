import { afterEach, describe, expect, it, vi } from 'vitest';
import snapshots from '../../../config/liekan/bot-ranges.json';
import { parseCatalog, parseLogInput } from './ingest';

describe('Liekan ingestion public boundary', () => {
  afterEach(() => vi.useRealTimers());
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
    );
    expect(result.records[0]).toMatchObject({
      path: '/docs/',
      status: 200,
      ipMasked: '203.0.113.0/24',
      bot: 'GPTBot',
      verification: 'range_mismatch',
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
});
