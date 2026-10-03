'use client';
import { usePathname, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ShareProvider } from '@/lib/liekan/upstream/share-client';
import { featureRequest } from '@/lib/liekan/upstream/features-client';
import { ShareFeatureView } from './WorkspacePages';
import { QueryState } from './ui';
import '@/styles/liekan/Features.module.css';
function LegacyGate({
  slug,
  page,
  children,
}: {
  slug: string;
  page: string;
  children: React.ReactNode;
}) {
  const query = useQuery({
    queryKey: ['liekan-legacy-share-gate', slug],
    queryFn: ({ signal }) =>
      featureRequest('GET', `/share/${encodeURIComponent(slug)}`, undefined, signal, undefined, ''),
    retry: false,
  });
  if (query.isPending) return <QueryState query={query}>{null}</QueryState>;
  if (query.error || query.data?.requiresPassword)
    return (
      <div data-liekan-features lang="zh-CN">
        <ShareFeatureView slug={slug} initialPage={page} />
      </div>
    );
  return <ShareProvider slug={slug}>{children}</ShareProvider>;
}
export function PublicShareEntry({ slug, children }: { slug: string; children: React.ReactNode }) {
  const search = useSearchParams(),
    path = usePathname();
  const segments = path.split(`/share/${slug}/`)[1]?.split('/') || [],
    page = (segments[0]?.includes('.') ? segments[1] : segments[0]) || 'overview';
  if (search.get('legacy') === '1')
    return (
      <LegacyGate slug={slug} page={page}>
        {children}
      </LegacyGate>
    );
  return (
    <div data-liekan-features lang="zh-CN" style={{ minHeight: '100dvh' }}>
      <ShareFeatureView slug={slug} initialPage={page} />
    </div>
  );
}
