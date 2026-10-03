import { z } from 'zod';
import ipaddr from 'ipaddr.js';
export const exportSections = ['summary', 'dimensions', 'events', 'sessions', 'config'] as const;
export const exportRequestSchema = z
  .object({
    startAt: z.number().int().nonnegative(),
    endAt: z.number().int().nonnegative(),
    timezone: z.string().max(80).default('Asia/Shanghai'),
    format: z.enum(['zip', 'csv', 'json']),
    sections: z.array(z.enum(exportSections)).min(1).max(5),
    filters: z.record(z.string(), z.string().max(2000)).default({}),
  })
  .refine(p => p.endAt >= p.startAt && p.endAt - p.startAt <= 1096 * 86400000, {
    message: '日期范围上限 3 年',
  });
export type ExportRequest = z.infer<typeof exportRequestSchema>;
export const EXPORT_MAX_ROWS = 100000;
export const EXPORT_MAX_BYTES = 50 * 1024 * 1024;
const sensitive =
  /(?:password|secret|token|api.?key|authorization|cookie|backup.?code|email|e.?mail|phone|mobile.?number|(?:^|[_-])ip(?:$|[_-])|ip.?address)/i;
function containsEmail(value: string) {
  for (let at = value.indexOf('@'); at >= 0; at = value.indexOf('@', at + 1)) {
    if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(value.slice(Math.max(0, at - 254), at + 255))) return true;
  }
  return false;
}
export function sanitizeExportValue(value: unknown, key = ''): unknown {
  if (sensitive.test(key)) return '[已脱敏]';
  if (Array.isArray(value)) return value.map(v => sanitizeExportValue(v));
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    const property = row.propertyName ?? row.property ?? row.name;
    const privateCondition = typeof property === 'string' && sensitive.test(property);
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        privateCondition && ['value', 'values'].includes(k)
          ? '[已脱敏]'
          : sanitizeExportValue(v, k),
      ]),
    );
  }
  if (
    typeof value === 'string' &&
    (/\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(value) ||
      containsEmail(value) ||
      (value.match(/[a-fA-F0-9]{0,39}:[a-fA-F0-9:.%]{1,64}/g) || []).some(address =>
        ipaddr.isValid(address),
      ))
  )
    return '[已脱敏]';
  return value;
}
export function safeCsvCell(value: unknown) {
  if (typeof value === 'string' && (/^[\s]*[=+@-]/.test(value) || /^[\t\r\n]/.test(value)))
    return `'${value}`;
  return value;
}
export type ExportFrame =
  | { type: 'progress'; stage: string; percent: number }
  | { type: 'file'; name: string; mime: string; size: number; manifest: unknown }
  | { type: 'chunk'; data: string }
  | { type: 'complete' }
  | { type: 'error'; status: number; message: string };
