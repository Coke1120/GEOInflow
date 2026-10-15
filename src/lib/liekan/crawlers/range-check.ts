import { createHash } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import bundled from '../../../../config/liekan/crawler-range-baselines.json';
import { type RangeSource, rangeSources } from './range-sources';

export type RangeContent = {
  version: string;
  sourceId: string;
  sourceUrl: string;
  parserVersion: string;
  names: string[];
  crawlerIds: string[];
  prefixes: string[];
  publishedAt: string | null;
};
export type RangeObservation = {
  content: RangeContent;
  observedAt: string;
  etag?: string | null;
  lastModified?: string | null;
};
export type RangeCheckResult = {
  status: 'ok' | 'unchanged' | 'candidate';
  content: RangeContent;
  observedAt: string;
  etag: string | null;
  lastModified: string | null;
  notModified: boolean;
  candidateReason: string | null;
  change: { added: number; removed: number; oldCount: number };
};
export type RangeCheckErrorCode =
  | 'missing_baseline'
  | 'invalid_source'
  | 'invalid_cache'
  | 'invalid_timestamp'
  | 'not_modified_without_cache'
  | 'http_403'
  | 'http_429'
  | 'http_error'
  | 'redirect_rejected'
  | 'timeout'
  | 'network_error'
  | 'response_too_large'
  | 'invalid_json'
  | 'invalid_shape'
  | 'empty_prefixes'
  | 'too_many_prefixes'
  | 'invalid_cidr'
  | 'non_public_cidr';

/** Errors expose stable codes only; upstream bodies and network messages stay private. */
export class RangeCheckError extends Error {
  constructor(readonly code: RangeCheckErrorCode) {
    super(code);
    this.name = 'RangeCheckError';
  }
}
export function rangeCheckErrorCode(error: unknown): RangeCheckErrorCode {
  return error instanceof RangeCheckError ? error.code : 'network_error';
}
const fail = (code: RangeCheckErrorCode): never => {
  throw new RangeCheckError(code);
};
const MAX_BYTES = 1024 * 1024;
const MAX_PREFIXES = 5000;
const TIMEOUT_MS = 15_000;
const USER_AGENT = 'Liekan/0.2.4 (+https://www.liekan.com; crawler-source-check)';
type Network = { prefix: string; family: 4 | 6; start: bigint; end: bigint; bits: number };

function parseNetwork(value: unknown): Network {
  if (typeof value !== 'string') return fail('invalid_cidr');
  const match = /^([^/]+)\/(0|[1-9]\d{0,2})$/.exec(value);
  if (!match) return fail('invalid_cidr');
  const address = match[1];
  const family = address.includes(':') ? 6 : 4;
  if (
    (family === 4 && !/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(address)) ||
    (family === 6 && !/^[0-9a-fA-F:]+$/.test(address))
  )
    return fail('invalid_cidr');
  try {
    const parsed = ipaddr.parse(address);
    const width = family === 4 ? 32 : 128;
    const bits = Number(match[2]);
    if (bits > width || parsed.kind() !== (family === 4 ? 'ipv4' : 'ipv6')) {
      return fail('invalid_cidr');
    }
    const size = 1n << BigInt(width - bits);
    const numeric = parsed
      .toByteArray()
      .reduce((number, byte) => (number << 8n) | BigInt(byte), 0n);
    const start = (numeric / size) * size;
    const bytes = Array.from({ length: width / 8 }, (_, i) =>
      Number((start >> BigInt(width - 8 * (i + 1))) & 255n),
    );
    return {
      prefix: `${ipaddr.fromByteArray(bytes).toString()}/${bits}`,
      family,
      start,
      end: start + size - 1n,
      bits,
    };
  } catch (error) {
    if (error instanceof RangeCheckError) throw error;
    return fail('invalid_cidr');
  }
}

