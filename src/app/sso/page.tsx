import { Suspense } from 'react';
import { SSOPage } from './SSOPage';
import { FeatureAuthEntry } from '@/components/liekan/features/AuthEntry';

export default async function ({ searchParams }: { searchParams: Promise<{ legacy?: string }> }) {
  return (
    <Suspense>
      {(await searchParams).legacy === '1' ? <SSOPage /> : <FeatureAuthEntry page="sso" />}
    </Suspense>
  );
}
