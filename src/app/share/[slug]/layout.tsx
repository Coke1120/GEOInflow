import { PublicShareEntry } from '@/components/liekan/features/PublicShareEntry';
import { Suspense } from 'react';

export default async function ({
  params,
  children,
}: {
  params: Promise<{ slug: string }>;
  children: React.ReactNode;
}) {
  const { slug } = await params;

  return (
    <Suspense>
      <PublicShareEntry slug={slug}>{children}</PublicShareEntry>
    </Suspense>
  );
}
