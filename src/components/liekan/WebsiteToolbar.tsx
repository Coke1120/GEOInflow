'use client';
import type { ReactNode, Ref } from 'react';
import { LanguageSelector } from './LanguageSelector';
import styles from '@/styles/liekan/WebsiteToolbar.module.css';

export function WebsiteToolbar({
  contextRef,
  actionsRef,
  actions,
}: {
  contextRef: Ref<HTMLDivElement>;
  actionsRef?: Ref<HTMLDivElement>;
  actions?: ReactNode;
}) {
  return (
    <div className={styles.toolbar} data-website-toolbar data-website-context-frame>
      <div className={styles.context} ref={contextRef} data-website-toolbar-context />
      <div className={styles.actions} ref={actionsRef} data-website-toolbar-actions>
        {actions}
      </div>
      <LanguageSelector toolbar />
    </div>
  );
}
