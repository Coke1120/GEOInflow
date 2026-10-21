import type { PublishedCatalog } from '../contracts/crawler-registry';

const key = Symbol.for('liekan.published-catalog-reader.v1');
type Reader = () => PublishedCatalog | undefined;
const shared = globalThis as typeof globalThis & { [key]?: Reader };

/** Installs a context reader, never an active process-global catalog payload. */
export function installPublishedCatalogResolver(reader: Reader) {
  shared[key] = reader;
}

/** Clients use their delivered catalog; server callers resolve the request's immutable snapshot. */
export function getPublishedCatalog(): PublishedCatalog | undefined {
  return shared[key]?.();
}
