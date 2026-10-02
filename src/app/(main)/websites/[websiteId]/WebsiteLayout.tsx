'use client';
import { Column } from '@umami/react-zen';
import type { ReactNode } from 'react';
import { WebsiteProvider } from '@/app/(main)/websites/WebsiteProvider';
import { PageBody } from '@/components/common/PageBody';
import { isLiekanRoute } from '@/components/liekan/data';
import { useNavigation } from '@/lib/liekan/upstream/client';
import { WebsiteHeader } from './WebsiteHeader';

export function WebsiteLayout({ websiteId, children }: { websiteId: string; children: ReactNode }) {
  const { pathname, query } = useNavigation();
  const showLiekan = isLiekanRoute(pathname) || query.liekanShell === '1';
  return (
    <WebsiteProvider websiteId={websiteId}>
      {showLiekan ? (
        children
      ) : (
        <PageBody gap>
          <WebsiteHeader showActions />
          <Column>{children}</Column>
        </PageBody>
      )}
    </WebsiteProvider>
  );
}