// Special-purpose ranges are excluded as whole intervals, including enclosing CIDRs.
const excluded = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.31.196.0/24',
  '192.52.193.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '192.175.48.0/24',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '2001::/23',
  '2001:db8::/32',
  '2002::/16',
  '2620:4f:8000::/48',
  '3ffe::/16',
  '3fff::/20',
].map(parseNetwork);
const globalV6 = parseNetwork('2000::/3');
function publicNetwork(value: unknown): Network {
  const network = parseNetwork(value);
  if (
    network.bits === 0 ||
    (network.family === 6 && (network.start < globalV6.start || network.end > globalV6.end)) ||
    excluded.some(
      block =>
        block.family === network.family && network.start <= block.end && network.end >= block.start,
    )
  )
    return fail('non_public_cidr');
  return network;
}
function normalizePrefixes(values: unknown): string[] {
  if (!Array.isArray(values)) return fail('invalid_shape');
  if (!values.length) return fail('empty_prefixes');
  if (values.length > MAX_PREFIXES) return fail('too_many_prefixes');
  const networks = values.map(publicNetwork);
  networks.sort(
    (a, b) =>
      a.family - b.family || (a.start < b.start ? -1 : a.start > b.start ? 1 : a.bits - b.bits),
  );
  return [...new Set(networks.map(network => network.prefix))];
}
function equalStrings(left: unknown, right: readonly string[]): boolean {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, i) => value === right[i])
  );
}
function sameSource(source: RangeSource): boolean {
  const fixed = rangeSources.find(entry => entry.id === source?.id);
  return (
    !!fixed &&
    source.url === fixed.url &&
    source.parserVersion === fixed.parserVersion &&
    source.reviewedAt === fixed.reviewedAt &&
    equalStrings(source.names, fixed.names) &&
    equalStrings(source.crawlerIds, fixed.crawlerIds)
  );
}
function versionFor(source: RangeSource, prefixes: string[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        sourceId: source.id,
        sourceUrl: source.url,
        parserVersion: source.parserVersion,
        names: source.names,
        crawlerIds: source.crawlerIds,
        prefixes,
      }),
    )
    .digest('hex');
}
function freezeContent(content: RangeContent): RangeContent {
  Object.freeze(content.prefixes);
  Object.freeze(content.names);
  Object.freeze(content.crawlerIds);
  return Object.freeze(content);
}
function contentFor(
  source: RangeSource,
  values: unknown,
  publishedAt: string | null,
): RangeContent {
  const prefixes = normalizePrefixes(values);
  return freezeContent({
    version: versionFor(source, prefixes),
    sourceId: source.id,
    sourceUrl: source.url,
    parserVersion: source.parserVersion,
    names: [...source.names],
    crawlerIds: [...source.crawlerIds],
    prefixes,
    publishedAt,
  });
}
function timestamp(value: unknown): number {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)
  )
    return NaN;
  const local = Date.parse(`${value.slice(0, 19)}Z`);
  if (!Number.isFinite(local) || new Date(local).toISOString().slice(0, 19) !== value.slice(0, 19))
    return NaN;
  return Date.parse(value);
}
function publication(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return fail('invalid_timestamp');
  // Official feeds also publish timezone-less UTC ISO dates.
  const utc = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?$/.test(value) ? `${value}Z` : value;
  const parsed = timestamp(utc);
  if (!Number.isFinite(parsed)) return fail('invalid_timestamp');
  return new Date(parsed).toISOString();
}

/** Validate untrusted stored content before conditional requests or range verification. */
export function isQualifiedRangeContent(
  source: RangeSource,
  content: unknown,
): content is RangeContent {
  try {
    if (!sameSource(source) || !content || typeof content !== 'object') return false;
    const value = content as RangeContent;
    if (
      value.sourceId !== source.id ||
      value.sourceUrl !== source.url ||
      value.parserVersion !== source.parserVersion ||
      !equalStrings(value.names, source.names) ||
      !equalStrings(value.crawlerIds, source.crawlerIds) ||
      (value.publishedAt !== null && !Number.isFinite(timestamp(value.publishedAt)))
    )
      return false;
    const normalized = normalizePrefixes(value.prefixes);
    return (
      equalStrings(value.prefixes, normalized) && value.version === versionFor(source, normalized)
    );
  } catch {
    return false;
  }
}
export const rangeBaselines: Record<string, { content: RangeContent; observedAt: string }> =
  Object.freeze(
    Object.fromEntries(
      rangeSources.map(source => {
        const baseline = bundled[source.id];
        if (!baseline || baseline.source !== source.url) return fail('missing_baseline');
        return [
          source.id,
          Object.freeze({
            content: contentFor(source, baseline.prefixes, publication(baseline.publishedAt)),
            observedAt: baseline.observedAt,
          }),
        ];
      }),
    ),
  );
