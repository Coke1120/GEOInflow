'use client';
import { type CSSProperties, createContext, type ReactNode, useContext, useState } from 'react';
import type { FeatureUser } from '@/lib/liekan/contracts/features';
import { geoPageFromPath } from '@/lib/liekan/contracts/navigation';
import { useNavigation } from '@/lib/liekan/upstream/client';
import reference from '@/styles/liekan/Reference.module.css';
import styles from '@/styles/liekan/Shell.module.css';
import { featureNavigationHref, matchFeatureRoute } from './features/routes';
import { Navigation, useSidebarWidth } from './Navigation';
import type { LiekanReport } from './types';

const ShellContext = createContext<{
  setWebsite: (website: LiekanReport['website']) => void;
  setBotCount: (count: number) => void;
}>(null);
export const useLiekanShell = () => useContext(ShellContext);
export function LiekanShell({ children, user }: { children: ReactNode; user: FeatureUser }) {
  const { pathname, websiteId, query } = useNavigation();
  const [width, setWidth] = useSidebarWidth();
  const [website, setWebsite] = useState<LiekanReport['website']>(null);
  const [, setBotCount] = useState<number>(null);
  const isGeo = pathname.includes('/geo');
  const route = pathname.includes('/geo')
    ? { page: geoPageFromPath(pathname), websiteId }
    : matchFeatureRoute(pathname, query) || { page: 'dashboard' };
  const href = (page: string, params: Record<string, any> = {}) =>
    featureNavigationHref(route, query, page, params);
  return (
    <ShellContext.Provider value={{ setWebsite, setBotCount }}>
      <div
        className={styles.shell}
        style={{ '--lk-side-w': `${width}px` } as CSSProperties}
        data-liekan-ui
        lang="zh-CN"
      >
        <Navigation
          user={user}
          route={route}
          site={website && { ...website, teamId: (website as any).teamId }}
          width={width}
          onWidth={setWidth}
          href={href}
        />
        <div className={styles.content} id="main-content">
          <div className={isGeo ? reference.root : styles.coreFrame}>{children}</div>
        </div>
      </div>
    </ShellContext.Provider>
  );
}
