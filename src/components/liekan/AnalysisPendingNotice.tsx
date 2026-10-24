'use client';
import { useSyncExternalStore } from 'react';
import { analysisPendingStore } from '@/lib/liekan/upstream/analysis-query-client';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';
import styles from '@/styles/liekan/Shell.module.css';

export function AnalysisPendingNotice({
  websiteId,
  websiteHandle,
}: {
  websiteId?: string;
  websiteHandle?: string;
}) {
  const i18n = useLiekanI18n();
  const state = useSyncExternalStore(
    analysisPendingStore.subscribe,
    analysisPendingStore.snapshot,
    analysisPendingStore.serverSnapshot,
  );
  const paused = JSON.parse(state).filter(
    row =>
      row.paused &&
      (row.websiteId === websiteId || (!!websiteHandle && row.websiteId === websiteHandle)),
  );
  if (!paused.length) return null;
  return (
    <div className={styles.notice} role="alert">
      {i18n.text('本轮处理超时，进度已保留，可以重试。')}
      {paused.map(({ id }) => (
        <button key={id} type="button" onClick={() => analysisPendingStore.resume(id)}>
          {i18n.text('重试')}
        </button>
      ))}
    </div>
  );
}
