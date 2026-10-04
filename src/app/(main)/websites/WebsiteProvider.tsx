'use client';
import { Loading } from '@umami/react-zen';
import { useApp } from '@/store/app';
import { featureSiteQuery } from '@/lib/liekan/upstream/features-client';
import { createContext, type ReactNode } from 'react';
import { useWebsiteQuery } from '@/components/hooks/queries/useWebsiteQuery';
import type { Website } from '@/generated/prisma/client';

export const WebsiteContext = createContext<Website>(null);

export function WebsiteProvider({
  websiteId,
  children,
  renderWhileLoading = false,
}: {
  websiteId: string;
  children: ReactNode;
  renderWhileLoading?: boolean;
}) {
  const userId = useApp(state => state.user?.id);
  const shareId = useApp(state => state.share?.shareId);
  const {
    data: website,
    isFetching,
    isLoading,
  } = useWebsiteQuery(
    websiteId,
    userId && !shareId
      ? { ...featureSiteQuery(userId, websiteId), placeholderData: undefined }
      : undefined,
  );

  if (!renderWhileLoading && isFetching && isLoading) {
    return <Loading placement="absolute" />;
  }

  if (!renderWhileLoading && !website) {
    return null;
  }

  return (
    <WebsiteContext.Provider value={website?.id === websiteId ? website : null}>
      {children}
    </WebsiteContext.Provider>
  );
}
