import { getPostgresCountrySQL } from '@/lib/country';
import { createHash, randomBytes } from 'node:crypto';
import JSZip from 'jszip';
import Papa from 'papaparse';
import prisma, { getRawQueryClient } from '@/lib/prisma';
import type { PrismaClient } from '@/generated/prisma/client';
import { getQuerySnapshot, withinQuerySnapshot } from './query-snapshot';
import { timedAnalyticsClient } from './analytics-deadline';
import { getQueryFilters } from '@/lib/request';
import { getWebsiteStats } from '@/queries/sql';
import { getWebsiteSegment } from '@/queries/prisma';
import {
  EXPORT_MAX_BYTES,
  EXPORT_MAX_ROWS,
  exportRequestSchema,
  safeCsvCell,
  sanitizeExportValue,
  type ExportFrame,
} from '../contracts/exports';
import { LiekanError, reportSnapshot } from './server';
import { analyticsGate } from './analytics-budget';
import { readKeywordFacts, validateKeywordRange } from './keywords';
import {
  selectKeywords,
  keywordConditionsSchema,
  keywordStatusLabels,
  keywordEvidenceLabels,
  redactKeywordTerm,
} from '../contracts/keywords';

export async function prepareFeatureExport(
  website: { id: string; name: string; domain: string },
  input: unknown,
  signal: AbortSignal,
) {
  const parsed = exportRequestSchema.safeParse(input);
  if (!parsed.success) throw new LiekanError('导出参数无效');
  const p = parsed.data;
  if (p.kind === 'source-keywords') {
    const deadline = Date.now() + 65000;
    return analyticsGate.run(
      () =>
        reportSnapshot(() =>
          withinQuerySnapshot(
            timedAnalyticsClient(getQuerySnapshot(), Math.min(deadline, Date.now() + 60000)),
            () => prepareKeywordSnapshot(website, p, signal),
          ),
        ),
      deadline,
    );
  }
  if (process.env.CLICKHOUSE_URL)
    throw new LiekanError('完整导出当前支持 PostgreSQL，可使用兼容导出功能。', 501);
  const primary = getRawQueryClient(prisma.client, { write: true }) as PrismaClient;
  return primary.$transaction(
    tx => withinQuerySnapshot(tx, () => prepareSnapshot(website, p, signal)),
    { isolationLevel: 'RepeatableRead', maxWait: 10000, timeout: 120000 },
  );
}
async function prepareSnapshot(
  website: { id: string; name: string; domain: string },
  p: Exclude<ReturnType<typeof exportRequestSchema.parse>, { kind: string }>,
  signal: AbortSignal,
) {
  try {
    new Intl.DateTimeFormat('zh-CN', { timeZone: p.timezone }).format();
  } catch {
    throw new LiekanError('时区无效');
  }
  const sections = p.format === 'zip' ? [...new Set(p.sections)] : ['summary'];
  for (const key of ['segment', 'cohort'])
    if (p.filters[key] && !(await getWebsiteSegment(website.id, p.filters[key])))
      throw new LiekanError('人群条件不属于所选站点', 404);
  const filters = await getQueryFilters(
    { ...p.filters, startAt: p.startAt, endAt: p.endAt, timezone: p.timezone },
    website.id,
  );
  const { filterQuery, joinSessionQuery, cohortQuery, excludeBounceQuery, queryParams } =
    prisma.parseFilters({
      ...filters,
      websiteId: website.id,
    });
  const cte = `WITH selected AS(SELECT website_event.* FROM website_event ${cohortQuery} ${joinSessionQuery} ${excludeBounceQuery} WHERE website_event.website_id={{websiteId::uuid}} AND website_event.created_at BETWEEN {{startDate}} AND {{endDate}} AND website_event.event_type IN (1,2) ${filterQuery})`;
  const aborted = () => {
    if (signal.aborted) throw new LiekanError('导出已取消', 499);
  };
  const run = async (sql: string, params: any = {}) => {
    aborted();
    const rows = await prisma.rawQuery(
      `${cte} ${sql}`,
      { ...queryParams, ...params },
      'liekanCompleteExport',
    );
    aborted();
    return JSON.parse(JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));
  };
  const salt = randomBytes(32).toString('hex');
  const mask = (id: string) =>
    id
      ? `visitor-${createHash('sha256')
          .update(salt + id)
          .digest('hex')
          .slice(0, 12)}`
      : null;
  const files: { name: string; content: string; rows: number; fields: string[] }[] = [];
  let bytes = 0,
    rows = 0;
  const add = (name: string, data: any[], format: 'csv' | 'json' = 'csv') => {
    rows += data.length;
    if (rows > EXPORT_MAX_ROWS)
      throw new LiekanError('导出明细超过 100,000 行，请缩小日期范围或数据范围', 413);
    const safe = data.map(row => {
      const clean: any = sanitizeExportValue(row);
      if (row.property && /password|secret|token|key|email|phone|ip|cookie/i.test(row.property))
        clean.value = '[已脱敏]';
      return clean;
    });
    const fields = [...new Set<string>(safe.flatMap(row => Object.keys(row)))];
    const content =
      format === 'json'
        ? JSON.stringify(safe)
        : Papa.unparse(
            {
              fields: fields.map(safeCsvCell),
              data: safe.map(row =>
                fields.map(key =>
                  safeCsvCell(
                    typeof row[key] === 'object' && row[key] !== null
                      ? JSON.stringify(row[key])
                      : row[key],
                  ),
                ),
              ),
            },
            { header: true },
          );
    bytes += Buffer.byteLength(content);
    if (bytes > EXPORT_MAX_BYTES)
      throw new LiekanError('导出文件超过 50 MiB，请缩小日期范围或数据范围', 413);
    files.push({ name, content, rows: data.length, fields });
  };
  const paged = async (sql: string, mapper: (row: any) => any = r => r) => {
    const data: any[] = [];
    let bufferedBytes = 0;
    for (let offset = 0; ; offset += 1000) {
      const page = await run(`${sql} LIMIT 1000 OFFSET {{offset}}`, { offset });
      for (const row of page) {
        const mapped = mapper(row);
        bufferedBytes += Buffer.byteLength(JSON.stringify(sanitizeExportValue(mapped)));
        if (bytes + bufferedBytes > EXPORT_MAX_BYTES)
          throw new LiekanError('导出处理数据超过 50 MiB，请缩小范围', 413);
        data.push(mapped);
      }
      if (rows + data.length > EXPORT_MAX_ROWS)
        throw new LiekanError('导出明细超过 100,000 行，请缩小日期范围或数据范围', 413);
      if (page.length < 1000) break;
    }
    return data;
  };
  let summary: any;
  if (sections.includes('summary')) {
    aborted();
    summary = await getWebsiteStats(website.id, filters);
    aborted();
    summary = JSON.parse(
      JSON.stringify(summary, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)),
    );
    add('summary.csv', [summary]);
  }
  if (sections.includes('dimensions')) {
    for (const [name, column, session] of [
      ['pages', 'url_path', false],
      ['sources', 'referrer_domain', false],
      ['browsers', 'browser', true],
      ['devices', 'device', true],
      ['countries', 'country', true],
    ] as const) {
      const query = session
        ? `SELECT ${column === 'country' ? getPostgresCountrySQL('e.country') : `e.${column}`} AS name,COUNT(DISTINCT s.session_id) AS visitors,COUNT(*) FILTER(WHERE event_type=1) AS views FROM selected s JOIN session e ON e.session_id=s.session_id AND e.website_id={{websiteId::uuid}} WHERE s.event_type=1 GROUP BY 1 ORDER BY visitors DESC,name`
        : `SELECT ${column} AS name,COUNT(DISTINCT session_id) AS visitors,COUNT(*) AS views FROM selected WHERE event_type=1 GROUP BY 1 ORDER BY views DESC,name`;
      add(`${name}.csv`, await paged(query));
    }
  }
  if (sections.includes('events')) {
    add(
      'events.csv',
      await paged(
        'SELECT event_name AS name,COUNT(*) AS triggers,COUNT(DISTINCT session_id) AS visitors FROM selected WHERE event_type=2 GROUP BY 1 ORDER BY triggers DESC,name',
      ),
    );
    add(
      'event-properties.csv',
      await paged(
        'SELECT s.event_name AS event,d.data_key AS property,d.data_type AS type,COALESCE(d.string_value,d.number_value::text,d.date_value::text) AS value,COUNT(DISTINCT s.event_id) AS triggers FROM event_data d JOIN selected s ON s.event_id=d.website_event_id WHERE d.website_id={{websiteId::uuid}} AND s.event_type=2 GROUP BY 1,2,3,4 ORDER BY event,property,type,value',
      ),
    );
  }
  if (sections.includes('sessions')) {
    add(
      'sessions.csv',
      await paged(
        `SELECT s.session_id AS id,MIN(s.created_at) AS "firstAt",MAX(s.created_at) AS "lastAt",COUNT(*) FILTER(WHERE event_type=1) AS views,COUNT(*) FILTER(WHERE event_type=2) AS events,COUNT(DISTINCT visit_id) AS visits,MAX(e.browser) AS browser,MAX(e.device) AS device,${getPostgresCountrySQL('MAX(e.country)')} AS country FROM selected s JOIN session e ON e.session_id=s.session_id AND e.website_id={{websiteId::uuid}} GROUP BY s.session_id ORDER BY "lastAt",s.session_id`,
        r => ({ ...r, id: mask(r.id) }),
      ),
    );
  }
  if (sections.includes('config')) {
    const sizes = await run(
      'SELECT COALESCE((SELECT SUM(octet_length(parameters::text)) FROM report WHERE website_id={{websiteId::uuid}}),0)+COALESCE((SELECT SUM(octet_length(parameters::text)) FROM segment WHERE website_id={{websiteId::uuid}}),0) AS bytes',
    );
    if (Number(sizes[0]?.bytes) > EXPORT_MAX_BYTES - bytes)
      throw new LiekanError('保存配置超过 50 MiB，请缩小导出范围', 413);
    const reports = await paged(
      'SELECT name,type,parameters FROM report WHERE website_id={{websiteId::uuid}} ORDER BY report_id',
    );
    add('saved-reports.json', reports, 'json');
    const segments = await paged(
      'SELECT name,type,parameters FROM segment WHERE website_id={{websiteId::uuid}} ORDER BY segment_id',
    );
    add('saved-audiences.json', segments, 'json');
    add(
      'configuration.json',
      [{ website: { name: website.name, domain: website.domain } }],
      'json',
    );
  }
  aborted();
  const manifest = {
    product: 'Liekan 猎看统计',
    createdAt: new Date().toISOString(),
    website: { name: website.name, domain: website.domain },
    range: { startAt: p.startAt, endAt: p.endAt, timezone: p.timezone },
    filterFields: Object.keys(p.filters),
    sections,
    format: p.format,
    consistency: 'repeatable-read',
    limits: { rows: EXPORT_MAX_ROWS, bytes: EXPORT_MAX_BYTES },
    privacy: '会话标识在本文件内脱敏；不包含原始 IP、账户凭据、密钥或备份代码',
    files: files.map(({ name, rows, fields }) => ({ name, rows, fields })),
  };
  const manifestContent = JSON.stringify(manifest, null, 2);
  bytes += Buffer.byteLength(manifestContent);
  if (bytes > EXPORT_MAX_BYTES) throw new LiekanError('字段清单与数据超过 50 MiB，请缩小范围', 413);
  const name = `liekan-export-${new Date().toISOString().replace(/[:.]/g, '-')}.${p.format}`;
  return exportFilesResponse(files, p.format, summary, manifest, name, manifestContent, signal);
}
function exportFilesResponse(
  files: { content: string; name: string }[],
  format: 'csv' | 'json' | 'zip',
  summary: unknown,
  manifest: unknown,
  name: string,
  manifestContent: string,
  signal: AbortSignal,
) {
  let canceled = false;
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        const onAbort = () => {
          canceled = true;
        };
        signal.addEventListener('abort', onAbort, { once: true });
        const emit = (frame: ExportFrame) => {
          if (canceled || signal.aborted) throw new LiekanError('导出已取消', 499);
          controller.enqueue(new TextEncoder().encode(JSON.stringify(frame) + '\n'));
        };
        try {
          emit({ type: 'progress', stage: '已完成数据查询与范围校验', percent: 0 });
          let file: Buffer;
          if (format === 'zip') {
            const zip = new JSZip();
            files.forEach(f => zip.file(f.name, f.content));
            zip.file('manifest.json', manifestContent);
            file = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }, update =>
              emit({
                type: 'progress',
                stage: '正在生成文件',
                percent: Math.round(update.percent * 0.8),
              }),
            );
          } else
            file = Buffer.from(
              format === 'csv' ? files[0].content : JSON.stringify({ summary, manifest }),
            );
          if (file.length > EXPORT_MAX_BYTES)
            throw new LiekanError('下载文件超过 50 MiB，请缩小范围', 413);
          emit({
            type: 'file',
            name,
            mime:
              format === 'zip'
                ? 'application/zip'
                : format === 'csv'
                  ? 'text/csv;charset=utf-8'
                  : 'application/json',
            size: file.length,
            manifest,
          });
          for (let offset = 0; offset < file.length; offset += 49152) {
            emit({ type: 'chunk', data: file.subarray(offset, offset + 49152).toString('base64') });
            emit({
              type: 'progress',
              stage: '正在传输下载文件',
              percent:
                80 +
                Math.round((Math.min(file.length, offset + 49152) / Math.max(1, file.length)) * 20),
            });
            await new Promise(resolve => setTimeout(resolve, 0));
          }
          emit({ type: 'complete' });
          controller.close();
        } catch (error) {
          if (!canceled && !signal.aborted) {
            controller.enqueue(
              new TextEncoder().encode(
                JSON.stringify({
                  type: 'error',
                  status: error instanceof LiekanError ? error.status : 500,
                  message: error instanceof LiekanError ? error.message : '文件生成失败',
                }) + '\n',
              ),
            );
            controller.close();
          }
        } finally {
          signal.removeEventListener('abort', onAbort);
        }
      },
      cancel() {
        canceled = true;
      },
    }),
    {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}

