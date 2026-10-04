'use client';
import { useEffect, useState } from 'react';
import { useLinkStatus } from 'next/link';
import styles from '@/styles/liekan/Navigation.module.css';

export function NavigationFeedback() {
  const { pending } = useLinkStatus();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(false);
    if (!pending) return;
    const timer = setTimeout(() => setVisible(true), 200);
    return () => clearTimeout(timer);
  }, [pending]);
  return pending && visible ? (
    <span className={styles.linkPending} role="status" data-navigation-pending>
      <span className={styles.srOnly}>正在打开页面</span>
    </span>
  ) : null;
}
