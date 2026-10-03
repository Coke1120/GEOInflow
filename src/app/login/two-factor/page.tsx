import type { Metadata } from 'next';
import { LoginTwoFactorPage } from './LoginTwoFactorPage';
import { LoginPageWrapper } from '@/app/login/LoginPage';
import { FeatureAuthEntry } from '@/components/liekan/features/AuthEntry';

export default async function ({ searchParams }: { searchParams: Promise<{ legacy?: string }> }) {
  if (process.env.DISABLE_LOGIN || process.env.CLOUD_MODE) {
    return null;
  }

  if ((await searchParams).legacy !== '1') return <FeatureAuthEntry page="login-2fa" />;
  return (
    <LoginPageWrapper>
      <LoginTwoFactorPage />
    </LoginPageWrapper>
  );
}

export const metadata: Metadata = {
  title: 'Two-factor authentication',
};
