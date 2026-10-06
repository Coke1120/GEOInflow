import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSchema } from 'zod-openapi';
import { operations } from '@/app/api/liekan/websites/[websiteId]/settings/contract';
import { BOT_RULES, classifyBot } from './rules/bots';

type SettingsRow = {
  robots: string;
  allowlist: string[];
  rules: unknown[];
  isDemo: boolean;
  aiCrawlerEnabled?: boolean;
};
const mocks = vi.hoisted(() => ({
  settings: null as SettingsRow | null,
  catalog: new Map<string, Record<string, unknown>>(),
  calls: [] as string[],
  queue: Promise.resolve(),
  parseCatalog: vi.fn(),
  query: vi.fn(),
  transaction: vi.fn(),
  lock: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('./upstream/server', () => ({
  LiekanError: class extends Error {
    constructor(
      message: string,
      public status = 400,
    ) {
      super(message);
    }
  },
  query: mocks.query,
  transaction: mocks.transaction,
  lockWritableWebsite: mocks.lock,
}));
vi.mock('./ingest', async importOriginal => ({
  ...(await importOriginal<typeof import('./ingest')>()),
  parseCatalog: mocks.parseCatalog,
}));

import { getSettings, importCatalog, saveSettings } from './store';

const id = '5b4c0de0-6c47-5b51-8f53-11e5e8c79001';
const identity = { userId: '5b4c0de0-6c47-5b51-8f53-11e5e8c79002' };
const customRule = { name: 'FixtureBot', vendor: 'Fixture', type: '搜索', pattern: 'FixtureBot' };
const catalogColumns: Record<string, string> = {
  title: 'title',
  content_type: 'type',
  word_count: 'wordCount',
  published_at: 'publishedAt',
  structured: 'structured',
  structure_score: 'structureScore',
  content_updated_at: 'updatedAt',
  link_depth: 'linkDepth',
  evidence_source: 'source',
};
const catalogRow = (change = {}) => ({
  path: '/article',
  title: '',
  type: '未分类',
  wordCount: null,
  publishedAt: null,
  structured: null,
  structureScore: null,
  updatedAt: null,
  linkDepth: null,
  source: '用户上传，来源未核验',
  providedFields: [] as string[],
  ...change,
});
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost/test');
  mocks.settings = null;
  mocks.catalog.clear();
  mocks.calls = [];
  mocks.queue = Promise.resolve();
  mocks.lock.mockImplementation(async () => {
    mocks.calls.push('lock');
  });
  const read = async () => {
    mocks.calls.push('read');
    return mocks.settings ? [clone(mocks.settings)] : [];
  };
  mocks.query.mockImplementation(read);
  mocks.execute.mockImplementation(async (sql: string, ...params: unknown[]) => {
    mocks.calls.push('write');
    if (sql.startsWith('INSERT INTO liekan_setting')) {
      mocks.settings = {
        robots: params[1] as string,
        allowlist: JSON.parse(params[2] as string),
        rules: JSON.parse(params[3] as string),
        isDemo: mocks.settings?.isDemo ?? false,
        aiCrawlerEnabled: params[4] as boolean,
      };
    } else if (sql.startsWith('INSERT INTO liekan_catalog')) {
      const rows = JSON.parse(params[1] as string);
      const updates = sql.split('DO UPDATE SET ')[1]?.split(',') ?? [];
      for (const row of rows) {
        const old = mocks.catalog.get(row.path);
        if (!old) mocks.catalog.set(row.path, clone(row));
        else
          for (const update of updates) {
            const column = update.trim().split('=')[0];
            const field = catalogColumns[column];
            if (field) old[field] = row[field];
          }
      }
    }
    return 1;
  });
  // Model the existing website row lock: writers serialize before reading the current settings.
  mocks.transaction.mockImplementation(async work => {
    const previous = mocks.queue;
    let release: () => void;
    mocks.queue = new Promise(resolve => {
      release = resolve;
    });
    await previous;
    try {
      return await work({ $queryRawUnsafe: read, $executeRawUnsafe: mocks.execute });
    } finally {
      release();
    }
  });
});

describe('settings field updates', () => {
  it('defaults crawler display on, persists both choices, and preserves it across concurrent legacy edits', async () => {
    expect((await getSettings(id)).aiCrawlerEnabled).toBe(true);
    await Promise.all([
      saveSettings(id, { aiCrawlerEnabled: false }, identity),
      saveSettings(id, { robots: 'User-agent: *' }, identity),
    ]);
    expect(await getSettings(id)).toMatchObject({
      aiCrawlerEnabled: false,
      robots: 'User-agent: *',
    });
    await saveSettings(id, { aiCrawlerEnabled: true }, identity);
    expect((await getSettings(id)).aiCrawlerEnabled).toBe(true);
  });

  it('rejects non-boolean display preferences in the API contract and store', async () => {
    const schema = operations[1].operation.requestBody.content['application/json'].schema;
    expect(schema.safeParse({ aiCrawlerEnabled: false }).success).toBe(true);
    for (const value of ['false', 0, null, undefined]) {
      expect(schema.safeParse({ aiCrawlerEnabled: value }).success).toBe(false);
      await expect(saveSettings(id, { aiCrawlerEnabled: value }, identity)).rejects.toMatchObject({
        status: 400,
      });
    }
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('publishes partial and legacy full bodies while excluding unknown and read-only fields', () => {
    const schema = operations[1].operation.requestBody.content['application/json'].schema;
    for (const input of [
      { robots: '' },
      { rules: [] },
      { allowlist: [] },
      { robots: '', rules: [], allowlist: [] },
    ])
      expect(schema.safeParse(input).success).toBe(true);
    for (const input of [
      {},
      { robots: undefined },
      { isDemo: false },
      { robots: '', unexpected: '' },
    ])
      expect(schema.safeParse(input).success).toBe(false);
    expect(createSchema(schema).schema).toMatchObject({
      minProperties: 1,
      additionalProperties: false,
    });
  });

  it('uses defaults for an absent row and preserves an explicitly saved empty rule list', async () => {
    expect((await getSettings(id)).rules).toEqual(BOT_RULES);
    await saveSettings(id, { robots: '', allowlist: [], rules: [] }, identity);
    const settings = await getSettings(id);
    expect(settings.rules).toEqual([]);
    expect(classifyBot('GPTBot/1.0', settings.rules)).toMatchObject({ name: '其他', type: '其他' });
    expect(mocks.settings?.rules).toEqual([]);
  });

  it('merges simultaneous edits of separate fields and preserves the protected demo marker', async () => {
    mocks.settings = { robots: '', allowlist: [], rules: BOT_RULES, isDemo: true };
    await Promise.all([
      saveSettings(id, { rules: [customRule] }, identity),
      saveSettings(id, { robots: 'User-agent: *\nDisallow: /private' }, identity),
    ]);
    expect(await getSettings(id)).toEqual({
      robots: 'User-agent: *\nDisallow: /private',
      allowlist: [],
      rules: [customRule],
      isDemo: true,
      aiCrawlerEnabled: true,
      logsConfigured: false,
    });
    expect(mocks.calls.slice(0, 3)).toEqual(['lock', 'read', 'write']);
    expect(mocks.lock).toHaveBeenCalledWith(expect.anything(), id, identity);
  });

  it('initializes unprovided fields on a first partial save and accepts the complete legacy body', async () => {
    const partial = await saveSettings(id.toUpperCase(), { robots: 'User-agent: *' }, identity);
    expect(partial).toMatchObject({ robots: 'User-agent: *', allowlist: [], rules: BOT_RULES });
    const complete = { robots: '', allowlist: ['192.0.2.0/24'], rules: [customRule] };
    expect(await saveSettings(id, complete, identity)).toEqual({
      ...complete,
      isDemo: false,
      aiCrawlerEnabled: true,
      logsConfigured: false,
    });
  });

  it('requires a known field and rejects unknown, protected or invalid fields before writing', async () => {
    for (const input of [
      null,
      [],
      {},
      { isDemo: true },
      { robots: '', allowlist: [], rules: [], isDemo: false },
      { robots: '', allowlist: [], rules: [], unexpected: '' },
      { unexpected: '' },
      { robots: null },
      { allowlist: ['not-a-cidr'] },
      { allowlist: [123] },
      { rules: [null] },
      { rules: [{ ...customRule, type: 'unknown' }] },
    ])
      await expect(saveSettings(id, input, identity)).rejects.toMatchObject({ status: 400 });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

describe('incremental catalog evidence', () => {
  it('preserves enriched metadata when an existing path is reimported as a sitemap URL', async () => {
    const rich = catalogRow({
      title: '文章',
      type: '文章',
      wordCount: 500,
      structured: true,
      structureScore: 75,
      updatedAt: '2026-09-01T00:00:00.000Z',
      linkDepth: 2,
      source: '手动核验',
    });
    mocks.catalog.set(rich.path, rich);
    const expected = clone(rich);
    mocks.parseCatalog.mockReturnValue([catalogRow()]);
    await importCatalog(id, 'example.test', { format: 'sitemap', content: 'fixture' }, identity);
    expect(mocks.catalog.get(rich.path)).toEqual(expected);
  });

  it('updates only provided fields per row, keeps new defaults and supports explicit null clearing', async () => {
    const rich = catalogRow({
      title: '原有标题',
      wordCount: 500,
      structured: true,
      structureScore: 75,
    });
    mocks.catalog.set(rich.path, rich);
    mocks.parseCatalog.mockReturnValue([
      catalogRow({ wordCount: null, providedFields: ['wordCount'] }),
      catalogRow({ path: '/new', title: '新页面', providedFields: ['title'] }),
    ]);
    await importCatalog(id, 'example.test', { format: 'json', content: 'fixture' }, identity);
    expect(mocks.catalog.get('/article')).toMatchObject({
      title: '原有标题',
      wordCount: null,
      structured: true,
      structureScore: 75,
    });
    expect(mocks.catalog.get('/new')).toMatchObject({
      title: '新页面',
      wordCount: null,
      type: '未分类',
    });
    mocks.parseCatalog.mockReturnValue([
      catalogRow({
        structured: null,
        structureScore: null,
        providedFields: ['structured', 'structureScore'],
      }),
    ]);
    await importCatalog(id, 'example.test', { format: 'json', content: 'fixture' }, identity);
    expect(mocks.catalog.get('/article')).toMatchObject({
      title: '原有标题',
      structured: null,
      structureScore: null,
    });
  });
});
