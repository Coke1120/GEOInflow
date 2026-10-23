// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
const h = vi.hoisted(() => ({ read: vi.fn(), authorized: vi.fn(() => true) }));
vi.mock('../log-ingestion/ranges', () => ({ verificationSnapshots: h.read }));
vi.mock('./crawler-registry-context', () => ({ collectionRegistryIsCurrent: h.authorized }));
import { collectionSnapshots } from './collection-snapshots';
import { getBundledPublishedCatalog } from '../crawlers/catalog-seed';
import { installPublishedCatalogResolver } from '../crawlers/published';

const now = new Date('2026-10-23T12:00:00Z');
let catalog: ReturnType<typeof getBundledPublishedCatalog>;
const snapshot = () => ({
  GPTBot: {
    prefixes: ['192.0.2.0/24'],
    retrievedAt: now.toISOString(),
    version: 'fixture-v1',
    source: 'https://openai.com/gptbot.json',
  },
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.resetAllMocks();
  h.authorized.mockReturnValue(true);
  catalog = structuredClone(getBundledPublishedCatalog());
  catalog.version = randomUUID();
  installPublishedCatalogResolver(() => catalog);
});
afterEach(() => {
  vi.useRealTimers();
  installPublishedCatalogResolver(() => undefined);
});

describe('collection snapshot cache', () => {
  it('shares one read for a minute and refreshes without a remote request', async () => {
    const remote = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('remote prohibited'));
    h.read.mockResolvedValue(snapshot());
    expect(await collectionSnapshots()).toEqual(snapshot());
    expect(await collectionSnapshots()).toEqual(snapshot());
    expect(h.read).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60000);
    await collectionSnapshots();
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(remote).not.toHaveBeenCalled();
    remote.mockRestore();
  });

  it('retains compatible fresh last success through transient read failures', async () => {
    h.read.mockResolvedValueOnce(snapshot()).mockRejectedValue(new Error('temporary read failure'));
    expect(await collectionSnapshots()).toEqual(snapshot());
    vi.advanceTimersByTime(60000);
    expect(await collectionSnapshots()).toEqual(snapshot());
    vi.advanceTimersByTime(5001);
    expect(await collectionSnapshots()).toEqual(snapshot());
    expect(h.read).toHaveBeenCalledTimes(3);
  });

  it('expires a last success exactly beyond its seven-day observation lifetime', async () => {
    h.read.mockResolvedValueOnce(snapshot()).mockRejectedValue(new Error('offline'));
    await collectionSnapshots();
    vi.advanceTimersByTime(7 * 86400000);
    expect(await collectionSnapshots()).toEqual(snapshot());
    vi.advanceTimersByTime(1);
    expect(await collectionSnapshots()).toEqual({});
  });

  it.each(['version', 'url', 'parserVersion', 'browserExclusion', 'enabled', 'identity'])(
    'never reuses cached ranges after %s authority changes',
    async field => {
      h.read.mockResolvedValueOnce(snapshot()).mockRejectedValue(new Error('offline'));
      expect(await collectionSnapshots()).toEqual(snapshot());
      const source = catalog.payload.rangeSources.find(source => source.id === 'openai-gpt')!;
      if (field === 'version') catalog.version = randomUUID();
      if (field === 'url') source.url = 'https://openai.com/reviewed-gptbot-v2.json';
      if (field === 'parserVersion') source.parserVersion = 'manual-reviewed-v1';
      if (field === 'browserExclusion') source.browserExclusion = 'unsupported';
      if (field === 'enabled') source.enabled = false;
      if (field === 'identity')
        catalog.payload.identities.find(item => item.id === 'gptbot')!.status = 'inactive';
      expect(await collectionSnapshots()).toEqual({});
    },
  );

  it('revokes cached and in-flight values immediately when current authority is lost', async () => {
    let resolve: (value: ReturnType<typeof snapshot>) => void;
    h.read.mockReturnValue(
      new Promise(done => {
        resolve = done;
      }),
    );
    const pending = collectionSnapshots();
    h.authorized.mockReturnValue(false);
    resolve(snapshot());
    expect(await pending).toEqual({});
    expect(await collectionSnapshots()).toEqual({});
    expect(h.read).toHaveBeenCalledTimes(1);
  });

  it('does not resurrect ranges after an authoritative empty read', async () => {
    h.read
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce({})
      .mockRejectedValue(new Error('offline'));
    await collectionSnapshots();
    vi.advanceTimersByTime(60000);
    expect(await collectionSnapshots()).toEqual({});
    vi.advanceTimersByTime(60000);
    expect(await collectionSnapshots()).toEqual({});
  });

  it('rejects an unreviewed source, future observation and shared-cloud approval', async () => {
    const bad = snapshot();
    bad.GPTBot.source = 'https://unreviewed.example/ranges';
    h.read.mockResolvedValueOnce(bad);
    expect(await collectionSnapshots()).toEqual({});
    vi.advanceTimersByTime(60000);
    h.read.mockResolvedValueOnce({
      GPTBot: { ...snapshot().GPTBot, retrievedAt: new Date(+now + 120000).toISOString() },
    });
    expect(await collectionSnapshots()).toEqual({});
    vi.advanceTimersByTime(60000);
    catalog.payload.rangeSources.find(source => source.id === 'openai-gpt')!.browserExclusion =
      'unsupported';
    h.read.mockResolvedValueOnce(snapshot());
    expect(await collectionSnapshots()).toEqual({});
  });
});
