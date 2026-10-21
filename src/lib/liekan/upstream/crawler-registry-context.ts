import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import { processSingleton } from './process-singleton';
import { getBundledPublishedCatalog } from '../crawlers/catalog-seed';
import { freezeCatalog } from '../crawlers/catalog-validation';
import { installPublishedCatalogResolver } from '../crawlers/published';
import { LiekanError } from './errors';
import type { PublishedCatalog } from '../contracts/crawler-registry';

const state = processSingleton('crawler-registry-context-v1', () => ({
  contexts: new AsyncLocalStorage<PublishedCatalog>(),
  last: undefined as PublishedCatalog | undefined,
  versions: new Map<string, PublishedCatalog>(),
}));
installPublishedCatalogResolver(() => state.contexts.getStore());
let registryModule: Promise<typeof import('./crawler-registry')> | undefined;
const registryBackend = () => registryModule ??= import('./crawler-registry');
export async function initializeCrawlerRegistry() {
  return (await registryBackend()).initializeCrawlerRegistry();
}

/** A failed read uses one complete validated snapshot and preserves its actual identity. */
export async function loadPublishedRegistry(version?: string): Promise<PublishedCatalog> {
  if (version && !z.uuid().safeParse(version).success) throw new LiekanError('目录版本无效', 400);
  if (version && state.versions.has(version)) return state.versions.get(version);
  try {
    const { readCrawlerRegistryPointer, readPublishedRegistry } = await registryBackend();
    let pointer: { version: string; revision?: string };
    try {
      pointer = version ? { version } : await readCrawlerRegistryPointer();
    } catch (error) {
      if (version || !(error instanceof LiekanError) || error.status !== 404) throw error;
      await initializeCrawlerRegistry();
      pointer = await readCrawlerRegistryPointer();
    }
    const catalog =
      state.versions.get(pointer.version) ?? (await readPublishedRegistry(pointer.version));
    if (pointer.revision && pointer.revision !== catalog.revision)
      throw new Error('Crawler pointer revision mismatch');
    if (!version) state.last = catalog;
    state.versions.delete(catalog.version);
    state.versions.set(catalog.version, catalog);
    if (state.versions.size > 64) state.versions.delete(state.versions.keys().next().value);
    return catalog;
  } catch (error) {
    if (error instanceof LiekanError && [400, 404].includes(error.status)) throw error;
    const seed = getBundledPublishedCatalog();
    const cached = version
      ? (state.versions.get(version) ?? (seed.version === version ? seed : undefined))
      : (state.last ?? seed);
    if (!cached) throw new LiekanError('指定目录版本暂不可用', 503);
    return freezeCatalog({ ...cached, state: 'fallback' as const });
  }
}
/** Nested work inherits one batch snapshot unless it explicitly requests another immutable version. */
export async function withPublishedRegistry<T>(
  work: (catalog: PublishedCatalog) => T | Promise<T>,
  version?: string,
): Promise<T> {
  const existing = state.contexts.getStore();
  if (existing && (!version || existing.version === version)) return work(existing);
  const catalog = await loadPublishedRegistry(version);
  return state.contexts.run(catalog, () => work(catalog));
}
