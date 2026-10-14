'use client';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';

import { useLinkStatus } from 'next/link';
import styles from '@/styles/liekan/Navigation.module.css';

export function NavigationFeedback() {
  const i18n = useLiekanI18n();
  const { pending } = useLinkStatus();
  return pending ? (
    <span className={styles.srOnly} role="status" data-navigation-pending>
      {i18n.text('正在打开页面')}
    </span>
  ) : null;
}
