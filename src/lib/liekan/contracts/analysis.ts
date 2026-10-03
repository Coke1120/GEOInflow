import { z } from 'zod';
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
export function completedObservationDate(endAt: number, timezone: string) {
  const day = formatInTimeZone(endAt, timezone, 'yyyy-MM-dd');
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  if (endAt >= +fromZonedTime(`${next.toISOString().slice(0, 10)}T00:00:00`, timezone) - 1)
    return day;
  next.setUTCDate(next.getUTCDate() - 2);
  return next.toISOString().slice(0, 10);
}
export function relativeDaySeries(points: any[], startAt: number, endAt: number, timezone: string) {
  const first = new Date(`${formatInTimeZone(startAt, timezone, 'yyyy-MM-dd')}T00:00:00Z`),
    last = formatInTimeZone(endAt, timezone, 'yyyy-MM-dd');
  const byDay = new Map(points.map(p => [String(p.x).slice(0, 10), Number(p.y)]));
  const result: number[] = [];
  for (; first.toISOString().slice(0, 10) <= last; first.setUTCDate(first.getUTCDate() + 1)) {
    if (result.length >= 1097) return [];
    result.push(byDay.get(first.toISOString().slice(0, 10)) || 0);
  }
  return result;
}
export function savedConditionParameters(
  conditions: AnalysisCondition[],
  match: string,
  property = '',
  value = '',
  preserved: any[] = [],
) {
  const props = [
    ...conditions
      .filter(c => c.name === 'sessionPlan' && c.value.trim())
      .map(c => ({ propertyName: 'plan', dataType: 1, operator: c.operator, value: c.value })),
    ...preserved,
    ...(property && value ? [{ propertyName: property, dataType: 1, operator: 'eq', value }] : []),
  ];
  return {
    filters: conditions.filter(c => c.value.trim() && c.name !== 'sessionPlan'),
    match,
    ...(props.length ? { sessionPropertyFilters: props } : {}),
  };
}
export function featureDateRange(
  range: { value?: string; startDate: Date; endDate: Date; unit?: string },
  timezone: string,
) {
  const custom = range.value?.startsWith('range:');
  return {
    startAt: +(custom ? range.startDate : fromZonedTime(range.startDate, timezone)),
    endAt: +(custom ? range.endDate : fromZonedTime(range.endDate, timezone)),
    timezone,
    unit: range.unit || 'day',
  };
}
export const analysisQuery = z
  .object({
    startAt: z.coerce.number().int().min(0),
    endAt: z.coerce.number().int().min(0),
    timezone: z.string().max(80).default('Asia/Shanghai'),
    unit: z.enum(['minute', 'hour', 'day', 'week', 'month', 'year']).default('day'),
    kind: z
      .enum([
        'events',
        'utm',
        'sources',
        'sessions',
        'session',
        'session-properties',
        'realtime',
        'performance',
        'revenue',
        'attribution',
        'heatmap-scroll',
        'replays',
      ])
      .default('events'),
    urlPath: z.string().max(500).optional(),
    saved: z.enum(['0', '1']).optional(),
    attributionStep: z.string().max(200).optional(),
    attributionModel: z.enum(['first-click', 'last-click']).optional(),
    attributionType: z.enum(['path', 'event']).optional(),
    attributionSource: z.string().max(500).optional(),
    dimension: z.enum(['source', 'medium', 'campaign', 'content', 'term']).optional(),
    model: z.enum(['first-click', 'last-click']).optional(),
    type: z.enum(['path', 'event']).optional(),
    step: z.string().max(200).optional(),
    retentionDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    retentionDay: z.coerce.number().int().min(1).max(31).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    eventName: z.string().max(200).optional(),
    propertyName: z.string().max(200).optional(),
    sessionId: z.uuid().optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
  })
  .catchall(z.string().max(2000))
  .refine(p => p.endAt >= p.startAt && p.endAt - p.startAt <= 1096 * 86400000, {
    message: '日期范围无效，上限 3 年',
  });
