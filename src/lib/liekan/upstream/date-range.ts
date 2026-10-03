import { DEFAULT_DATE_RANGE_VALUE } from '@/lib/constants';
import { getOffsetDateRange, parseDateRange } from '@/lib/date';

export function readFeatureDateRange(
  value: string,
  unit: string,
  offset: number,
  timezone: string,
  locale = 'zh-CN',
) {
  try {
    if (unit && !['minute', 'hour', 'day', 'week', 'month', 'year'].includes(unit))
      throw new Error('Invalid unit');
    if (!Number.isSafeInteger(offset)) throw new Error('Invalid offset');
    const parsed = parseDateRange(value, unit, locale, timezone);
    const dateRange = value.startsWith('range:') ? parsed : getOffsetDateRange(parsed, offset);
    if (
      !dateRange ||
      !Number.isFinite(+dateRange.startDate) ||
      !Number.isFinite(+dateRange.endDate) ||
      +dateRange.startDate < 0 ||
      +dateRange.endDate < +dateRange.startDate
    )
      throw new Error('Invalid range');
    return { dateRange, invalidDate: false };
  } catch {
    return {
      dateRange: parseDateRange(DEFAULT_DATE_RANGE_VALUE, undefined, locale, timezone),
      invalidDate: true,
    };
  }
}
