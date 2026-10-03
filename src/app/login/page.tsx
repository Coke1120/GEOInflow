import type { Metadata } from 'next';
import { LoginPage } from './LoginPage';
import { FeatureAuthEntry } from '@/components/liekan/features/AuthEntry';

export const dynamic = 'force-dynamic';

export default async function ({ searchParams }: { searchParams: Promise<{ legacy?: string }> }) {
  if (process.env.DISABLE_LOGIN || process.env.CLOUD_MODE) {
    return null;
  }

  return (await searchParams).legacy === '1' ? <LoginPage /> : <FeatureAuthEntry page="login" />;
}

export const metadata: Metadata = {
  title: 'Login',
};