export const journeyQuery = z
  .object({
    startAt: z.coerce.number().int().min(0),
    endAt: z.coerce.number().int().min(0),
    timezone: z.string().max(80).default('Asia/Shanghai'),
    steps: z.coerce.number().int().min(2).max(7).default(3),
    type: z.enum(['all', 'pages', 'events']).default('all'),
    startStep: z.string().max(200).default(''),
    endStep: z.string().max(200).default(''),
    sequence: z.string().max(2000).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
  })
  .catchall(z.string().max(2000))
  .refine(p => p.endAt >= p.startAt && p.endAt - p.startAt <= 1096 * 86400000, {
    message: '日期范围无效，上限 3 年',
  });
export type JourneyRow = {
  nodes: string[];
  visitors: number;
  visits: number;
  seconds: number;
  source: string | null;
};
export type JourneyData = {
  rows: JourneyRow[];
  visitors: number;
  sessions?: any[];
  count?: number;
  page: number;
  pageSize: number;
  limited: boolean;
};
export const percentage = (num: number, den: number) =>
  den ? `${((num / den) * 100).toFixed(2)}%` : '—';
export function duration(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
export type AnalysisCondition = { name: string; operator: string; value: string };
export function conditionsToQuery(
  conditions: AnalysisCondition[],
  match = 'all',
  property = '',
  value = '',
  preserved: any[] = [],
) {
  const params: Record<string, string> = { match };
  const counters: Record<string, number> = {};
  let propertyIndex = 0;
  for (const c of conditions) {
    if (!c.value.trim()) continue;
    if (c.name === 'sessionPlan') {
      params[`spf${propertyIndex++}`] = `1.${c.operator}.plan.${c.value}`;
      continue;
    }
    const n = counters[c.name] || 0;
    counters[c.name] = n + 1;
    params[c.name + (n || '')] = `${c.operator}.${c.value}`;
  }
  if (property.trim() && value.trim())
    params[`spf${propertyIndex++}`] =
      `1.eq.${encodeURIComponent(property).replaceAll('.', '%2E')}.${value}`;
  for (const p of preserved)
    params[`spf${propertyIndex++}`] =
      `${p.dataType}.${p.operator}.${encodeURIComponent(p.propertyName).replaceAll('.', '%2E')}.${p.value}`;
  return params;
}
export function decodePropertyConditions(query: Record<string, string>) {
  const plans: AnalysisCondition[] = [],
    props: any[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (!/^spf\d+$/.test(key)) continue;
    const match = value.match(/^(\d+)\.([a-z]+)\.([^.]+)\.(.*)$/);
    if (!match) continue;
    let propertyName: string;
    try {
      propertyName = decodeURIComponent(match[3]);
    } catch {
      continue;
    }
    const p = { propertyName, dataType: Number(match[1]), operator: match[2], value: match[4] };
    if (propertyName === 'plan' && p.dataType === 1)
      plans.push({ name: 'sessionPlan', operator: p.operator, value: p.value });
    else props.push(p);
  }
  const field = props.find(p => p.dataType === 1 && p.operator === 'eq');
  return {
    plans,
    property: field?.propertyName || '',
    value: field?.value || '',
    preserved: props.filter(p => p !== field),
  };
}
export function retentionSummary(rows: any[], day: number, cutoff: string) {
  let total = 0,
    returned = 0;
  for (const cohort of rows.filter(r => Number(r.day) === 0)) {
    const date = new Date(`${String(cohort.date).slice(0, 10)}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + day);
    if (date.toISOString().slice(0, 10) > cutoff) continue;
    total += Number(cohort.visitors);
    returned += Number(
      rows.find(
        r =>
          String(r.date).slice(0, 10) === String(cohort.date).slice(0, 10) && Number(r.day) === day,
      )?.returnVisitors || 0,
    );
  }
  return { total, returned, percentage: total ? (returned / total) * 100 : null };
}
