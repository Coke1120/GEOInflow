'use client';
import { FeatureAuthPage } from './CorePages';
import '@/styles/liekan/Features.module.css';
import { LanguageSelector } from '../LanguageSelector';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';
import { useLiekanPageTitle } from '@/lib/liekan/i18n/client';
export function FeatureAuthEntry({ page }: { page: 'login' | 'login-2fa' | 'sso' }) {
  const { locale } = useLiekanI18n();
  useLiekanPageTitle({ login: '登录', 'login-2fa': '登录验证', sso: '单点登录' }[page]);
  return (
    <div data-liekan-features lang={locale}>
      <LanguageSelector compact />
      <FeatureAuthPage page={page} />
    </div>
  );
}
