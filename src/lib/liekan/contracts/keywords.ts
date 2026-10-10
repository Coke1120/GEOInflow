import { z } from 'zod';
import { classifyEntrySource, type EntrySource } from './sources';
import { sanitizeExportValue } from './export-privacy';

export const keywordEngines = [
  'Google',
  'Bing',
  '百度',
  '搜狗',
  '360',
  'DuckDuckGo',
  'Yahoo',
] as const;
export const keywordStatuses = [
  'available',
  'missing',
  'invalid',
  'unsupported',
  'conflict',
  'incomplete',
  'redacted',
] as const;
export const keywordStatusLabels: Record<(typeof keywordStatuses)[number], string> = {
  available: '已识别',
  missing: '未提供',
  invalid: '无法解析',
  unsupported: '来源不支持',
  conflict: '证据冲突',
  incomplete: '完整性无法确认',
  redacted: '已脱敏',
};
export const keywordEvidenceLabels = {
  referrer: '来源搜索词',
  utm: 'UTM 手动标记',
  none: '无可用关键词',
};
export const keywordConditionsSchema = z.object({
  engine: z.enum(['', ...keywordEngines]).default(''),
  evidence: z.enum(['', 'referrer', 'utm', 'none']).default(''),
  status: z.enum(['', ...keywordStatuses]).default(''),
  search: z.string().max(200).default(''),
  sort: z
    .enum([
      'sessions',
      'keyword',
      'engine',
      'evidence',
      'status',
      'share',
      'bounceRate',
      'conversionRate',
    ])
    .default('sessions'),
  direction: z.enum(['asc', 'desc']).default('desc'),
});
export type KeywordConditions = z.infer<typeof keywordConditionsSchema>;
export type KeywordEntry = EntrySource & {
  referrerPath?: string | null;
  referrerQuery?: string | null;
  utmTerm?: string | null;
};
export type KeywordIdentification = {
  engine: (typeof keywordEngines)[number];
  keyword: string | null;
  evidence: keyof typeof keywordEvidenceLabels;
  status: (typeof keywordStatuses)[number];
};
const rules = [
  {
    engine: 'Google',
    domains: ['google.com', 'google.com.hk', 'google.cn'],
    hosts: ['', 'www', 'm'],
    path: /^\/search\/?$/,
    keys: ['q'],
  },
  {
    engine: 'Bing',
    domains: ['bing.com'],
    hosts: ['', 'www', 'cn'],
    path: /^\/search\/?$/,
    keys: ['q'],
  },
  {
    engine: '百度',
    domains: ['baidu.com'],
    hosts: ['', 'www', 'm'],
    path: /^\/(?:s|baidu|from[^/]*\/s)\/?$/,
    keys: ['wd', 'word'],
  },
  {
    engine: '搜狗',
    domains: ['sogou.com'],
    hosts: ['', 'www', 'm', 'wap'],
    path: /^\/(?:web|websearch|sogou|s)\/?$/,
    keys: ['query', 'keyword'],
  },
  { engine: '360', domains: ['so.com'], hosts: ['', 'www', 'm'], path: /^\/s\/?$/, keys: ['q'] },
  {
    engine: 'DuckDuckGo',
    domains: ['duckduckgo.com'],
    hosts: ['', 'www', 'html', 'lite'],
    path: /^\/(?:html\/|lite\/)?$/,
    keys: ['q'],
  },
  {
    engine: 'Yahoo',
    domains: ['yahoo.com'],
    hosts: ['search', 'www', ''],
    path: /^\/search\/?$/,
    keys: ['p', 'q'],
  },
] as const;
function ruleFor(host: string) {
  return rules.find(rule =>
    rule.domains.some(domain => host === domain || host.endsWith(`.${domain}`)),
  );
}
function isSearchHost(host: string, rule: (typeof rules)[number]) {
  return rule.domains.some(domain =>
    rule.hosts.some(prefix => host === (prefix ? `${prefix}.${domain}` : domain)),
  );
}
export function redactKeywordTerm(term: string): string {
  const credential =
    /["']?\b(?:password|passwd|(?:client[_-]?)?secret|(?:access[_-]?|refresh[_-]?|auth[_-]?)?token|api[_-]?key|authorization|cookie|backup[_-]?code)\b["']?\s*[:=]\s*["']?\s*\S+|\bBearer\s+\S+|\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/i;
  return sanitizeExportValue(term) === term && !credential.test(term) ? term : '[已脱敏]';
}
function normalize(term: string) {
  return term.normalize('NFC').trim();
}
// Percent bytes are decoded strictly; '+' represents a space only in URL query evidence.
function decodeQueryTerm(raw: string, gbk: boolean) {
  const plus = raw.replaceAll('+', ' ');
  try {
    return decodeURIComponent(plus);
  } catch {
    if (!gbk || /%(?![\da-f]{2})/i.test(plus)) throw new Error('invalid query');
    const bytes: number[] = [];
    for (let i = 0; i < plus.length; ) {
      if (plus[i] === '%') {
        bytes.push(parseInt(plus.slice(i + 1, i + 3), 16));
        i += 3;
      } else {
        const point = String.fromCodePoint(plus.codePointAt(i)!);
        bytes.push(...new TextEncoder().encode(point));
        i += point.length;
      }
    }
    return new TextDecoder('gb18030', { fatal: true }).decode(new Uint8Array(bytes));
  }
}
export function identifyKeyword(entry: KeywordEntry): KeywordIdentification | null {
  const attribution = classifyEntrySource(entry);
  if (attribution.channel !== '传统搜索') return null;
  const rule = ruleFor(attribution.source.toLowerCase());
  if (!rule) return null;
  const result = (
    status: KeywordIdentification['status'],
    keyword: string | null = null,
    evidence: KeywordIdentification['evidence'] = 'none',
  ): KeywordIdentification => ({ engine: rule.engine, keyword, evidence, status });
  let failure: KeywordIdentification['status'] = 'missing';
  const host = entry.referrer?.trim().toLowerCase() || '';
  const actual = ruleFor(host);
  const rawQuery = entry.referrerQuery || '';
  const path = entry.referrerPath || '';
  if ((entry.utmSource || '').length >= 255 || (entry.utmMedium || '').length >= 255)
    return result('incomplete');
  if (host.length >= 500 || path.length >= 500) failure = 'incomplete';
  else if (host && actual?.engine !== rule.engine) failure = 'conflict';
  else if (
    host &&
    (!actual ||
      !isSearchHost(host, actual) ||
      (path && (path !== '/' || rawQuery) && !actual.path.test(path)))
  )
    failure = 'unsupported';
  else if (rawQuery) {
    if (rawQuery.length >= 500 || path.length >= 500) failure = 'incomplete';
    else if (!path || !actual) failure = 'unsupported';
    else {
      try {
        const values: string[] = [];
        for (const part of rawQuery.replace(/^\?/, '').split('&')) {
          const split = part.indexOf('=');
          let key: string;
          try {
            key = decodeURIComponent(split < 0 ? part : part.slice(0, split));
          } catch {
            continue;
          }
          if (!(actual.keys as readonly string[]).includes(key)) continue;
          const raw = split < 0 ? '' : part.slice(split + 1);
          values.push(
            normalize(decodeQueryTerm(raw, ['百度', '搜狗', '360'].includes(actual.engine))),
          );
        }
        const unique = [...new Set(values)];
        if (unique.length > 1) failure = 'conflict';
        const term = unique.length === 1 ? unique[0] : undefined;
        if (term) {
          if (/[\u0000-\u001f\u007f\ufffd]/.test(term)) failure = 'invalid';
          else if (redactKeywordTerm(term) !== term) return result('redacted');
          else return result('available', term, 'referrer');
        }
      } catch {
        failure = 'invalid';
      }
    }
  }
  // utmTerm was decoded when collected. Re-decoding would corrupt literal percent/plus searches.
  if ((entry.utmTerm || '').length >= 255) return result('incomplete');
  const term = normalize(entry.utmTerm || '');
  if (term) {
    if ((entry.utmTerm || '').length >= 255) return result('incomplete');
    if (/[\u0000-\u001f\u007f\ufffd]/.test(term)) return result('invalid');
    if (redactKeywordTerm(term) !== term) return result('redacted');
    return result('available', term, 'utm');
  }
  return result(failure);
}

