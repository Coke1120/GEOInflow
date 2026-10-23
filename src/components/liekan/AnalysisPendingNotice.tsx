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
  const jobs = JSON.parse(state).filter(
    row => row.websiteId === websiteId || (!!websiteHandle && row.websiteId === websiteHandle),
  );
  if (!jobs.length) return null;
  return (
    <div className={styles.notice} role="status" aria-live="polite">
      {i18n.text(
        jobs.some(({ job }) => job?.status === 'running')
          ? '后台正在计算统计数据，可关闭页面稍后查看。'
          : jobs.some(row => !row.job)
            ? '正在等待后台计算名额，可关闭页面稍后查看。'
            : '统计任务已排队，可关闭页面稍后查看。',
      )}
      {jobs
        .filter(row => row.paused)
        .map(({ id }) => (
          <button key={id} type="button" onClick={() => analysisPendingStore.resume(id)}>
            {i18n.text('继续查看计算状态')}
          </button>
        ))}
    </div>
  );
}
