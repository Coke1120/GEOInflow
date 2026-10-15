import { describe, expect, it } from 'vitest';
import {
  CandidateBudgetExceeded,
  extractUnknownProductTokens,
  summarizeUnknownTokens,
  summarizeUnknownSample,
} from './unknown-tokens';

describe('private unknown crawler candidates', () => {
  it('extracts product tokens once per request and removes browser/device noise', () => {
    expect(
      extractUnknownProductTokens(
        'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 StrangeBot/1.0 StrangeBot/2.0 Safari/537.36',
      ),
    ).toEqual(['strangebot']);
  });
  it('drops comments, URLs, addresses, emails, UUIDs, high-entropy and session values', () => {
    const input =
      'FreshCrawler/1.0 (+https://secret.test/path privateComment/1.0) https://private.test/SecretBot/1.0 user@example.com/1.0 203.0.113.5/1.0 2001:db8::1/1.0 13c060aa-4ba5-4b74-bdae-71e0f33374ac/1.0 SessionSecret/1.0 abcdefghijklmnopq/1.0 a1b2c3d4e5f6/1.0 /private/PathBot/1.0';
    expect(extractUnknownProductTokens(input)).toEqual(['freshcrawler']);
  });
  it('keeps a conservative bot token inside a compatible comment and allows bot-like standalone tokens', () => {
    expect(
      extractUnknownProductTokens(
        'Mozilla/5.0 (compatible; FutureBot/1.0; +https://example.com/bot; privateCustomer/1.0)',
      ),
    ).toEqual(['futurebot']);
    expect(extractUnknownProductTokens('FutureBot privateCustomer Alice')).toEqual(['futurebot']);
    expect(() =>
      summarizeUnknownTokens([{ userAgent: 'NewBot/1.0', createdAt: new Date() }], {
        deadline: Date.now() - 1,
      }),
    ).toThrow(CandidateBudgetExceeded);
  });
  it('retains completed rows and correct counts when the aggregation budget ends mid-sample', () => {
    let clock = 0;
    const rows = Array.from({ length: 10 }, (_, index) => ({
      userAgent: 'PartialBot/1.0',
      createdAt: new Date(10000 - index * 1000),
    }));
    expect(summarizeUnknownSample(rows, { deadline: 28, now: () => clock++ })).toEqual({
      scannedRows: 3,
      partial: true,
      items: [
        {
          token: 'partialbot',
          count: 3,
          firstSeen: rows[2].createdAt.toISOString(),
          lastSeen: rows[0].createdAt.toISOString(),
        },
      ],
    });
  });
  it('bounds distinct-token working memory without partially counting a row', () => {
    const time = new Date();
    const result = summarizeUnknownSample(
      [
        { userAgent: 'FirstBot/1.0 SecondBot/1.0', createdAt: time },
        { userAgent: 'FirstBot/1.0 ThirdBot/1.0', createdAt: time },
      ],
      { maxDistinct: 2 },
    );
    expect(result.scannedRows).toBe(1);
    expect(result.partial).toBe(true);
    expect(result.items.map(item => [item.token, item.count])).toEqual([
      ['firstbot', 1],
      ['secondbot', 1],
    ]);
  });
  it('rejects unbounded input and unversioned prose', () => {
    expect(extractUnknownProductTokens('a'.repeat(8193))).toEqual([]);
    expect(extractUnknownProductTokens('Customer Alice Bank account info')).toEqual([]);
  });
  it('sorts counts, reports first/last observations, and caps output at 100 tokens', () => {
    const rows = [
      { userAgent: 'SomeBot/1.0 OtherBot/1.0 SomeBot/2.0', createdAt: '2026-10-14T01:00:00Z' },
      { userAgent: 'somebot/1.0', createdAt: '2026-10-13T01:00:00Z' },
    ];
    const result = summarizeUnknownTokens(rows);
    expect(result).toEqual([
      {
        token: 'somebot',
        count: 2,
        firstSeen: '2026-10-13T01:00:00.000Z',
        lastSeen: '2026-10-14T01:00:00.000Z',
      },
      {
        token: 'otherbot',
        count: 1,
        firstSeen: '2026-10-14T01:00:00.000Z',
        lastSeen: '2026-10-14T01:00:00.000Z',
      },
    ]);
    expect(
      summarizeUnknownTokens(
        Array.from({ length: 150 }, (_, index) => ({
          userAgent: `Crawler${index}/1.0`,
          createdAt: rows[0].createdAt,
        })),
      ),
    ).toHaveLength(100);
  });
});
