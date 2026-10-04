'use client';
import {
  type CSSProperties,
  createContext,
  type ReactNode,
  useContext,
  useState,
  useEffect,
} from 'react';
import type { FeatureUser } from '@/lib/liekan/contracts/features';
import {
  geoPageFromPath,
  navigationFor,
  pageNavigation,
  websiteAnalysisFamily,
} from '@/lib/liekan/contracts/navigation';
import { useNavigation, useWebsiteQuery } from '@/lib/liekan/upstream/client';
import reference from '@/styles/liekan/Reference.module.css';
import styles from '@/styles/liekan/Shell.module.css';
import { GeoLoading } from './GeoLoading';
import { hidesPreviousData } from './LoadingState';
import { loadEcharts } from './chartRuntime';
import { AnalysisTabs } from './AnalysisTabs';
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
  useEffect(() => {
    if (isGeo) void loadEcharts().catch(() => {});
  }, [isGeo]);
  const route = pathname.includes('/geo')
    ? { page: geoPageFromPath(pathname), websiteId }
    : matchFeatureRoute(pathname, query) || { page: 'dashboard' };
  const metadata = useWebsiteQuery(isGeo ? websiteId : undefined);
  const currentMetadata =
    metadata.data?.id === websiteId && !hidesPreviousData(metadata.error)
      ? metadata.data
      : undefined;
  const currentWebsite =
    website?.id === websiteId && !hidesPreviousData(metadata.error) ? website : undefined;
  const site = currentMetadata ? { ...currentWebsite, ...currentMetadata } : currentWebsite;
  const [websiteContextTarget, setWebsiteContextTarget] = useState<HTMLDivElement>(null);
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
          site={site}
          width={width}
          onWidth={setWidth}
          href={href}
          websiteContextTarget={websiteContextTarget}
        />
        <div className={styles.content} id="main-content">
          {navigationFor(route).scope === 'website' && (
            <div className={styles.websiteContextBar} ref={setWebsiteContextTarget} />
          )}
          <div className={isGeo ? reference.root : styles.coreFrame}>
            {isGeo && !currentMetadata ? (
              <>
                <div className={styles.header}>
                  <div className={styles.headerInner}>
                    <h1 className="text-[16px] font-bold tracking-tight">
                      {websiteAnalysisFamily(route)?.label || pageNavigation[route.page]?.title}
                    </h1>
                  </div>
                </div>
                <div className={styles.tabsFrame}>
                  <AnalysisTabs route={route} href={href} />
                </div>
                {metadata.isError ? (
                  <div className={styles.notice} role="status">
                    无法读取网站信息
                    <button type="button" onClick={() => metadata.refetch()}>
                      重试
                    </button>
                  </div>
                ) : (
                  <GeoLoading
                    resource={
                      route.page === 'geo-overview'
                        ? 'overview'
                        : { ai: 'ai/overview', human: 'human/overview' }[
                            pathname.split('/geo/')[1]
                          ] ||
                          pathname.split('/geo/')[1] ||
                          'overview'
                    }
                  />
                )}
              </>
            ) : (
              children
            )}
          </div>
        </div>
      </div>
    </ShellContext.Provider>
  );
}
