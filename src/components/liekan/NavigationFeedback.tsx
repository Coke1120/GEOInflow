'use client';
import { useLinkStatus } from 'next/link';
import styles from '@/styles/liekan/Navigation.module.css';

export function NavigationFeedback() {
  const { pending } = useLinkStatus();
  return pending ? (
    <span className={styles.linkPending} role="status" data-navigation-pending>
      <span className={styles.srOnly}>正在打开页面</span>
    </span>
  ) : null;
}
