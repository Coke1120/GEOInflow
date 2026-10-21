// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ pointer: vi.fn(), read: vi.fn(), initialize: vi.fn() }));
vi.mock('./crawler-registry', () => ({
  readCrawlerRegistryPointer: h.pointer,
  readPublishedRegistry: h.read,
  initializeCrawlerRegistry: h.initialize,
}));
import { loadPublishedRegistry, withPublishedRegistry } from './crawler-registry-context';
import { getPublishedCatalog } from '../crawlers/published';
import { getBundledPublishedCatalog } from '../crawlers/catalog-seed';
import { LiekanError } from './errors';

beforeEach(() => vi.clearAllMocks());
describe('immutable request catalog snapshots', () => {
  it('uses the validated bundled catalog during an initial database outage', async () => {
    h.pointer.mockRejectedValue(new Error('unavailable'));
    const result = await loadPublishedRegistry();
    expect(result.version).toBe(getBundledPublishedCatalog().version);
    expect(result.state).toBe('fallback');
    expect(getPublishedCatalog()).toBeUndefined();
  });
  it('separates concurrent requests, reuses nested contexts and pins historical versions', async () => {
    const a = {
      ...getBundledPublishedCatalog(),
      version: randomUUID(),
      revision: '2',
      state: 'published' as const,
    };
    const b = { ...a, version: randomUUID(), revision: '3' };
    h.read.mockImplementation(async version => (version === a.version ? a : b));
    let release: () => void;
    const wait = new Promise<void>(resolve => {
      release = resolve;
    });
    const first = withPublishedRegistry(async () => {
      expect(getPublishedCatalog().version).toBe(a.version);
      await wait;
      await withPublishedRegistry(async () =>
        expect(getPublishedCatalog().version).toBe(a.version),
      );
      await withPublishedRegistry(
        async () => expect(getPublishedCatalog().version).toBe(b.version),
        b.version,
      );
      expect(getPublishedCatalog().version).toBe(a.version);
    }, a.version);
    await withPublishedRegistry(async () => {
      expect(getPublishedCatalog().version).toBe(b.version);
      release();
    }, b.version);
    await first;
    expect(getPublishedCatalog()).toBeUndefined();
    expect(await loadPublishedRegistry(a.version)).toBe(a);
  });
  it('reads only the current pointer after validating a version and falls back as one complete snapshot', async () => {
    const current = {
      ...getBundledPublishedCatalog(),
      version: randomUUID(),
      revision: '8',
      state: 'published' as const,
    };
    h.pointer.mockResolvedValue({ version: current.version, revision: current.revision });
    h.read.mockResolvedValue(current);
    expect(await loadPublishedRegistry()).toBe(current);
    expect(await loadPublishedRegistry()).toBe(current);
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.pointer).toHaveBeenCalledTimes(2);
    h.pointer.mockRejectedValue(new Error('offline'));
    const fallback = await loadPublishedRegistry();
    expect(fallback.version).toBe(current.version);
    expect(fallback.payload).toBe(current.payload);
    expect(fallback.state).toBe('fallback');
    h.read.mockRejectedValue(new Error('offline'));
    await expect(loadPublishedRegistry(randomUUID())).rejects.toMatchObject({ status: 503 });
    h.read.mockRejectedValue(new LiekanError('missing', 404));
    await expect(loadPublishedRegistry(randomUUID())).rejects.toMatchObject({ status: 404 });
  });
});
