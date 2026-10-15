import type { CrawlerCandidatesResponse } from '../contracts/crawler-maintenance';

const noise = new Set([
  'mozilla',
  'applewebkit',
  'webkit',
  'chrome',
  'chromium',
  'safari',
  'mobile',
  'version',
  'firefox',
  'gecko',
  'khtml',
  'edg',
  'edge',
  'edga',
  'edgios',
  'opr',
  'opera',
  'windows',
  'macintosh',
  'macos',
  'iphone',
  'ipad',
  'ipod',
  'android',
  'linux',
  'ubuntu',
  'x11',
  'darwin',
  'cfnetwork',
  'okhttp',
  'dalvik',
  'curl',
  'wget',
  'python',
  'python-requests',
  'python-urllib',
  'go-http-client',
  'libwww-perl',
  'java',
  'apache-httpclient',
  'node',
  'axios',
  'undici',
  'postmanruntime',
  'restsharp',
  'compatible',
  'headlesschrome',
  'electron',
  'crios',
  'fxios',
  'samsungbrowser',
  'micromessenger',
  'qqbrowser',
  'build',
  'device',
  'model',
  'user',
  'session',
  'token',
  'cookie',
  'authorization',
]);

const botLike = /(?:bot|crawler|spider|fetcher|search|preview)$/i;
export class CandidateBudgetExceeded extends Error {
  constructor() {
    super('candidate_budget_exceeded');
  }
}

/** Comments contribute only recognizable crawler product tokens; free text stays private. */
export function extractUnknownProductTokens(userAgent: string): string[] {
  if (typeof userAgent !== 'string' || userAgent.length > 8192) return [];
  const segments: { text: string; comment: boolean }[] = [];
  let cleaned = '',
    depth = 0;
  for (const char of userAgent) {
    if (char === '(' || char === ')') {
      segments.push({ text: cleaned, comment: depth > 0 });
      cleaned = '';
      depth = char === '(' ? depth + 1 : Math.max(0, depth - 1);
    } else cleaned += char;
  }
  segments.push({ text: cleaned, comment: depth > 0 });
  const products = new Set<string>();
  for (const { text, comment } of segments)
    for (const part of text.split(/[\s;,]+/)) {
      // Anchoring rejects URLs, addresses, emails, paths, values and embedded identifiers as a unit.
      const match = /^([A-Za-z][A-Za-z0-9_-]{2,47})(?:\/((?:\d{1,3})(?:\.\d{1,3}){0,3}))?$/.exec(
        part,
      );
      if (!match) continue;
      const token = match[1],
        lower = token.toLowerCase();
      if ((!match[2] || comment) && !botLike.test(token)) continue;
      if (
        noise.has(lower) ||
        /(?:token|session|cookie|auth|uuid|device|build|account|userid)/i.test(token)
      )
        continue;
      if (/\d{4}|[_-]{2}|^[a-f0-9]{8,}$/i.test(token)) continue;
      if (token.replace(/\D/g, '').length > 3 || token.length > 32) continue;
      const letters = token.replace(/[^a-z]/gi, '');
      if (letters.length < 3 || !/[aeiouy]/i.test(letters)) continue;
      // Long mixed-case identifiers commonly encode sessions; recognizable bot suffixes remain useful.
      if (token.length >= 16) {
        const frequencies = [...new Set(lower)].map(
          char => [...lower].filter(value => value === char).length / lower.length,
        );
        const entropy = -frequencies.reduce(
          (sum, frequency) => sum + frequency * Math.log2(frequency),
          0,
        );
        if (entropy > 3.6) continue;
      }
      if (token.length > 18 && !/(?:bot|crawler|spider|fetcher|search|preview)$/i.test(token))
        continue;
      if (/[a-z][A-Z][a-z][A-Z]|[A-Z][a-z][A-Z][a-z][A-Z]/.test(token)) continue;
      products.add(lower);
      if (products.size === 8) return [...products];
    }
  return [...products];
}
export function summarizeUnknownSample(
  rows: { userAgent: string; createdAt: Date | string }[],
  options: { deadline?: number; now?: () => number; maxDistinct?: number } = {},
): { items: CrawlerCandidatesResponse['items']; scannedRows: number; partial: boolean } {
  const counts = new Map<string, CrawlerCandidatesResponse['items'][number]>();
  const now = options.now ?? Date.now;
  const maxDistinct = options.maxDistinct ?? 10000;
  let scannedRows = 0;
  for (const row of rows) {
    // Reserve a bounded finalization window; each row is counted only after all its tokens are incorporated.
    if (options.deadline !== undefined && now() >= options.deadline - 25) break;
    const tokens = extractUnknownProductTokens(row.userAgent);
    if (counts.size + tokens.filter(token => !counts.has(token)).length > maxDistinct) break;
    const time = new Date(row.createdAt).toISOString();
    for (const token of tokens) {
      const item = counts.get(token);
      if (item) {
        item.count++;
        if (time < item.firstSeen) item.firstSeen = time;
        if (time > item.lastSeen) item.lastSeen = time;
      } else counts.set(token, { token, count: 1, firstSeen: time, lastSeen: time });
    }
    scannedRows++;
  }
  const best: CrawlerCandidatesResponse['items'] = [];
  const compare = (a: (typeof best)[number], b: (typeof best)[number]) =>
    b.count - a.count || (a.token < b.token ? -1 : a.token > b.token ? 1 : 0);
  // The distinct-token ceiling bounds finalization independently of adversarial user agents.
  for (const item of counts.values()) {
    if (best.length === 100 && compare(item, best[99]) >= 0) continue;
    let low = 0,
      high = best.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (compare(item, best[middle]) < 0) high = middle;
      else low = middle + 1;
    }
    best.splice(low, 0, item);
    if (best.length > 100) best.pop();
  }
  return { items: best, scannedRows, partial: scannedRows < rows.length };
}
export function summarizeUnknownTokens(
  rows: { userAgent: string; createdAt: Date | string }[],
  options: { deadline?: number } = {},
): CrawlerCandidatesResponse['items'] {
  const result = summarizeUnknownSample(rows, { ...options, maxDistinct: Number.MAX_SAFE_INTEGER });
  if (result.partial) throw new CandidateBudgetExceeded();
  return result.items;
}
