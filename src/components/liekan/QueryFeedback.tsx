'use client';
import { useEffect, useState } from 'react';
import styles from '@/styles/liekan/Shell.module.css';

export function QueryFeedback({ query }: { query: any }) {
  const [visible, setVisible] = useState(false);
  const fetching = !!query.isFetching;
  useEffect(() => {
    setVisible(false);
    if (!fetching) return;
    const timer = setTimeout(() => setVisible(true), 200);
    return () => clearTimeout(timer);
  }, [fetching]);
  const stale = !!query.error && query.data !== undefined;
  if (!stale && !(visible && fetching)) return null;
  return (
    <div className={styles.queryFeedback} role={stale ? 'alert' : 'status'}>
      {stale ? (
        <>
          更新失败，显示上次结果
          {query.dataUpdatedAt
            ? `（${new Date(query.dataUpdatedAt).toLocaleTimeString('zh-CN')}）`
            : ''}
          <button type="button" onClick={() => query.refetch?.({ cancelRefetch: false })}>
            重试读取
          </button>
        </>
      ) : (
        '正在更新统计数据'
      )}
    </div>
  );
}
