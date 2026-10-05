'use client';
import { useLinkStatus } from 'next/link';
import styles from '@/styles/liekan/Navigation.module.css';

export function NavigationFeedback() {
  const { pending } = useLinkStatus();
  return pending ? (
    <span className={styles.srOnly} role="status" data-navigation-pending>
      正在打开页面
    </span>
  ) : null;
}
