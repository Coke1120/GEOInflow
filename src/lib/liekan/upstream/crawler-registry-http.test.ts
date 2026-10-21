// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ pointer: vi.fn(), read: vi.fn() }));
vi.mock('./crawler-registry', () => ({
  readCrawlerRegistryPointer: h.pointer, readPublishedRegistry: h.read,
  initializeCrawlerRegistry: vi.fn(), authorizeCrawlerRegistryReader: vi.fn(),
}));
vi.mock('./crawler-maintenance', () => ({ authenticateCrawlerMaintenance: vi.fn() }));
vi.mock('./server', () => ({ LiekanError: class extends Error { status = 400; } }));
vi.mock('./cache-context', () => ({ withQueryCacheHeaders: (work: () => unknown) => work() }));
import { GET } from '@/app/api/liekan/crawler-registry/route';
import { getBundledPublishedCatalog } from '../crawlers/catalog-seed';

describe('catalog response version binding through the real HTTP wrapper', () => {
  it('returns a single historical snapshot in both body and header', async () => {
    const seed = getBundledPublishedCatalog();
    const old = { ...seed, version: '96074773-f17b-46e9-9af5-b09bca5e4281', revision: '1' };
    const current = { ...seed, version: '96074773-f17b-46e9-9af5-b09bca5e4282', revision: '2' };
    h.pointer.mockResolvedValue(current);
    h.read.mockImplementation(async version => version === old.version ? old : current);
    const response = await GET(new Request('https://site.test/api/liekan/crawler-registry', {
      headers: { 'X-Liekan-Catalog-Version': old.version },
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).version).toBe(old.version);
    expect(response.headers.get('X-Liekan-Catalog-Version')).toBe(old.version);
    expect(h.pointer).not.toHaveBeenCalled();
  });
  it('does not reread the current pointer while an unpinned response is being built', async () => {
    vi.clearAllMocks();
    const seed = getBundledPublishedCatalog();
    const first = { ...seed, version: 'c5ca2348-1fe3-4576-bfab-1524e3c81d77', revision: '4' };
    const next = { ...seed, version: 'c5ca2348-1fe3-4576-bfab-1524e3c81d78', revision: '5' };
    h.pointer.mockResolvedValueOnce(first).mockResolvedValue(next);
    h.read.mockImplementation(async version => version === first.version ? first : next);
    const response = await GET(new Request('https://site.test/api/liekan/crawler-registry'));
    expect((await response.json()).version).toBe(first.version);
    expect(response.headers.get('X-Liekan-Catalog-Version')).toBe(first.version);
    expect(h.pointer).toHaveBeenCalledTimes(1);
  });

});
