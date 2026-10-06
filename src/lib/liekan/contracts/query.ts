import { z } from 'zod';
// 可分页明细表白名单：请求以扁平参数 tp_<table>=<page> 携带页码。
// 其余明细表行数有界或已由独立协议（logBody keyset）分页，不在白名单内。
// reportQuery 保持纯对象 schema（下游有 pick/extend/shape 派生），白名单校验收口在 parseReportQuery。
export const pagableTables = [
  'topBody',
  'visitorTopBody',
  'pgBody',
  'visitorPgBody',
  'cityBody',
  'srcBody',
  'apBody',
] as const;
export type PagableTable = (typeof pagableTables)[number];
const pagableTableSet = new Set<string>(pagableTables);

export const reportQuery = z.object({
  refresh: z.literal('1').optional(),
  resource: z.enum([
    'overview',
    'ai/overview',
    'ai/bots',
    'ai/pages',
    'ai/preference',
    'human/overview',
    'human/geo',
    'human/sources',
    'content',
    'conversions',
    'logs',
  ]),
  startAt: z.coerce.number().int().min(0),
  endAt: z.coerce.number().int().min(0),
  timezone: z.string().max(80).default('Asia/Shanghai'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  cursor: z.string().max(512).default(''),
  seek: z.enum(['after', 'before']).default('after'),
  filter: z.enum(['', 'ai', 'abnormal', 'other']).default(''),
  search: z.string().max(200).default(''),
  chartPeriod: z.enum(['30d', '7d', '24h']).default('30d'),
  tablePages: z.record(z.string(), z.coerce.number().int().min(1).max(100000)).default({}),
});
export type ReportQuery = z.output<typeof reportQuery>;

// URL 查询是扁平键值（Object.fromEntries），tp_<table> 先归并为 tablePages 再解析；
// 键按字典序排序，保证相同页码集合生成稳定的缓存键与序列化结果。
export function parseReportQuery(input: unknown): z.ZodSafeParseResult<ReportQuery> {
  let flat: unknown = input;
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const copy: Record<string, unknown> = { ...(input as Record<string, unknown>) };
    const tablePages: Record<string, unknown> = {};
    for (const key of Object.keys(copy).sort()) {
      if (!key.startsWith('tp_')) continue;
      tablePages[key.slice(3)] = copy[key];
      delete copy[key];
    }
    if (Object.keys(tablePages).length) copy.tablePages = tablePages;
    flat = copy;
  }
  const parsed = reportQuery.safeParse(flat);
  if (!parsed.success) return parsed;
  const foreign = Object.keys(parsed.data.tablePages).find(table => !pagableTableSet.has(table));
  return foreign ? (z.never().safeParse(foreign) as z.ZodSafeParseResult<ReportQuery>) : parsed;
}
