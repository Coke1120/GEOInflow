'use client';
import { useDateRange as useCoreDateRange } from '@/components/hooks/useDateRange';
import { useNavigation as useCoreNavigation } from '@/components/hooks/useNavigation';
import { DATE_RANGE_CONFIG, DEFAULT_DATE_RANGE_VALUE } from '@/lib/constants';
import { getItem } from '@/lib/storage';
export function useFeatureDateRange(timezone: string) {
  const { query } = useCoreNavigation();
  const date = query.date || getItem(DATE_RANGE_CONFIG) || DEFAULT_DATE_RANGE_VALUE;
  return useCoreDateRange({ timezone, ignoreOffset: String(date).startsWith('range:') });
}
export { AdminNav } from '@/app/(main)/admin/AdminNav';
export { SettingsNav } from '@/app/(main)/settings/SettingsNav';
export { WebsiteNav } from '@/app/(main)/websites/[websiteId]/WebsiteNav';
export { useWebsite } from '@/components/hooks/context/useWebsite';
export { useLoginQuery } from '@/components/hooks/queries/useLoginQuery';
export { useApi } from '@/components/hooks/useApi';
export { useDateRange } from '@/components/hooks/useDateRange';
export { useNavigation } from '@/components/hooks/useNavigation';
export { UserButton } from '@/components/input/UserButton';
