'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useState } from 'react';
import type {
  FeatureEntity,
  FeatureRange,
  FeatureRoute,
  FeatureUser,
} from '@/lib/liekan/contracts/features';
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
export function useData<T = any>(
  key: string | any[],
  load: (signal: AbortSignal) => Promise<T>,
  enabled = true,
) {
  const c = useFeature();
  return useQuery<T>({
    queryKey: [
      'liekan-feature',
      c?.user?.id,
      c?.siteId,
      c?.route?.id,
      c?.range,
      c?.filters,
      ...(Array.isArray(key) ? key : [key]),
    ],
    queryFn: ({ signal }) => load(signal),
    enabled,
    retry: false,
  });
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
      await Promise.all([
        client.invalidateQueries({ queryKey: ['liekan-feature'] }),
        client.invalidateQueries({ queryKey: ['2fa-status'] }),
      ]);
      c?.notify(message);
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
