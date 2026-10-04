'use client';
import { type CSSProperties, type ReactNode, useCallback, useMemo, useState } from 'react';
import type { FeatureRoute, FeatureUser } from '@/lib/liekan/contracts/features';
import { useNavigation } from '@/lib/liekan/upstream/client';
import { featureNavigationHref } from './features/routes';
import { NavigationView, useSidebarWidth } from './Navigation';
import {
  NavigationRegistrationContext,
  SidebarWidthContext,
  type NavigationProps,
} from './NavigationFrameContext';

// Only presentation survives route changes. Page providers and keys stay inside children.
export function NavigationFrame({
  user,
  route,
  children,
  enabled = true,
}: {
  user: FeatureUser;
  route: FeatureRoute;
  children: ReactNode;
  enabled?: boolean;
}) {
  const { pathname, query } = useNavigation();
  const [width, setWidth] = useSidebarWidth();
  const widthValue = useMemo(() => [width, setWidth] as const, [width, setWidth]);
  const [registered, setRegistered] = useState<{ path: string; props: NavigationProps }>(null);
  const register = useCallback((path: string, props: NavigationProps) => {
    const entry = { path, props };
    setRegistered(entry);
    return () => setRegistered(current => (current === entry ? null : current));
  }, []);
  const props =
    registered?.path === pathname
      ? registered.props
      : {
          user,
          route,
          href: (page: string, params: Record<string, any> = {}) =>
            featureNavigationHref(route, query, page, params),
        };
  return (
    <SidebarWidthContext.Provider value={widthValue}>
      <NavigationRegistrationContext.Provider value={enabled ? register : null}>
        {enabled && (
          <div
            data-liekan-features
            lang="zh-CN"
            style={{ '--lk-side-w': `${width}px`, '--side': `${width}px` } as CSSProperties}
          >
            <NavigationView {...props} width={width} onWidth={setWidth} />
          </div>
        )}
        {children}
      </NavigationRegistrationContext.Provider>
    </SidebarWidthContext.Provider>
  );
}
