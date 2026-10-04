'use client';
import {
  withClientFreshness,
  freshnessStaleTime,
  shareWithFreshness,
} from '@/lib/liekan/upstream/client-freshness';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { hidesPreviousData, useDataLoading } from '../LoadingState';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import type {
  FeatureEntity,
  FeatureRange,
  FeatureRoute,
  FeatureUser,
} from '@/lib/liekan/contracts/features';
import { hasDateControl, needsWebsite } from '@/lib/liekan/contracts/navigation';
import type { featureApi } from '@/lib/liekan/upstream/features-client';

export interface FeatureContextValue {
  user: FeatureUser;
  route: FeatureRoute;
  api: typeof featureApi;
  sites: FeatureEntity[];
  sitesLoading?: boolean;
  teams: FeatureEntity[];
  siteId: string;
  site: FeatureEntity;
  range: FeatureRange;
  filters: Record<string, any>;
  query: Record<string, string>;
  href: (page: string, params?: Record<string, any>) => string;
  navigate: (page: string, params?: Record<string, any>) => void;
  notify: (message: string) => void;
  refresh: () => Promise<void>;
  entity?: FeatureEntity;
  setEntity?: (entity: FeatureEntity) => void;
  updateQuery?: (params: Record<string, any>) => void;
}
const Context = createContext<FeatureContextValue>(null);
export const FeatureProvider = ({
  value,
  children,
}: {
  value: FeatureContextValue;
  children: ReactNode;
}) => <Context.Provider value={value}>{children}</Context.Provider>;
export const useFeature = () => useContext(Context);
export function useResourceContext(entity?: FeatureEntity) {
  const c = useFeature();
  useEffect(() => {
    if (entity?.id) c?.setEntity?.(entity);
  }, [entity?.id, entity?.name, entity?.teamId, entity?.userId, c?.setEntity]);
}
export function useData<T = any>(
  key: string | any[],
  load: (signal: AbortSignal) => Promise<T>,
  enabled = true,
  options: { queryKey?: any[]; refetchOnMount?: 'always'; staleTime?: number } = {},
) {
  const c = useFeature();
  const prerequisitesLoading = useDataLoading();
  const query = useQuery<T>({
    queryKey: options.queryKey ?? [
      'liekan-feature',
      c?.user?.id,
      c?.siteId,
      c?.route?.teamId,
      c?.route?.context,
      c?.query?.scope,
      c?.route?.id,
      c?.route && hasDateControl(c.route) ? c?.range : undefined,
      c?.route && needsWebsite(c.route) ? c?.filters : undefined,
      ...(Array.isArray(key) ? key : [key]),
    ],
    queryFn: ({ signal }) => withClientFreshness(signal, () => load(signal)),
    enabled: enabled && !prerequisitesLoading,
    retry: false,
    staleTime: query =>
      options.staleTime === 0 ||
      ['realtime', 'session-detail', 'replay-view'].includes(c?.route?.page)
        ? 0
        : freshnessStaleTime(
            query,
            options.staleTime ?? (c?.route && hasDateControl(c.route) ? 30000 : 300000),
          ),
    gcTime: 600000,
    structuralSharing: shareWithFreshness,
    ...(options.refetchOnMount ? { refetchOnMount: options.refetchOnMount } : {}),
  });
  if (prerequisitesLoading) return { ...query, data: undefined, isPending: true, error: null };
  return hidesPreviousData(query.error) ? { ...query, data: undefined } : query;
}
export function useAction() {
  const c = useFeature();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run<T>(action: () => Promise<T>, message = '已保存'): Promise<T> {
    setBusy(true);
    setError('');
    try {
      const result = await action();
      c?.notify(message);
      await client.invalidateQueries({ queryKey: ['2fa-status'] });
      const websiteId = c?.siteId;
      const globalEdit =
        !websiteId || ['website-settings', 'websites', 'onboarding'].includes(c?.route?.page);
      const filters = {
        predicate: (query: { queryKey: readonly unknown[] }) => {
          const key = query.queryKey;
          if (key[0] === 'liekan')
            return key[13] === c?.user?.id && (!websiteId || key[1] === websiteId);
          if (key[0] !== 'liekan-feature' || !key.includes(c?.user?.id)) return false;
          return (
            globalEdit ||
            key.includes(websiteId) ||
            (!!c?.route?.id && key.includes(c.route.id)) ||
            key.includes('resource-analytics') ||
            key.some(value => Array.isArray(value) && value.includes(websiteId))
          );
        },
      };
      await client.cancelQueries(filters);
      const updating = client.invalidateQueries(filters);
      await updating;
      return result;
    } catch (e: any) {
      setError(e?.message || '操作失败');
      throw e;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error, setError };
}
