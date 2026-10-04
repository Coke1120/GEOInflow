'use client';
import styles from '@/styles/liekan/Shell.module.css';

export function AnalysisLoading() {
  return (
    <div className={styles.analysisLoading} role="status" aria-busy="true">
      <span>正在读取统计数据</span>
      <div className={styles.loadingLines} aria-hidden="true">
        <span />
        <span />
      </div>
    </div>
  );
}
