import { endOfDay, startOfDay, subDays } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { pagableTables } from '@/lib/liekan/contracts/query';
import { columns, primaryTables } from './data';
import type { Resource } from './types';

export const viewParamKeys = [
  'filter',
  'search',
  'page',
  'chartPeriod',
  'sort',
  'direction',
  'compareWeek',
  'live',
  'cursor',
  'seek',
] as const;
export const resetViewParams = Object.fromEntries(viewParamKeys.map(key => [key, undefined]));
const pagableSet = new Set<string>(pagableTables);
// URL 扁平参数 tp_<table>=<page> → tablePages；仅接受白名单表且页码 ≥ 2（第 1 页归一为不传参）。
export function readTablePages(params: Record<string, string>) {
  const tablePages: Record<string, number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!key.startsWith('tp_')) continue;
    const table = key.slice(3);
    const page = Number(value);
    if (pagableSet.has(table) && Number.isSafeInteger(page) && page > 1 && page <= 100000)
      tablePages[table] = page;
  }
  return tablePages;
}
export const clearTablePages = (tablePages: Record<string, number>) =>
  Object.fromEntries(Object.keys(tablePages).map(table => [`tp_${table}`, undefined]));
const filters: Partial<Record<Resource, string[]>> = {
  'human/search-engines': ['全部', '传统搜索', 'AI 搜索引荐'],
  'ai/bots': ['全部', 'AI 训练', 'AI 搜索', '用户触发', '传统搜索', '其他已知'],
  'ai/pages': ['按抓取量', '按重复率', '按蜘蛛数'],
  content: ['按 PV', '按入口', '按时长'],
  logs: ['全部', '仅 AI 蜘蛛', '未知／未分类', '仅异常'],
};
export function readViewState(params: Record<string, string>, resource: Resource) {
  const table = primaryTables[resource];
  const page = Number(params.page);
  const cursor =
    resource === 'logs' && params.cursor?.length <= 512 && ['after', 'before'].includes(params.seek)
      ? params.cursor
      : '';
  return {
    filter: filters[resource]?.includes(params.filter) ? params.filter : '',
    search: ['logs', 'human/geo'].includes(resource) ? (params.search || '').slice(0, 200) : '',
    logPage:
      resource === 'logs' && Number.isSafeInteger(page) && page > 0 && page <= 100000 ? page : 1,
    cursor,
    seek: cursor ? params.seek : '',
    chartPeriod: (['overview', 'human/overview'].includes(resource) &&
    ['30d', '7d', '24h'].includes(params.chartPeriod)
      ? params.chartPeriod
      : '30d') as '30d' | '7d' | '24h',
    sort: {
      label: [
        ...(columns[table] || []),
        ...(resource === 'overview' ? columns.visitorTopBody : []),
      ].some(([, label]) => label === params.sort)
        ? params.sort
        : '',
      direction: params.direction === 'asc' ? 1 : -1,
    },
    compare: resource === 'human/overview' && params.compareWeek === '1',
    tablePages: resource === 'logs' ? {} : readTablePages(params),
  };
}
export function previousWeekRange(startAt: number, endAt: number) {
  const week = 7 * 86400000;
  return { startAt: startAt - week, endAt: endAt - week };
}
export function isLiveLogView(params: Record<string, string>, resource: Resource) {
  return (
    resource === 'logs' && (params.live === '1' || !params.date || params.dateMode === 'default')
  );
}
export function defaultDateRange(now: number, timezone = 'Asia/Shanghai') {
  const local = toZonedTime(new Date(now), timezone);
  return {
    startAt: +fromZonedTime(startOfDay(subDays(local, 29)), timezone),
    endAt: +fromZonedTime(endOfDay(local), timezone),
  };
}
