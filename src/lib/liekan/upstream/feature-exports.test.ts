import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import Papa from 'papaparse';
const state = vi.hoisted(() => ({ rows: 2501, mode: 'rows', calls: [] as number[] }));
vi.mock('@/lib/prisma', () => ({
  getRawQueryClient: (client: any) => client,
  default: {
    client: {
      $transaction: vi.fn(async (work: any) =>
        work({ $executeRawUnsafe: () => {}, $queryRawUnsafe: () => {} }),
      ),
    },
    parseFilters: () => ({
      filterQuery: '',
      joinSessionQuery: '',
      cohortQuery: '',
      excludeBounceQuery: '',
      queryParams: {},
    }),
    rawQuery: vi.fn(async (_sql: string, p: any) => {
      state.calls.push(p.offset);
      return Array.from({ length: Math.min(1000, Math.max(0, state.rows - p.offset)) }, (_, i) => ({
        id: `real-id-${p.offset + i}`,
        browser: '=formula()',
        country: 'CN',
        field: state.mode === 'bytes' ? 'x'.repeat(60000) : undefined,
      }));
    }),
  },
}));
vi.mock('@/lib/request', () => ({ getQueryFilters: () => ({}) }));
vi.mock('@/queries/sql', () => ({ getWebsiteStats: () => ({ pageviews: 5n, visitors: 2n }) }));
vi.mock('@/queries/prisma', () => ({ getWebsiteSegment: () => null }));
vi.mock('./server', () => ({
  LiekanError: class extends Error {
    constructor(
      message: string,
      public status = 400,
    ) {
      super(message);
    }
  },
}));
import prisma from '@/lib/prisma';
import { prepareFeatureExport } from './feature-exports';
const website = { id: 'site', name: 'Example', domain: 'example.test' },
  input = { startAt: 0, endAt: 100, format: 'zip', sections: ['sessions'] };