export type KeywordCandidate = KeywordEntry & {
  sessions: number;
  bounces: number;
  conversions: number;
};
export type KeywordRow = KeywordIdentification & {
  id: string;
  sessions: number;
  bounces: number;
  conversions: number;
  share: number | null;
  bounceRate: number | null;
  conversionRate: number | null;
};
export function addKeywordCandidate(groups: Map<string, KeywordRow>, row: KeywordCandidate) {
  const identity = identifyKeyword(row);
  if (!identity) return false;
  const id = JSON.stringify([
    identity.engine,
    identity.keyword,
    identity.evidence,
    identity.status,
  ]);
  const group = groups.get(id) || {
    ...identity,
    id,
    sessions: 0,
    bounces: 0,
    conversions: 0,
    share: null,
    bounceRate: null,
    conversionRate: null,
  };
  for (const metric of ['sessions', 'bounces', 'conversions'] as const)
    group[metric] += row[metric];
  groups.set(id, group);
  return true;
}
const percent = (n: number, d: number) => (d ? Math.round((n / d) * 10000) / 100 : null);
export function selectKeywords(
  rows: KeywordRow[],
  conditions: KeywordConditions,
  hasGoals: boolean,
) {
  const population = rows.filter(row => !conditions.engine || row.engine === conditions.engine);
  const total = population.reduce((n, row) => n + row.sessions, 0);
  const referrer = population
    .filter(row => row.evidence === 'referrer')
    .reduce((n, row) => n + row.sessions, 0);
  const utm = population
    .filter(row => row.evidence === 'utm')
    .reduce((n, row) => n + row.sessions, 0);
  const selected = population
    .filter(
      row =>
        (!conditions.evidence || row.evidence === conditions.evidence) &&
        (!conditions.status || row.status === conditions.status) &&
        (!conditions.search ||
          (row.keyword || keywordStatusLabels[row.status])
            .toLocaleLowerCase()
            .includes(conditions.search.toLocaleLowerCase())),
    )
    .map(row => ({
      ...row,
      share: percent(row.sessions, total),
      bounceRate: percent(row.bounces, row.sessions),
      conversionRate: hasGoals ? percent(row.conversions, row.sessions) : null,
    }));
  selected.sort((a, b) => {
    const av = a[conditions.sort],
      bv = b[conditions.sort];
    const order =
      av === bv
        ? 0
        : av === null
          ? 1
          : bv === null
            ? -1
            : typeof av === 'number' && typeof bv === 'number'
              ? av - bv
              : String(av) < String(bv)
                ? -1
                : 1;
    // Null metrics remain last in either direction; identity is a deterministic tie breaker.
    return (
      (av === null || bv === null ? order : order * (conditions.direction === 'asc' ? 1 : -1)) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
  });
  return { rows: selected, total, referrer, utm, availability: percent(referrer + utm, total) };
}