async function prepareKeywordSnapshot(
  website: { id: string; name: string; domain: string },
  p: Extract<ReturnType<typeof exportRequestSchema.parse>, { kind: string }>,
  signal: AbortSignal,
) {
  validateKeywordRange(p);
  const facts = await readKeywordFacts(website.id, p, signal);
  const conditions = keywordConditionsSchema.parse(p);
  const selected = selectKeywords(facts.rows, conditions, facts.hasGoals);
  if (selected.rows.length > EXPORT_MAX_ROWS)
    throw new LiekanError('关键词导出超过 100,000 行，请缩小范围', 413);
  const createdAt = new Date(facts.readAt).toISOString();
  const safeConditions = sanitizeExportValue({
    ...conditions,
    search: redactKeywordTerm(conditions.search),
  });
  const metadata = [
    ['统计读取时间', createdAt],
    ['开始时间', new Date(p.startAt).toISOString()],
    ['结束时间', new Date(p.endAt).toISOString()],
    ['时区', p.timezone],
    ['筛选条件', JSON.stringify(safeConditions)],
    ['一致性', 'repeatable-read'],
  ];
  const fields = [
    '关键词/状态',
    '搜索引擎',
    '识别依据',
    '会话数',
    '搜索渠道占比(%)',
    '跳出率(%)',
    '转化率(%)',
  ];
  const data = selected.rows.map(row => [
    row.keyword || keywordStatusLabels[row.status],
    row.engine,
    keywordEvidenceLabels[row.evidence],
    row.sessions,
    row.share,
    row.bounceRate,
    row.conversionRate,
  ]);
  const content =
    '\ufeff' +
    Papa.unparse(metadata.map(row => row.map(safeCsvCell))) +
    '\r\n\r\n' +
    Papa.unparse({ fields: fields.map(safeCsvCell), data: data.map(row => row.map(safeCsvCell)) });
  if (Buffer.byteLength(content) > EXPORT_MAX_BYTES)
    throw new LiekanError('关键词导出超过 50 MiB，请缩小范围', 413);
  const manifest = {
    kind: p.kind,
    createdAt,
    website: { name: website.name, domain: website.domain },
    range: { startAt: p.startAt, endAt: p.endAt, timezone: p.timezone },
    conditions: safeConditions,
    rows: selected.rows.length,
    fields,
    consistency: 'repeatable-read',
    limits: { rows: EXPORT_MAX_ROWS, bytes: EXPORT_MAX_BYTES },
  };
  return exportFilesResponse(
    [{ name: 'source-keywords.csv', content }],
    'csv',
    undefined,
    manifest,
    `liekan-source-keywords-${createdAt.replace(/[:.]/g, '-')}.csv`,
    JSON.stringify(manifest),
    signal,
  );
}
