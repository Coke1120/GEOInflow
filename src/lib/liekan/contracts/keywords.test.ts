import { describe, expect, it } from 'vitest';
import {
  addKeywordCandidate,
  identifyKeyword,
  keywordConditionsSchema,
  keywordStatusLabels,
  selectKeywords,
  type KeywordEntry,
  type KeywordRow,
} from './keywords';
import { safeCsvCell } from './export-privacy';
const google: KeywordEntry = {
  referrer: 'www.google.com',
  referrerPath: '/search',
  referrerQuery: '?q=%E7%8C%8E%E7%9C%8B',
};
describe('source keyword evidence', () => {
  it.each([
    ['baidu.com', '/link', 'url=opaque&wd=&eqid=example'],
    ['www.baidu.com', '/link/', 'wd=%20&url=opaque'],
    ['so.com', '/link', 'm=opaque'],
    ['sogou.com', '/link', 'url=opaque'],
    ['m.sogou.com', '/link', 'keyword='],
  ])(
    'distinguishes a known redirect without a readable term: %s%s',
    (referrer, referrerPath, referrerQuery) => {
      expect(identifyKeyword({ referrer, referrerPath, referrerQuery })).toMatchObject({
        keyword: null,
        evidence: 'none',
        status: 'redirect',
      });
      expect(
        identifyKeyword({ referrer, referrerPath, referrerQuery, utmTerm: '手动标记（示例）' }),
      ).toMatchObject({
        keyword: '手动标记（示例）',
        evidence: 'utm',
        status: 'available',
      });
    },
  );
  it('keeps missing, unsupported and incomplete evidence separate from empty redirects', () => {
    expect(identifyKeyword({ referrer: 'cn.bing.com', referrerPath: '/' })?.status).toBe('missing');
    expect(
      identifyKeyword({ referrer: 'baidu.com', referrerPath: '/s', referrerQuery: 'wd=' })?.status,
    ).toBe('missing');
    for (const entry of [
      { referrer: 'tieba.baidu.com', referrerPath: '/link', referrerQuery: 'url=opaque' },
      { referrer: 'baidu.com', referrerPath: '/unknown', referrerQuery: 'wd=' },
      { referrer: 'baidu.com', referrerPath: '/link', referrerQuery: 'wd=readable' },
      { referrer: 'baidu.com', referrerPath: '/link', referrerQuery: 'wd=%ZZ' },
    ])
      expect(identifyKeyword(entry)?.status).toBe('unsupported');
    expect(
      identifyKeyword({
        referrer: 'baidu.com',
        referrerPath: '/link',
        referrerQuery: 'url=' + 'x'.repeat(496),
      })?.status,
    ).toBe('incomplete');
    expect(keywordStatusLabels.missing).toBe('来源未携带搜索词');
  });
  it.each([
    ['wd=%C2%A0&ie=gbk', 'unsupported'],
    ['wd=%A1%A1&ie=gbk', 'redirect'],
    ['wd=%C2%A0&ie=utf-8', 'redirect'],
    ['wd=%A1%A1&ie=utf-8', 'unsupported'],
    ['wd=%20&ie=utf-16', 'unsupported'],
    ['wd=&wd=readable', 'unsupported'],
  ])(
    'uses strict declared encoding to establish an empty redirect term: %s',
    (referrerQuery, status) => {
      expect(
        identifyKeyword({ referrer: 'baidu.com', referrerPath: '/link', referrerQuery }),
      ).toMatchObject({ status, keyword: null });
    },
  );
  it.each([
    ['www.baidu.com', '/s', '?wd=%E7%8C%8E%E7%9C%8B', '百度'],
    ['m.baidu.com', '/s', '?word=%E7%8C%8E%E7%9C%8B', '百度'],
    ['www.google.com.hk', '/search', '?q=%E7%8C%8E%E7%9C%8B', 'Google'],
    ['www.google.cn', '/search', '?q=%E7%8C%8E%E7%9C%8B', 'Google'],
    ['cn.bing.com', '/search', '?q=%E7%8C%8E%E7%9C%8B', 'Bing'],
    ['www.sogou.com', '/web', '?query=%E7%8C%8E%E7%9C%8B', '搜狗'],
    ['m.sogou.com', '/websearch', '?keyword=%E7%8C%8E%E7%9C%8B', '搜狗'],
    ['www.so.com', '/s', '?q=%E7%8C%8E%E7%9C%8B', '360'],
    ['duckduckgo.com', '/', '?q=%E7%8C%8E%E7%9C%8B', 'DuckDuckGo'],
    ['search.yahoo.com', '/search', '?p=%E7%8C%8E%E7%9C%8B', 'Yahoo'],
  ])('identifies the approved search URL %s%s', (referrer, referrerPath, referrerQuery, engine) => {
    expect(identifyKeyword({ referrer, referrerPath, referrerQuery })).toEqual({
      engine,
      keyword: '猎看',
      evidence: 'referrer',
      status: 'available',
    });
  });
  it('preserves source precedence, UTM fallback and engine conflicts', () => {
    expect(identifyKeyword({ ...google, utmSource: 'google', utmTerm: 'manual' })?.evidence).toBe(
      'referrer',
    );
    expect(identifyKeyword({ ...google, referrerQuery: null, utmTerm: 'manual' })?.evidence).toBe(
      'utm',
    );
    expect(identifyKeyword({ ...google, utmSource: 'bing' })).toMatchObject({
      engine: 'Bing',
      status: 'conflict',
      keyword: null,
    });
    expect(identifyKeyword({ ...google, utmSource: 'bing', utmTerm: 'bing manual' })).toMatchObject(
      { engine: 'Bing', keyword: 'bing manual', evidence: 'utm' },
    );
  });
  it.each([
    { ...google, utmSource: 'newsletter' },
    { ...google, utmMedium: 'email' },
    { ...google, utmSource: 'google', utmMedium: 'paid_social' },
    { ...google, referrer: 'gemini.google.com' },
    { ...google, referrer: 'google.de' },
    { referrer: 'own.test', referrerPath: '/search', referrerQuery: '?q=onsite' },
    { utmTerm: 'unknown' },
    { referrer: 'google.com.evil.test', referrerQuery: '?q=x' },
  ])('excludes nonsearch, AI, internal and unsupported channel domains: %j', entry =>
    expect(identifyKeyword(entry)).toBeNull(),
  );
  it.each([
    { ...google, referrer: 'mail.google.com' },
    { ...google, referrerPath: '/mail' },
    { referrer: 'tieba.baidu.com', referrerPath: '/s', referrerQuery: '?wd=forum' },
  ])(
    'preserves the existing search-channel population but rejects nonsearch URL evidence %j',
    entry => {
      expect(identifyKeyword(entry)).toMatchObject({ status: 'unsupported', keyword: null });
    },
  );
  it('decodes URL bytes strictly and does not decode collected UTM a second time', () => {
    expect(identifyKeyword({ ...google, referrerQuery: '?q=C%2B%2B+guide' })?.keyword).toBe(
      'C++ guide',
    );
    expect(
      identifyKeyword({
        referrer: 'www.baidu.com',
        referrerPath: '/s',
        referrerQuery: '?wd=%D6%D0%CE%C4',
      })?.keyword,
    ).toBe('中文');
    expect(identifyKeyword({ ...google, referrerQuery: '?q=%ZZ' })?.status).toBe('invalid');
    expect(identifyKeyword({ ...google, referrerQuery: '?q=%D6%D0' })?.status).toBe('invalid');
    expect(identifyKeyword({ utmSource: 'google', utmTerm: 'C++%20guide' })?.keyword).toBe(
      'C++%20guide',
    );
    expect(identifyKeyword({ ...google, referrerQuery: '?q=e%CC%81' })?.keyword).toBe('é');
  });
  it.each([
    ['baidu.com', '/s', 'wd'],
    ['sogou.com', '/web', 'query'],
    ['so.com', '/s', 'q'],
  ])('honors the declared query encoding for %s', (referrer, referrerPath, key) => {
    const entry = { referrer, referrerPath };
    expect(identifyKeyword({ ...entry, referrerQuery: `ie=gbk&${key}=%C2%A9` })).toMatchObject({
      keyword: '漏',
      evidence: 'referrer',
      status: 'available',
    });
    expect(identifyKeyword({ ...entry, referrerQuery: `${key}=%C2%A9&ie=UTF-8` })?.keyword).toBe(
      '©',
    );
    expect(identifyKeyword({ ...entry, referrerQuery: `ie=utf-8&${key}=%E7%8C` })).toMatchObject({
      keyword: null,
      status: 'invalid',
    });
    expect(
      identifyKeyword({ ...entry, referrerQuery: `ie=utf-8&${key}=%E7%8C`, utmTerm: 'manual' }),
    ).toMatchObject({ keyword: 'manual', evidence: 'utm', status: 'available' });
  });
  it('preserves unsupported and conflicting encoding declarations without inventing a term', () => {
    const entry = { referrer: 'baidu.com', referrerPath: '/s' };
    expect(identifyKeyword({ ...entry, referrerQuery: 'ie=utf-8&ie=gbk&wd=%C2%A9' })).toMatchObject(
      { keyword: null, status: 'conflict' },
    );
    expect(identifyKeyword({ ...entry, referrerQuery: 'ie=utf-16&wd=%C2%A9' })).toMatchObject({
      keyword: null,
      status: 'unsupported',
    });
    expect(identifyKeyword({ ...entry, referrerQuery: 'ie=%ZZ&wd=%C2%A9' })).toMatchObject({
      keyword: null,
      status: 'invalid',
    });
    expect(
      identifyKeyword({ ...entry, referrerQuery: 'ie=gbk&ie=GB2312&wd=%C2%A9' })?.keyword,
    ).toBe('漏');
  });
  it('uses a safe UTM fallback when source evidence is redacted while preserving session totals', () => {
    const entry = { ...google, referrerQuery: '?q=person%40example.test', utmTerm: 'manual' };
    expect(identifyKeyword(entry)).toMatchObject({
      keyword: 'manual',
      evidence: 'utm',
      status: 'available',
    });
    const rows = new Map<string, KeywordRow>();
    addKeywordCandidate(rows, { ...entry, sessions: 2, bounces: 1, conversions: 1 });
    const selected = selectKeywords([...rows.values()], keywordConditionsSchema.parse({}), true);
    expect(selected).toMatchObject({ total: 2, referrer: 0, utm: 2, availability: 100 });
    expect(selected.rows).toHaveLength(1);
    expect(selected.rows[0]).toMatchObject({
      keyword: 'manual',
      sessions: 2,
      bounceRate: 50,
      conversionRate: 50,
    });
    expect(identifyKeyword({ ...entry, utmTerm: '' })).toMatchObject({
      keyword: null,
      status: 'redacted',
    });
    expect(identifyKeyword({ ...entry, utmTerm: 'token=synthetic-secret' })).toMatchObject({
      keyword: null,
      status: 'redacted',
    });
  });
  it('detects conflicting duplicates, incomplete storage and absent evidence', () => {
    expect(identifyKeyword({ ...google, referrerQuery: '?q=x&q=y' })?.status).toBe('conflict');
    expect(identifyKeyword({ ...google, referrerQuery: '?q=x&q=x' })?.keyword).toBe('x');
    expect(identifyKeyword({ ...google, referrerQuery: '?q=' + 'x'.repeat(497) })?.status).toBe(
      'incomplete',
    );
    expect(identifyKeyword({ utmSource: 'baidu', utmTerm: 'x'.repeat(255) })?.status).toBe(
      'incomplete',
    );
    expect(identifyKeyword({ ...google, referrerPath: '', referrerQuery: '' })?.status).toBe(
      'missing',
    );
    expect(identifyKeyword({ ...google, referrerQuery: '?q=' })?.status).toBe('missing');
  });
  it('retains valid evidence when unrelated keys are malformed and falls back after duplicate conflicts', () => {
    expect(identifyKeyword({ ...google, referrerQuery: '?q=x&%ZZ=ignored' })?.keyword).toBe('x');
    expect(
      identifyKeyword({ ...google, referrerQuery: '?q=x&q=y', utmTerm: 'manual' }),
    ).toMatchObject({ keyword: 'manual', evidence: 'utm', status: 'available' });
  });
  it.each([
    'person@example.test',
    '192.168.0.1',
    '2001:db8::1',
    'token=123secret',
    '{"password":"synthetic-secret"}',
    "'access_token': 'synthetic-secret'",
    'Bearer veryprivate',
    'sk-abcdefghijklmno',
  ])('redacts recognized private values: %s', term => {
    expect(
      identifyKeyword({ ...google, referrerQuery: '?q=' + encodeURIComponent(term) }),
    ).toMatchObject({ status: 'redacted', keyword: null, evidence: 'none' });
    expect(identifyKeyword({ utmSource: 'google', utmTerm: term })?.status).toBe('redacted');
  });
  it('returns text evidence with safe formula export and ignores unrelated parameters', () => {
    const keyword = identifyKeyword({
      ...google,
      referrerQuery: '?q=%3D1%2B1&token=private',
    })?.keyword;
    expect(keyword).toBe('=1+1');
    expect(safeCsvCell(keyword)).toBe("'=1+1");
    expect(
      identifyKeyword({ ...google, referrerQuery: '?q=%3Cscript%3Ex%3C%2Fscript%3E' })?.keyword,
    ).toBe('<script>x</script>');
  });
});
describe('keyword aggregation and full-population projection', () => {
  it.each([true, false])(
    'keeps saved status-text queries usable after an upgrade (new states: %s)',
    supportsRedirect => {
      const groups = new Map<string, KeywordRow>();
      for (const entry of [
        { referrer: 'cn.bing.com', referrerPath: '/' },
        { referrer: 'baidu.com', referrerPath: '/link', referrerQuery: 'url=opaque&wd=' },
        { referrer: 'tieba.baidu.com', referrerPath: '/s', referrerQuery: 'wd=forum' },
      ])
        addKeywordCandidate(groups, { ...entry, sessions: 1, bounces: 1, conversions: 0 });
      for (const [search, expected] of [
        ['未提供', 1],
        ['来源不支持', 2],
      ] as const) {
        const selected = selectKeywords(
          [...groups.values()],
          keywordConditionsSchema.parse({ search }),
          false,
          supportsRedirect,
        );
        expect(selected.rows.reduce((n, row) => n + row.sessions, 0)).toBe(expected);
        expect(selected.total).toBe(3);
      }
    },
  );
  it('filters the new statuses without changing traffic totals or inventing keywords', () => {
    const groups = new Map<string, KeywordRow>();
    for (const entry of [
      { referrer: 'cn.bing.com', referrerPath: '/' },
      { referrer: 'baidu.com', referrerPath: '/link', referrerQuery: 'url=opaque&wd=' },
      { referrer: 'tieba.baidu.com', referrerPath: '/s', referrerQuery: 'wd=forum' },
    ])
      addKeywordCandidate(groups, { ...entry, sessions: 2, bounces: 1, conversions: 0 });
    const rows = [...groups.values()];
    for (const status of ['missing', 'redirect', 'unsupported']) {
      const selected = selectKeywords(rows, keywordConditionsSchema.parse({ status }), false);
      expect(selected).toMatchObject({ total: 6, referrer: 0, utm: 0, availability: 0 });
      expect(selected.rows).toHaveLength(1);
      expect(selected.rows[0]).toMatchObject({ keyword: null, status, sessions: 2, share: 33.33 });
    }
    expect(
      selectKeywords(rows, keywordConditionsSchema.parse({ search: '跳转链接' }), false).rows[0]
        ?.status,
    ).toBe('redirect');
    expect(
      selectKeywords(rows, keywordConditionsSchema.parse({ search: '来源未携带' }), false).rows[0]
        ?.status,
    ).toBe('missing');
  });
  function rows() {
    const map = new Map<string, KeywordRow>();
    for (let i = 0; i < 45; i++)
      addKeywordCandidate(map, {
        ...google,
        referrerQuery: '?q=word' + String(i).padStart(2, '0'),
        sessions: 1,
        bounces: 1,
        conversions: i % 2,
      });
    addKeywordCandidate(map, { ...google, sessions: 3, bounces: 1, conversions: 1 });
    addKeywordCandidate(map, {
      ...google,
      referrerQuery: null,
      utmTerm: '猎看',
      sessions: 2,
      bounces: 1,
      conversions: 1,
    });
    addKeywordCandidate(map, {
      ...google,
      utmSource: 'bing',
      sessions: 5,
      bounces: 2,
      conversions: 0,
    });
    addKeywordCandidate(map, {
      ...google,
      utmSource: 'bing',
      utmTerm: '猎看',
      sessions: 4,
      bounces: 2,
      conversions: 1,
    });
    return [...map.values()];
  }
  it('conserves every search visit across engines, evidence and quality', () => {
    const all = selectKeywords(rows(), keywordConditionsSchema.parse({}), true);
    expect(all.total).toBe(59);
    expect(all.referrer).toBe(48);
    expect(all.utm).toBe(6);
    expect(
      all.rows.filter(row => row.status !== 'available').reduce((n, r) => n + r.sessions, 0),
    ).toBe(5);
    expect(all.rows.filter(row => row.keyword === '猎看')).toHaveLength(3);
  });
  it('filters and sorts all 45 keywords before paging with stable ties and literal wildcard search', () => {
    const sorted = selectKeywords(
      rows(),
      keywordConditionsSchema.parse({
        engine: 'Google',
        search: 'word',
        sort: 'keyword',
        direction: 'asc',
      }),
      false,
    );
    expect(sorted.rows).toHaveLength(45);
    expect(sorted.rows.slice(20, 40)[0].keyword).toBe('word20');
    expect(new Set(sorted.rows.map(r => r.id)).size).toBe(45);
    expect(sorted.rows[0].conversionRate).toBeNull();
    expect(
      selectKeywords(rows(), keywordConditionsSchema.parse({ search: '%' }), true).rows,
    ).toHaveLength(0);
    expect(
      selectKeywords(rows(), keywordConditionsSchema.parse({ search: '_' }), true).rows,
    ).toHaveLength(0);
    expect(sorted.total).toBe(50);
  });
  it('keeps cards in the engine population when row filters change and distinguishes zero denominator', () => {
    const data = rows();
    const selected = selectKeywords(
      data,
      keywordConditionsSchema.parse({ engine: 'Bing', status: 'conflict' }),
      true,
    );
    expect(selected.total).toBe(9);
    expect(selected.rows).toHaveLength(1);
    expect(selected.availability).toBe(44.44);
    const empty = selectKeywords([], keywordConditionsSchema.parse({}), false);
    expect(empty.availability).toBeNull();
    expect(
      selectKeywords(
        data.filter(r => r.status === 'conflict'),
        keywordConditionsSchema.parse({}),
        true,
      ).availability,
    ).toBe(0);
  });
});
