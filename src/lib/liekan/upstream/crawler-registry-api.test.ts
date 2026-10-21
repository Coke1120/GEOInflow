// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn(), load: vi.fn() }));
vi.mock('@/lib/auth', () => ({ checkAuth: h.auth }));
vi.mock('@/lib/db', () => ({ isRelationalOnly: () => true }));
vi.mock('./crawler-ranges', () => ({ rangeSourceHealth: vi.fn() }));
vi.mock('./ai-db', () => ({
  aiTransaction: (work: any) => work({ query: h.query, execute: vi.fn() }),
}));
vi.mock('./crawler-registry-context', () => ({ withPublishedRegistry: async (work: any) => work(await h.load()) }));
vi.mock('@/lib/liekan/http', () => ({
  api: async (work: () => unknown) => {
    try {
      return Response.json(await work(), { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: error.status ?? 500 });
    }
  },
  readBody: (request: Request) => request.json(),
}));
import { GET as read } from '@/app/api/liekan/crawler-registry/route';
import { GET as adminRead, POST as write } from '@/app/api/liekan/admin/crawler-registry/route';
import { getBundledPublishedCatalog } from '../crawlers/catalog-seed';
import { SHARE_CONTEXT_HEADER, SHARE_TOKEN_HEADER } from '@/lib/constants';

const actor = { id: 'a34cc481-2083-47ab-9a88-31459ede8081', role: 'admin' };
const url = 'https://liekan.test/api/liekan/crawler-registry';
beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ authType: 'session', user: actor });
  h.query.mockResolvedValue([{ role: 'admin' }]);
  h.load.mockResolvedValue(getBundledPublishedCatalog());
});
describe('private crawler registry request authorization', () => {
  it.each(['api-key', 'share', 'partial', undefined])(
    'rejects incomplete or non-session identity %s',
    async authType => {
      h.auth.mockResolvedValue({ authType, user: actor });
      expect((await read(new Request(url))).status).toBe(401);
      expect(h.load).not.toHaveBeenCalled();
    },
  );
  it.each([SHARE_CONTEXT_HEADER, SHARE_TOKEN_HEADER])(
    'rejects even stale public context header %s',
    async header => {
      expect((await read(new Request(url, { headers: { [header]: 'stale' } }))).status).toBe(401);
      expect(h.query).not.toHaveBeenCalled();
    },
  );
  it('allows complete readers only the published definitions, with no drafts, health or audit', async () => {
    h.auth.mockResolvedValue({ authType: 'session', user: { ...actor, role: 'view-only' } });
    h.query.mockResolvedValue([{ role: 'view-only' }]);
    const response = await read(new Request(url));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(Object.keys(await response.json()).sort()).toEqual([
      'contentHash',
      'payload',
      'publishedAt',
      'revision',
      'state',
      'version',
    ]);
    expect((await adminRead(new Request(url))).status).toBe(403);
  });
  it('rechecks a deleted account before returning a cached published catalog', async () => {
    h.query.mockResolvedValue([]);
    expect((await read(new Request(url))).status).toBe(401);
    expect(h.load).not.toHaveBeenCalled();
  });
  it('rejects cross-origin mutations before reading a command or opening a transaction', async () => {
    const response = await write(
      new Request(url, { method: 'POST', headers: { Origin: 'https://other.test' }, body: '{}' }),
    );
    expect(response.status).toBe(403);
    expect(h.query).not.toHaveBeenCalled();
  });
  it('passes a historical version only through the safe reader', async () => {
    const version = getBundledPublishedCatalog().version;
    expect(
      (await read(new Request(url, { headers: { 'X-Liekan-Catalog-Version': version } }))).status,
    ).toBe(200);
    expect(h.load).toHaveBeenCalled();
  });
});
