'use client';
import { useState } from 'react';
import { useFeatureLocale } from '@/lib/liekan/upstream/locale-client';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';
import styles from '@/styles/liekan/LanguageSelector.module.css';

export function LanguageSelector({
  compact = false,
  field = false,
}: {
  compact?: boolean;
  field?: boolean;
}) {
  const { saveLocale } = useFeatureLocale();
  const { locale } = useLiekanI18n();
  const [persistenceError, setPersistenceError] = useState(false);
  return (
    <div
      data-language-selector
      className={`${styles.root} ${compact ? styles.compact : ''} ${field ? styles.field : ''}`}
    >
      <label>
        <span>Language / 语言</span>
        <select
          aria-label="Language / 语言"
          value={locale}
          onChange={async event => {
            event.stopPropagation();
            const { persisted } = await saveLocale(event.currentTarget.value);
            setPersistenceError(!persisted);
          }}
        >
          <option value="zh-CN">简体中文</option>
          <option value="en-US">English</option>
        </select>
      </label>
      {persistenceError && (
        <small role="status">
          {locale === 'en-US'
            ? 'Language changed for this page. Browser settings prevented saving your preference.'
            : '本页语言已切换，浏览器设置阻止了偏好保存。'}
        </small>
      )}
    </div>
  );
}
