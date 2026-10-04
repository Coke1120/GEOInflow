'use client';
import { createContext, type ReactNode, useContext } from 'react';
import styles from '@/styles/liekan/Loading.module.css';

const LoadingContext = createContext(false);
export const useDataLoading = () => useContext(LoadingContext);

export function DataLoading({
  loading,
  label = '正在读取统计数据',
  children,
}: {
  loading: boolean;
  label?: string;
  children: ReactNode;
}) {
  const inherited = useDataLoading();
  return (
    <LoadingContext.Provider value={loading}>
      {loading && !inherited && (
        <span className={styles.status} role="status">
          {label}
        </span>
      )}
      {children}
    </LoadingContext.Provider>
  );
}

export function Skeleton({ width = '100%', height = '1em' }: { width?: string; height?: string }) {
  return <span className={styles.skeleton} style={{ width, height }} aria-hidden="true" />;
}

export function LoadingLines({ lines = 3 }: { lines?: number }) {
  return (
    <div className={styles.lines} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '65%' : '100%'} />
      ))}
    </div>
  );
}

export function ChartLoading() {
  return (
    <div className={styles.chart} aria-hidden="true">
      <div className={styles.plot} />
      <LoadingLines lines={1} />
    </div>
  );
}
