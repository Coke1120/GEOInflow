import { getCrawlerCatalog } from './catalog';
import { createHash } from 'node:crypto';
import { crawlerMetadata } from './catalog-metadata';
import { HELP_REVIEWED_AT } from '../help/types';

export type DocumentSource = {
  id: string;
  url: string;
  label: string;
  names: readonly string[];
  reviewedAt: string;
};

function buildDocumentSources(crawlers: typeof crawlerMetadata) {
  const byUrl = new Map<string, DocumentSource>();
  for (const crawler of crawlers) {
    for (const reference of crawler.sources) {
      const url = new URL(reference.url);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash)
        throw new Error('Invalid fixed crawler document source');
      const existing = byUrl.get(reference.url);
      const reviewedAt = crawler.reviewedAt || HELP_REVIEWED_AT;
      if (existing) {
        existing.names = [...new Set([...existing.names, crawler.name])];
        // A shared page is only as recently reviewed as its oldest catalog entry.
        if (reviewedAt < existing.reviewedAt) existing.reviewedAt = reviewedAt;
      } else {
        byUrl.set(reference.url, {
          id: 'document-' + createHash('sha256').update(reference.url).digest('hex').slice(0, 24),
          url: reference.url,
          label: reference.label,
          names: [crawler.name],
          reviewedAt,
        });
      }
    }
  }
  return Object.freeze(
    [...byUrl.values()].map(source =>
      Object.freeze({ ...source, names: Object.freeze(source.names) }),
    ),
  );
}
export const documentSources: readonly DocumentSource[] = buildDocumentSources(crawlerMetadata);
export const getDocumentSources = (): readonly DocumentSource[] =>
  buildDocumentSources(getCrawlerCatalog().map(entry => entry.metadata));
export const getDocumentJobSeconds = () => Math.ceil(getDocumentSources().length / 2) * 15 + 180;
export const DOCUMENT_REFRESH_MS = 7 * 86400000;
// Two requests at a time, each with a 15-second deadline, plus database/cleanup allowance.
export const DOCUMENT_JOB_SECONDS = Math.ceil(documentSources.length / 2) * 15 + 180;
