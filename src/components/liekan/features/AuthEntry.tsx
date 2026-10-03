'use client';
import { FeatureAuthPage } from './CorePages';
import '@/styles/liekan/Features.module.css';
export function FeatureAuthEntry({ page }: { page: 'login' | 'login-2fa' | 'sso' }) {
  return (
    <div data-liekan-features lang="zh-CN">
      <FeatureAuthPage page={page} />
    </div>
  );
}
