import { createHash, createHmac } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import Papa from 'papaparse';
import { BOT_RULES, type BotRule, classifyBot } from './rules/bots';
import { verifyBotIp } from './rules/verify';

export interface LogRecord {
  id: string;
  time: string;
  path: string;
  method: string;
  status: number;
  bytes: number;
  ipMasked: string;
  ipHash: string;
  userAgent: string;
  location: string;
  bot: string;
  vendor: string;
  type: string;
  verification: string;
}
export interface CatalogRecord {
  path: string;
  type: string;
  title: string;
  wordCount: number | null;
  publishedAt: string | null;
  structured: boolean | null;
  structureScore: number | null;
  updatedAt: string | null;
  linkDepth: number | null;
  source: string;
}
const MAX_BYTES = 10 * 1024 * 1024;
export function canonicalPath(input: string, domain: string) {
  if (!input.trim()) throw new Error('URL 不能为空');
  const base = new URL(`https://${domain.replace(/^https?:\/\//, '').replace(/\/$/, '')}`);
  const url = new URL(input, base);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.hostname !== base.hostname ||
    url.username ||
    url.password
  )
    throw new Error('URL 必须属于当前站点');
  return url.pathname.slice(0, 500) || '/';
}
function maskIp(value: string) {
  if (!ipaddr.isValid(value)) throw new Error('Invalid IP');
  const ip = ipaddr.process(value);
  if (ip.kind() === 'ipv4') return `${ip.toByteArray().slice(0, 3).join('.')}.0/24`;
  const bytes = ip.toByteArray();
  return `${Array.from({ length: 3 }, (_, i) => ((bytes[i * 2] << 8) | bytes[i * 2 + 1]).toString(16)).join(':')}::/48`;
}
function safeText(value: unknown, max: number) {
  return (
    String(value ?? '')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Strip log control characters before storage.
      .replace(/[\x00-\x1f]/g, '')
      .slice(0, max)
  );
}
export function parseLogInput(
  input: { format: string; content?: string; records?: unknown[] },
  domain: string,
  secret: string,
  rules: BotRule[] = BOT_RULES,
) {
  const serialized = input.content ?? JSON.stringify(input.records ?? []);
  if (Buffer.byteLength(serialized) > MAX_BYTES) throw new Error('文件上限 10 MiB');
  if (!['combined', 'json'].includes(input.format)) throw new Error('格式仅支持 combined 或 json');
  const rows: unknown[] =
    input.format === 'json'
      ? (input.records ?? JSON.parse(serialized))
      : serialized.split(/\r?\n/).filter(Boolean);
  if (!Array.isArray(rows) || rows.length > 10000) throw new Error('每批上限 10000 行');
  if (input.format === 'json' && rows.length > 1000) throw new Error('JSON 每批上限 1000 条');
  const records: LogRecord[] = [];
  const errors: { line: number; reason: string }[] = [];
  const occurrences = new Map<string, number>();
  rows.forEach((raw, index) => {
    try {
      let obj: any = raw;
      if (input.format === 'combined') {
        const m = String(raw).match(
          /^(\S+) \S+ \S+ \[([^\]]+)\] "([A-Z]+) (.*?) HTTP\/[\d.]+" (\d{3}) (\d+|-) "[^"]*" "([^"]*)"$/,
        );
        if (!m) throw new Error('Invalid combined format');
        const date = m[2].match(
          /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}:\d{2}:\d{2}) ([+-]\d{4})$/,
        );
        if (!date) throw new Error('Invalid timestamp');
        obj = {
          ip: m[1],
          time: `${date[2]} ${date[1]} ${date[3]} ${date[4]} ${date[5]}`,
          method: m[3],
          path: m[4],
          status: Number(m[5]),
          bytes: m[6] === '-' ? 0 : Number(m[6]),
          userAgent: m[7],
        };
      }
      if (!obj || typeof obj !== 'object') throw new Error('Invalid row');
      const time = new Date(obj.time ?? obj.timestamp);
      if (!Number.isFinite(time.getTime()) || time.getTime() > Date.now() + 86400000)
        throw new Error('Invalid timestamp');
      const ip = String(obj.ip ?? obj.remote_addr ?? '');
      const ipMasked = maskIp(ip);
      const path = canonicalPath(String(obj.path ?? obj.url ?? ''), domain);
      const method = safeText(obj.method ?? 'GET', 10).toUpperCase();
      if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method))
        throw new Error('Invalid method');
      const status = Number(obj.status);
      const bytes = Number(obj.bytes ?? 0);
      if (
        !Number.isInteger(status) ||
        status < 100 ||
        status > 599 ||
        !Number.isSafeInteger(bytes) ||
        bytes < 0
      )
        throw new Error('Invalid status or bytes');
      const userAgent = safeText(obj.userAgent ?? obj.user_agent, 500);
      const bot = classifyBot(userAgent, rules);
      const ipHash = createHmac('sha256', secret)
        .update(ipaddr.process(ip).toString())
        .digest('hex');
      const normalized = {
        time: time.toISOString(),
        path,
        method,
        status,
        bytes,
        ipMasked,
        ipHash,
        userAgent,
        location: safeText(obj.location, 80) || '未知',
        bot: bot.name,
        vendor: bot.vendor,
        type: bot.type,
        verification: verifyBotIp(ip, bot.name, userAgent, time.toISOString()),
      };
      const fingerprint = createHash('sha256')
        .update(JSON.stringify([normalized.time, path, method, status, bytes, ipHash, userAgent]))
        .digest('hex');
      const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
      occurrences.set(fingerprint, occurrence);
      records.push({
        id: createHash('sha256').update(`${fingerprint}:${occurrence}`).digest('hex'),
        ...normalized,
      });
    } catch {
      errors.push({ line: index + 1, reason: '格式、时间、IP 或站点 URL 无效' });
    }
  });
  return {
    records,
    accepted: records.length,
    rejected: errors.length,
    errors: errors.slice(0, 100),
    digest: createHash('sha256').update(JSON.stringify(records)).digest('hex'),
  };
}
export function parseCatalog(
  input: { format: string; content: string },
  domain: string,
): CatalogRecord[] {
  if (Buffer.byteLength(input.content) > MAX_BYTES) throw new Error('文件上限 10 MiB');
  let rows: any[];
  if (input.format === 'sitemap') {
    if (/<!DOCTYPE|<!ENTITY/i.test(input.content)) throw new Error('XML 外部实体不受支持');
    if (
      /<sitemapindex\b/i.test(input.content) ||
      !/<urlset(?:\s[^>]*)?>[\s\S]*<\/urlset>\s*$/i.test(input.content)
    )
      throw new Error('请上传 urlset 页面 URL 列表；sitemap 索引不受支持');
    rows = Array.from(input.content.matchAll(/<url(?:\s[^>]*)?>([\s\S]*?)<\/url>/gi), match => {
      const location = match[1].match(/<loc>\s*([^<]+?)\s*<\/loc>/i);
      if (!location) throw new Error('sitemap 页面缺少 loc');
      return { url: location[1].replace(/&amp;/g, '&') };
    });
    if (!rows.length) throw new Error('sitemap 缺少 loc，请上传 URL 列表而非索引');
  } else if (input.format === 'csv') {
    const result = Papa.parse(input.content, { header: true, skipEmptyLines: true });
    if (result.errors.length) throw new Error('CSV 格式错误');
    rows = result.data as any[];
  } else if (input.format === 'json') rows = JSON.parse(input.content);
  else throw new Error('格式仅支持 sitemap、csv 或 json');
  if (!Array.isArray(rows) || rows.length > 10000) throw new Error('目录上限 10000 条');
  const result = rows.map(row => {
    const path = canonicalPath(
      String(typeof row === 'string' ? row : (row.url ?? row.path ?? '')),
      domain,
    );
    const wordCount = row.wordCount == null || row.wordCount === '' ? null : Number(row.wordCount);
    if (
      wordCount !== null &&
      (!Number.isInteger(wordCount) || wordCount < 0 || wordCount > 10000000)
    )
      throw new Error('字数无效');
    const publishedAt = row.publishedAt ? new Date(row.publishedAt).toISOString() : null;
    const updatedAt = row.updatedAt ? new Date(row.updatedAt).toISOString() : null;
    const linkDepth = row.linkDepth == null || row.linkDepth === '' ? null : Number(row.linkDepth);
    if (linkDepth !== null && (!Number.isInteger(linkDepth) || linkDepth < 0 || linkDepth > 10000))
      throw new Error('链接深度无效');
    const structureScore =
      row.structureScore == null || row.structureScore === '' ? null : Number(row.structureScore);
    if (
      structureScore !== null &&
      (!Number.isInteger(structureScore) || structureScore < 0 || structureScore > 100)
    )
      throw new Error('结构化评分须为 0–100 的整数');
    return {
      path,
      type: safeText(row.type, 50) || '未分类',
      title: safeText(row.title, 200),
      wordCount,
      publishedAt,
      structured:
        row.structured == null ? null : row.structured === true || row.structured === 'true',
      structureScore,
      updatedAt,
      linkDepth,
      source: safeText(row.source, 200) || '用户上传，来源未核验',
    };
  });
  return Array.from(new Map(result.map(row => [row.path, row])).values());
}
