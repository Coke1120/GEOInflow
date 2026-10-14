'use client';
import { useMemo } from 'react';
import { useNavigation as useCoreNavigation } from '@/components/hooks/useNavigation';
import { DATE_RANGE_CONFIG, DEFAULT_DATE_RANGE_VALUE } from '@/lib/constants';
import { getCompareDate } from '@/lib/date';
import { getItem } from '@/lib/storage';
import { readFeatureDateRange } from './date-range';
import { useDateRangeClock } from './date-range-clock';
export function useFeatureDateRange(timezone: string) {
  const { query } = useCoreNavigation();
  const date = query.date || getItem(DATE_RANGE_CONFIG) || DEFAULT_DATE_RANGE_VALUE;
  const now = useDateRangeClock(timezone, !String(date).startsWith('range:'));
  const { dateRange, invalidDate } = useMemo(
    () =>
      readFeatureDateRange(
        String(date),
        query.unit || '',
        Number(query.offset || 0),
        timezone,
        'zh-CN',
        now,
      ),
    [date, query.unit, query.offset, timezone, now],
  );
  return {
    dateRange,
    invalidDate,
    dateCompare: getCompareDate(query.compare || 'prev', dateRange.startDate, dateRange.endDate),
  };
}
export { AdminNav } from '@/app/(main)/admin/AdminNav';
export { SettingsNav } from '@/app/(main)/settings/SettingsNav';
export { WebsiteNav } from '@/app/(main)/websites/[websiteId]/WebsiteNav';
export { useWebsite } from '@/components/hooks/context/useWebsite';
export { useLoginQuery } from '@/components/hooks/queries/useLoginQuery';
export { useWebsiteQuery } from '@/components/hooks/queries/useWebsiteQuery';
export { useApi } from '@/components/hooks/useApi';
export { useDateRange } from '@/components/hooks/useDateRange';
export { useNavigation } from '@/components/hooks/useNavigation';
export { UserButton } from '@/components/input/UserButton';

export { useApp as useFeatureAppState } from '@/store/app';
