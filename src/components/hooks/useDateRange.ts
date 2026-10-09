import { useMemo } from 'react';
import { useLocale } from '@/components/hooks/useLocale';
import { useNavigation } from '@/components/hooks/useNavigation';
import { DATE_RANGE_CONFIG, DEFAULT_DATE_RANGE_VALUE } from '@/lib/constants';
import { getCompareDate, getOffsetDateRange, parseDateRange } from '@/lib/date';
import { getItem } from '@/lib/storage';
import { useDateRangeClock } from '@/lib/liekan/upstream/date-range-clock';

export function useDateRange(options: { ignoreOffset?: boolean; timezone?: string } = {}) {
  const {
    query: { date = '', unit = '', offset = 0, compare = 'prev' },
  } = useNavigation();
  const { locale } = useLocale();
  const readTime = useDateRangeClock(options.timezone);
  const dateRange = useMemo(() => {
    const dateRangeObject = parseDateRange(
      date || getItem(DATE_RANGE_CONFIG) || DEFAULT_DATE_RANGE_VALUE,
      unit,
      locale,
      options.timezone,
      readTime,
    );

    return !options.ignoreOffset && offset
      ? getOffsetDateRange(dateRangeObject, +offset)
      : dateRangeObject;
  }, [date, unit, offset, options.ignoreOffset, options.timezone, readTime]);

  const dateCompare = getCompareDate(compare, dateRange.startDate, dateRange.endDate);

  return {
    date,
    unit,
    offset,
    compare,
    isAllTime: date.endsWith(`:all`),
    isCustomRange: date.startsWith('range:'),
    dateRange,
    dateCompare,
  };
}