describe('complete bounded export', () => {
  beforeEach(() => {
    state.rows = 2501;
    state.mode = 'rows';
    state.calls = [];
    delete process.env.CLICKHOUSE_URL;
  });
  it('exports every page, masks identities and escapes formulas in the real ZIP', async () => {
    const response = await prepareFeatureExport(website, input, new AbortController().signal);
    const frames = (await response.text())
      .trim()
      .split('\n')
      .map(s => JSON.parse(s));
    expect(frames.at(-1).type).toBe('complete');
    expect(state.calls).toEqual([0, 1000, 2000]);
    expect(prisma.client.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
      maxWait: 10000,
      timeout: 120000,
    });
    const file = Buffer.concat(
      frames.filter(f => f.type === 'chunk').map(f => Buffer.from(f.data, 'base64')),
    );
    const zip = await JSZip.loadAsync(file);
    const csv = await zip.file('sessions.csv').async('string');
    expect(csv.split('\r\n')).toHaveLength(2502);
    expect(csv).toContain('visitor-');
    expect(csv).not.toContain('real-id-');
    expect(csv).toContain("'=formula()");
    expect(JSON.parse(await zip.file('manifest.json').async('string')).files[0].rows).toBe(2501);
  });
  it('rejects row and byte overflow with 413 before streaming', async () => {
    state.rows = 100001;
    await expect(
      prepareFeatureExport(website, input, new AbortController().signal),
    ).rejects.toMatchObject({ status: 413 });
    state.rows = 5000;
    state.mode = 'bytes';
    state.calls = [];
    await expect(
      prepareFeatureExport(website, input, new AbortController().signal),
    ).rejects.toMatchObject({ status: 413 });
    expect(state.calls).toEqual([0]);
  });
  it('dimension visitors use the same pageview scope as the summary', async () => {
    state.rows = 1;
    await prepareFeatureExport(
      website,
      { ...input, sections: ['dimensions'] },
      new AbortController().signal,
    );
    const queries = vi.mocked(prisma.rawQuery).mock.calls.map(c => c[0]);
    for (const sql of queries.filter(q => /AS visitors/.test(q) && /JOIN session/.test(q)))
      expect(sql).toContain('WHERE s.event_type=1');
  });
  it('honors cancellation and rejects cross-site saved filters', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(prepareFeatureExport(website, input, controller.signal)).rejects.toMatchObject({
      status: 499,
    });
    await expect(
      prepareFeatureExport(
        website,
        { ...input, filters: { segment: 'foreign' } },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('localizes English CSV headers and country values while retaining machine field keys and anonymization', async () => {
    state.rows = 1;
    const response = await prepareFeatureExport(
      website,
      { ...input, locale: 'en-US' },
      new AbortController().signal,
    );
    const frames = (await response.text())
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    expect(frames.at(-1).type).toBe('complete');
    const zip = await JSZip.loadAsync(
      Buffer.concat(frames.filter(f => f.type === 'chunk').map(f => Buffer.from(f.data, 'base64'))),
    );
    const csv = await zip.file('sessions.csv').async('string');
    const rows = Papa.parse(csv, { header: true }).data as Record<string, string>[];
    expect(rows[0]['Country / region']).toBe('China');
    expect(rows[0].Browser).toBe("'=formula()");
    expect(rows[0]['Visitor ID']).toMatch(/^visitor-/);
    expect(csv).not.toContain('real-id-');
    const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    expect(manifest.files[0].fields).toEqual(['id', 'browser', 'country']);
    expect(manifest.files[0].displayFields).toEqual(['Visitor ID', 'Browser', 'Country / region']);
    expect(manifest.privacy).toContain('Raw IP addresses');
  });

  it('retains exact omitted-locale CSV and machine JSON output for an English request', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T00:00:00Z'));
    try {
      const read = async (format: string, locale?: string) => {
        const response = await prepareFeatureExport(
          website,
          { startAt: 0, endAt: 100, format, sections: ['summary'], ...(locale ? { locale } : {}) },
          new AbortController().signal,
        );
        const frames = (await response.text())
          .trim()
          .split('\n')
          .map(line => JSON.parse(line));
        expect(frames.at(-1).type).toBe('complete');
        return Buffer.concat(
          frames.filter(f => f.type === 'chunk').map(f => Buffer.from(f.data, 'base64')),
        ).toString();
      };
      expect(await read('csv', 'zh-CN')).toBe(await read('csv'));
      expect(await read('csv')).toBe('pageviews,visitors\r\n5,2');
      expect(await read('csv', 'en-US')).toBe('Pageviews,Visitors\r\n5,2');
      const original = await read('json');
      expect(await read('json', 'en-US')).toBe(original);
      expect(JSON.parse(original).summary).toEqual({ pageviews: 5, visitors: 2 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('translates known device enums and preserves unknown enums and visitor-supplied browser labels', async () => {
    vi.mocked(prisma.rawQuery).mockResolvedValueOnce([
      { id: 'first', browser: '城市', device: 'constructor', country: 'XX' },
      { id: 'second', browser: '浏览器原名', device: 'mobile', country: 'CN' },
    ]);
    const response = await prepareFeatureExport(
      website,
      { ...input, locale: 'en-US' },
      new AbortController().signal,
    );
    const frames = (await response.text())
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    const zip = await JSZip.loadAsync(
      Buffer.concat(frames.filter(f => f.type === 'chunk').map(f => Buffer.from(f.data, 'base64'))),
    );
    const rows = Papa.parse(await zip.file('sessions.csv').async('string'), { header: true })
      .data as Record<string, string>[];
    expect(rows[0]).toMatchObject({
      Browser: '城市',
      Device: 'constructor',
      'Country / region': 'XX',
    });
    expect(rows[1]).toMatchObject({
      Browser: '浏览器原名',
      Device: 'Mobile',
      'Country / region': 'China',
    });
  });

  it('keeps saved JSON configuration and user-owned content unchanged in an English ZIP', async () => {
    const reports = [
      {
        name: '城市',
        type: 'goal',
        parameters: { value: '来源未携带搜索词', apiKey: 'synthetic-secret' },
      },
    ];
    vi.mocked(prisma.rawQuery)
      .mockResolvedValueOnce([{ bytes: 0 }])
      .mockResolvedValueOnce(reports)
      .mockResolvedValueOnce([]);
    const response = await prepareFeatureExport(
      website,
      { ...input, sections: ['config'], locale: 'en-US' },
      new AbortController().signal,
    );
    const frames = (await response.text())
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    expect(frames.at(-1).type).toBe('complete');
    const zip = await JSZip.loadAsync(
      Buffer.concat(frames.filter(f => f.type === 'chunk').map(f => Buffer.from(f.data, 'base64'))),
    );
    const saved = await zip.file('saved-reports.json').async('string');
    expect(JSON.parse(saved)).toEqual([
      { name: '城市', type: 'goal', parameters: { value: '来源未携带搜索词', apiKey: '[已脱敏]' } },
    ]);
    expect(saved).not.toContain('synthetic-secret');
    expect(JSON.parse(await zip.file('configuration.json').async('string'))).toEqual([
      { website: { name: 'Example', domain: 'example.test' } },
    ]);
  });
});