function qualifiedObservation(source: RangeSource, value: RangeObservation, now: number): boolean {
  const observed = timestamp(value?.observedAt);
  return (
    isQualifiedRangeContent(source, value?.content) &&
    Number.isFinite(observed) &&
    observed <= now &&
    (value.content.publishedAt === null || timestamp(value.content.publishedAt) <= observed)
  );
}
function coverage(prefixes: string[], family: 4 | 6): bigint {
  const networks = prefixes
    .map(parseNetwork)
    .filter(network => network.family === family)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  let total = 0n;
  let end = -1n;
  for (const network of networks) {
    if (network.end <= end) continue;
    total += network.end - (network.start > end ? network.start : end + 1n) + 1n;
    end = network.end;
  }
  return total;
}
function compare(previous: RangeContent, next: RangeContent) {
  const old = new Set(previous.prefixes);
  const fresh = new Set(next.prefixes);
  const change = {
    added: next.prefixes.filter(prefix => !old.has(prefix)).length,
    removed: previous.prefixes.filter(prefix => !fresh.has(prefix)).length,
    oldCount: old.size,
  };
  let candidateReason: string | null = null;
  if (change.added + change.removed > change.oldCount * 0.5) candidateReason = 'prefix_churn';
  for (const family of [4, 6] as const) {
    if (coverage(next.prefixes, family) > coverage(previous.prefixes, family) * 4n) {
      candidateReason = `ipv${family}_coverage_growth`;
      break;
    }
  }
  return { change, candidateReason };
}
function validator(value: string | null | undefined): string | null {
  return typeof value === 'string' && /^[\x20-\x7e]{1,1024}$/.test(value) ? value : null;
}
async function readBody(response: Response, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) return fail('response_too_large');
  if (!response.body) return fail('invalid_json');
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (signal.aborted) return fail('timeout');
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) return fail('timeout');
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) return fail('response_too_large');
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return fail('invalid_json');
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
  }
}
function parseFeed(data: unknown): { prefixes: string[]; publishedAt: string | null } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return fail('invalid_shape');
  const feed = data as { prefixes?: unknown; creationTime?: unknown };
  if (!Array.isArray(feed.prefixes)) return fail('invalid_shape');
  if (!feed.prefixes.length) return fail('empty_prefixes');
  if (feed.prefixes.length > MAX_PREFIXES) return fail('too_many_prefixes');
  const prefixes = feed.prefixes.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return fail('invalid_shape');
    const keys = Object.keys(row);
    if (keys.length !== 1 || !['ipv4Prefix', 'ipv6Prefix'].includes(keys[0]))
      return fail('invalid_shape');
    const network = publicNetwork(row[keys[0]]);
    if ((keys[0] === 'ipv4Prefix') !== (network.family === 4)) return fail('invalid_shape');
    return network.prefix;
  });
  return { prefixes, publishedAt: publication(feed.creationTime) };
}

export async function checkRangeSource(
  source: RangeSource,
  previous?: RangeObservation,
  options: { fetcher?: typeof fetch; now?: () => Date } = {},
): Promise<RangeCheckResult> {
  const baseline = rangeBaselines[source?.id];
  if (!baseline) return fail('missing_baseline');
  if (!sameSource(source)) return fail('invalid_source');
  source = rangeSources.find(entry => entry.id === source.id);
  const now = options.now || (() => new Date());
  const initialTime = now().getTime();
  if (!Number.isFinite(initialTime)) return fail('invalid_timestamp');
  if (!qualifiedObservation(source, previous || baseline, initialTime))
    return fail('invalid_cache');
  // Caller-owned database values cannot change the qualified snapshot during an awaited request.
  if (previous)
    previous = {
      ...previous,
      content: freezeContent({
        ...previous.content,
        prefixes: [...previous.content.prefixes],
        names: [...previous.content.names],
        crawlerIds: [...previous.content.crawlerIds],
      }),
    };
  const comparison = previous || baseline;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new RangeCheckError('timeout'));
      controller.abort();
    }, TIMEOUT_MS);
  });
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
  const etag = validator(previous?.etag);
  const lastModified = validator(previous?.lastModified);
  if (etag) headers['If-None-Match'] = etag;
  if (lastModified) headers['If-Modified-Since'] = lastModified;
  let response: Response | undefined;
  try {
    return await Promise.race([
      deadline,
      (async (): Promise<RangeCheckResult> => {
        response = await (options.fetcher || fetch)(source.url, {
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
        if (response.status !== 304 && response.status !== 200) {
          return fail(
            response.status === 403
              ? 'http_403'
              : response.status === 429
                ? 'http_429'
                : 'http_error',
          );
        }
        let content: RangeContent;
        if (response.status === 304) {
          content = freezeContent({
            ...previous.content,
            prefixes: [...previous.content.prefixes],
            names: [...previous.content.names],
            crawlerIds: [...previous.content.crawlerIds],
          });
        } else {
          const feed = parseFeed(await readBody(response, controller.signal));
          content = contentFor(source, feed.prefixes, feed.publishedAt);
        }
        const finished = now().getTime();
        if (
          !Number.isFinite(finished) ||
          finished < initialTime ||
          (content.publishedAt !== null && timestamp(content.publishedAt) > finished)
        )
          return fail('invalid_timestamp');
        const { change, candidateReason } = compare(comparison.content, content);
        return {
          status: candidateReason
            ? 'candidate'
            : content.version === comparison.content.version
              ? 'unchanged'
              : 'ok',
          content,
          observedAt: new Date(finished).toISOString(),
          etag: validator(response.headers.get('etag')) || (response.status === 304 ? etag : null),
          lastModified:
            validator(response.headers.get('last-modified')) ||
            (response.status === 304 ? lastModified : null),
          notModified: response.status === 304,
          candidateReason,
          change,
        };
      })(),
    ]);
  } catch (error) {
    if (error instanceof RangeCheckError) throw error;
    if (
      controller.signal.aborted ||
      (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))
    )
      return fail('timeout');
    return fail('network_error');
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
  }
}
