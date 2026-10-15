import { crawlerMetadata } from './catalog-metadata';
import { crawlerRegistry } from './registry';

/** Identity owns HTTP tokens and IDs; reviewed help drafts keep their documented robots tokens. */
export const crawlerCatalog = crawlerRegistry.map(identity => {
  const metadata = crawlerMetadata.find(entry => entry.name === identity.name);
  if (!metadata) throw new Error(`Missing crawler metadata: ${identity.id}`);
  return {
    ...identity,
    metadata: {
      ...metadata,
      id: identity.id,
      name: identity.name,
      vendor: identity.vendor,
      token: identity.uaSelector || '',
    },
  };
});
