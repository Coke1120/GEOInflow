// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { isbot } from 'isbot';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ pointer: vi.fn(), read: vi.fn(), initialize: vi.fn() }));
vi.mock('./crawler-registry', () => ({
  readCrawlerRegistryPointer: h.pointer,
  readPublishedRegistry: h.read,
  initializeCrawlerRegistry: h.initialize,
}));
import {
  collectionRegistryIsCurrent,
  loadPublishedRegistry,
  withPublishedRegistry,
} from './crawler-registry-context';
import { getPublishedCatalog } from '../crawlers/published';
import { getBundledPublishedCatalog } from '../crawlers/catalog-seed';
import { LiekanError } from './errors';
import { classifyCollection } from './collection-quality';

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());
describe('immutable request catalog snapshots', () => {
  it('uses the validated bundled catalog during an initial database outage', async () => {
    h.pointer.mockRejectedValue(new Error('unavailable'));
    const result = await loadPublishedRegistry();
    expect(result.version).toBe(getBundledPublishedCatalog().version);
    expect(result.state).toBe('fallback');
    expect(getPublishedCatalog()).toBeUndefined();
    await withPublishedRegistry(() => expect(collectionRegistryIsCurrent()).toBe(false));
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

let revision = 100;
const currentCatalog = () => ({
  ...getBundledPublishedCatalog(),
  version: randomUUID(),
  revision: String(++revision),
  state: 'published' as const,
});
const useCurrent = (catalog: ReturnType<typeof currentCatalog>) => {
  h.pointer.mockResolvedValue({ version: catalog.version, revision: catalog.revision });
  h.read.mockResolvedValue(catalog);
};

describe('current browser exclusion authority', () => {
  it('bounds fallback authority to sixty seconds without extending it on failed reads', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-10-23T12:00:00Z');
    const catalog = currentCatalog();
    useCurrent(catalog);
    await withPublishedRegistry(() => expect(collectionRegistryIsCurrent()).toBe(true));
    h.pointer.mockRejectedValue(new Error('offline'));
    vi.advanceTimersByTime(59999);
    await withPublishedRegistry(value => {
      expect(value.version).toBe(catalog.version);
      expect(value.state).toBe('fallback');
      expect(collectionRegistryIsCurrent()).toBe(true);
    });
    vi.advanceTimersByTime(1);
    await withPublishedRegistry(value => {
      expect(value.version).toBe(catalog.version);
      expect(collectionRegistryIsCurrent()).toBe(false);
    });
    vi.advanceTimersByTime(10000);
    await withPublishedRegistry(() => expect(collectionRegistryIsCurrent()).toBe(false));
    useCurrent(catalog);
    await withPublishedRegistry(() => expect(collectionRegistryIsCurrent()).toBe(true));
  });

  it('immediately invalidates an older current catalog when a new pointer is known but unreadable', async () => {
    const previous = currentCatalog();
    const next = currentCatalog();
    useCurrent(previous);
    await withPublishedRegistry(async () => {
      expect(collectionRegistryIsCurrent()).toBe(true);
      h.pointer.mockResolvedValue({ version: next.version, revision: next.revision });
      h.read.mockRejectedValue(new Error('new catalog unavailable'));
      const fallback = await loadPublishedRegistry();
      expect(fallback.version).toBe(previous.version);
      expect(collectionRegistryIsCurrent()).toBe(false);
      await withPublishedRegistry(() => expect(collectionRegistryIsCurrent()).toBe(false));
    });
    expect((await loadPublishedRegistry(previous.version)).version).toBe(previous.version);
  });

  it('preserves explicit historical replay without granting current intake authority', async () => {
    const catalog = currentCatalog();
    useCurrent(catalog);
    await withPublishedRegistry(async () => {
      expect(collectionRegistryIsCurrent()).toBe(true);
      await withPublishedRegistry(
        () => expect(collectionRegistryIsCurrent()).toBe(false),
        catalog.version,
      );
      expect(collectionRegistryIsCurrent()).toBe(true);
    });
    await withPublishedRegistry(value => {
      expect(value.version).toBe(catalog.version);
      expect(collectionRegistryIsCurrent()).toBe(false);
    }, catalog.version);
    expect(collectionRegistryIsCurrent()).toBe(false);
  });

  it('revokes immediately when the pointer is deleted and initialization fails', async () => {
    const catalog = currentCatalog();
    useCurrent(catalog);
    await withPublishedRegistry(async () => {
      expect(collectionRegistryIsCurrent()).toBe(true);
      h.pointer.mockRejectedValue(new LiekanError('missing', 404));
      h.initialize.mockRejectedValue(new Error('offline'));
      await loadPublishedRegistry();
      expect(collectionRegistryIsCurrent()).toBe(false);
    });
  });

  it('does not restore old authority when a delayed pointer read arrives after a newer revision', async () => {
    const old = currentCatalog();
    const latest = currentCatalog();
    let resolve: (value: { version: string; revision: string }) => void;
    h.pointer.mockReturnValueOnce(
      new Promise(done => {
        resolve = done;
      }),
    );
    h.read.mockImplementation(async version => (version === old.version ? old : latest));
    const pending = withPublishedRegistry(() => expect(collectionRegistryIsCurrent()).toBe(false));
    // registryBackend resumes before the first mocked pointer call is made.
    await Promise.resolve();
    await Promise.resolve();
    h.pointer.mockResolvedValue({ version: latest.version, revision: latest.revision });
    await withPublishedRegistry(() => expect(collectionRegistryIsCurrent()).toBe(true));
    resolve({ version: old.version, revision: old.revision });
    await pending;
    await withPublishedRegistry(() => expect(collectionRegistryIsCurrent()).toBe(true));
  });
});

const browserUa =
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
function intakeQuality(userAgent = `${browserUa} Kimi-User/1.0`) {
  return classifyCollection({
    request: new Request('https://collector.test/api/send', {
      headers: { 'user-agent': browserUa },
    }),
    payload: {},
    authenticated: false,
    ip: '',
    userAgent,
    snapshots: {},
    receivedAt: new Date(),
  });
}

it('applies the sixty-second lease and historical isolation to dynamic intake UA tokens', async () => {
  vi.useFakeTimers();
  vi.setSystemTime('2026-10-23T12:00:00Z');
  expect(isbot(`${browserUa} Kimi-User/1.0`)).toBe(false);
  const catalog = currentCatalog();
  useCurrent(catalog);
  await withPublishedRegistry(() => expect(intakeQuality().reasons).toEqual(['crawler_ua_token']));
  h.pointer.mockRejectedValue(new Error('offline'));
  vi.advanceTimersByTime(59999);
  await withPublishedRegistry(() => expect(intakeQuality().classification).toBe('automated'));
  vi.advanceTimersByTime(1);
  await withPublishedRegistry(() => {
    expect(intakeQuality()).toMatchObject({
      classification: 'browser',
      reasons: ['browser_compatible'],
    });
    expect(intakeQuality('YisouSpider')).toMatchObject({
      classification: 'automated',
      reasons: ['ua_bot'],
    });
  });
  useCurrent(catalog);
  await withPublishedRegistry(() => expect(intakeQuality().classification).toBe('automated'));
  await withPublishedRegistry(() => {
    expect(intakeQuality()).toMatchObject({
      classification: 'browser',
      reasons: ['browser_compatible'],
    });
  }, catalog.version);
});

it('keeps pointer deletion revoked when an earlier successful pointer read arrives late', async () => {
  const catalog = currentCatalog();
  useCurrent(catalog);
  await withPublishedRegistry(async () => {
    expect(collectionRegistryIsCurrent()).toBe(true);
    let resolve: (value: { version: string; revision: string }) => void;
    h.pointer.mockReturnValueOnce(
      new Promise(done => {
        resolve = done;
      }),
    );
    const pending = loadPublishedRegistry();
    await Promise.resolve();
    await Promise.resolve();
    h.pointer.mockRejectedValue(new LiekanError('missing', 404));
    h.initialize.mockRejectedValue(new Error('offline'));
    await loadPublishedRegistry();
    expect(collectionRegistryIsCurrent()).toBe(false);
    resolve({ version: catalog.version, revision: catalog.revision });
    await pending;
    expect(collectionRegistryIsCurrent()).toBe(false);
    expect(intakeQuality().classification).toBe('browser');
    useCurrent(catalog);
    await loadPublishedRegistry();
    expect(collectionRegistryIsCurrent()).toBe(false);
  });
  // A new successfully observed current pointer can establish a new lease.
  useCurrent(catalog);
  await withPublishedRegistry(() => expect(collectionRegistryIsCurrent()).toBe(true));
});
