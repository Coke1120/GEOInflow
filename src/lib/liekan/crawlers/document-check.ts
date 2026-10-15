import { createHash } from 'node:crypto';
import { documentSources, type DocumentSource } from './document-sources';

export type DocumentObservation = {
  hash: string;
  etag?: string | null;
  lastModified?: string | null;
};
export type DocumentCheckResult = {
  status: 'baseline' | 'unchanged' | 'changed';
  hash: string;
  observedAt: string;
  etag: string | null;
  lastModified: string | null;
  notModified: boolean;
};
export type DocumentCheckErrorCode =
  | 'invalid_source'
  | 'invalid_cache'
  | 'not_modified_without_cache'
  | 'http_403'
  | 'http_429'
  | 'http_error'
  | 'redirect_rejected'
  | 'timeout'
  | 'network_error'
  | 'response_too_large'
  | 'empty_document';
export class DocumentCheckError extends Error {
  constructor(readonly code: DocumentCheckErrorCode) {
    super(code);
    this.name = 'DocumentCheckError';
  }
}
export const documentCheckErrorCode = (error: unknown): DocumentCheckErrorCode =>
  error instanceof DocumentCheckError ? error.code : 'network_error';
const fail = (code: DocumentCheckErrorCode): never => {
  throw new DocumentCheckError(code);
};
const MAX_BYTES = 1024 * 1024;
const validator = (value?: string | null) =>
  typeof value === 'string' && /^[\x20-\x7e]{1,1024}$/.test(value) ? value : null;
export const qualifiedDocumentHash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** A bounded, non-executing tokenizer removes volatile page furniture and script bodies. */
export function normalizeDocument(body: string): string {
  const ignored = new Set([
    'script',
    'style',
    'nav',
    'header',
    'footer',
    'template',
    'noscript',
    'svg',
  ]);
  const parts: string[] = [];
  let offset = 0,
    skip: string | null = null,
    depth = 0;
  while (offset < body.length) {
    const next = body.indexOf('<', offset);
    if (next === -1) {
      if (!skip) parts.push(body.slice(offset));
      break;
    }
    if (!skip) parts.push(body.slice(offset, next));
    if (body.startsWith('<!--', next)) {
      const end = body.indexOf('-->', next + 4);
      offset = end === -1 ? body.length : end + 3;
      continue;
    }
    const end = body.indexOf('>', next + 1);
    if (end === -1) break;
    const tag = body.slice(next + 1, end);
    const match = /^\s*(\/?)\s*([a-z][a-z0-9]*)\b/i.exec(tag);
    if (match) {
      const name = match[2].toLowerCase(),
        closing = Boolean(match[1]);
      if (skip) {
        if (name === skip) {
          if (closing) depth--;
          else if (!tag.trimEnd().endsWith('/')) depth++;
          if (depth === 0) skip = null;
        }
      } else if (ignored.has(name) && !closing && !tag.trimEnd().endsWith('/')) {
        skip = name;
        depth = 1;
      } else {
        // Link destinations are part of the documentation evidence; attributes are never executed.
        if (name === 'a' && !closing) {
          const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/i.exec(tag);
          if (href) parts.push(' link:', href[1] ?? href[2] ?? href[3], ' ');
        }
        parts.push(' ');
      }
    }
    offset = end + 1;
  }
  return parts
    .join('')
    .replace(/&(?:nbsp|#160);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
async function readBody(response: Response, signal: AbortSignal) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) return fail('response_too_large');
  if (!response.body) return fail('empty_document');
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) return fail('timeout');
      const { done, value } = await reader.read();
      if (signal.aborted) return fail('timeout');
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) return fail('response_too_large');
      chunks.push(value);
    }
    const normalized = normalizeDocument(Buffer.concat(chunks).toString('utf8'));
    if (!normalized) return fail('empty_document');
    return createHash('sha256').update(normalized).digest('hex');
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
  }
}

export async function checkDocumentSource(
  source: DocumentSource,
  previous?: DocumentObservation,
  options: { fetcher?: typeof fetch; now?: () => Date } = {},
): Promise<DocumentCheckResult> {
  const fixed = documentSources.find(entry => entry.id === source?.id);
  if (!fixed || JSON.stringify(fixed) !== JSON.stringify(source)) return fail('invalid_source');
  if (previous && !qualifiedDocumentHash(previous.hash)) return fail('invalid_cache');
  previous = previous ? { ...previous } : undefined;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new DocumentCheckError('timeout'));
      controller.abort();
    }, 15000);
  });
  const headers: Record<string, string> = {
    'User-Agent': 'Liekan/0.2.4 (+https://www.liekan.com; crawler-source-check)',
    Accept: 'text/html,text/plain;q=0.9',
  };
  const etag = validator(previous?.etag),
    lastModified = validator(previous?.lastModified);
  if (etag) headers['If-None-Match'] = etag;
  if (lastModified) headers['If-Modified-Since'] = lastModified;
  let response: Response | undefined;
  try {
    return await Promise.race([
      deadline,
      (async (): Promise<DocumentCheckResult> => {
        response = await (options.fetcher || fetch)(fixed.url, {
          headers,
          redirect: 'error',
          signal: controller.signal,
        });
        if (
          response.redirected ||
          (response.status >= 300 && response.status < 400 && response.status !== 304)
        )
          return fail('redirect_rejected');
        if (response.status === 304 && !previous) return fail('not_modified_without_cache');
        if (![200, 304].includes(response.status))
          return fail(
            response.status === 403
              ? 'http_403'
              : response.status === 429
                ? 'http_429'
                : 'http_error',
          );
        const hash =
          response.status === 304 ? previous!.hash : await readBody(response, controller.signal);
        return {
          status: !previous ? 'baseline' : hash === previous.hash ? 'unchanged' : 'changed',
          hash,
          observedAt: (options.now?.() || new Date()).toISOString(),
          notModified: response.status === 304,
          etag: validator(response.headers.get('etag')) || (response.status === 304 ? etag : null),
          lastModified:
            validator(response.headers.get('last-modified')) ||
            (response.status === 304 ? lastModified : null),
        };
      })(),
    ]);
  } catch (error) {
    if (error instanceof DocumentCheckError) throw error;
    return fail(controller.signal.aborted ? 'timeout' : 'network_error');
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
  }
}
