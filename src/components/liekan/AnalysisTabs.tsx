'use client';
import Link from 'next/link';
import { useRef } from 'react';
import type { FeatureRoute } from '@/lib/liekan/contracts/features';
import {
  analysisSourcePage,
  globalNavigation,
  trackingNavigationTabs,
  trackingSourcePage,
  websiteAnalysisFamily,
  websiteAnalysisTabs,
} from '@/lib/liekan/contracts/navigation';
import styles from '@/styles/liekan/Navigation.module.css';
import { NavigationFeedback } from './NavigationFeedback';

export function AnalysisTabs({
  route,
  href,
  onSegments,
}: {
  route: FeatureRoute;
  href: (page: string) => string;
  onSegments?: () => void;
}) {
  const trackingPage = trackingSourcePage(route);
  const family = trackingPage
    ? globalNavigation.find(group => group.id === 'tracking')
    : websiteAnalysisFamily(route);
  const tabs = trackingPage ? trackingNavigationTabs : websiteAnalysisTabs[family?.page];
  const links = useRef<HTMLDivElement>(null);
  if (!tabs) return null;
  const source =
    trackingPage ||
    analysisSourcePage(
      ['filters', 'annotations', 'exports'].includes(route.page)
        ? route.from || 'overview'
        : route.page,
    );
  const active = source === 'segments' ? 'cohorts' : source;
  return (
    <div className={styles.tabsToolbar} data-analysis-family={family.page}>
      <div
        className={styles.pageTabs}
        ref={links}
        role="tablist"
        aria-label={`${family.label}视图`}
      >
        {tabs.map(tab => (
          <Link
            key={tab.page}
            prefetch={false}
            role="tab"
            href={href(tab.page)}
            aria-selected={active === tab.page}
            tabIndex={active === tab.page ? 0 : -1}
            className={`${styles.pageTab} ${active === tab.page ? styles.activeTab : ''}`}
            onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const nodes = [...links.current.querySelectorAll<HTMLAnchorElement>('a')];
              const index = nodes.indexOf(event.currentTarget);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? nodes.length - 1
                    : (index + (event.key === 'ArrowRight' ? 1 : -1) + nodes.length) % nodes.length;
              nodes[next]?.focus();
            }}
          >
            {tab.label}
            <NavigationFeedback />
          </Link>
        ))}
      </div>
      {family.page === 'cohorts' && onSegments && (
        <button type="button" className={styles.segmentsButton} onClick={onSegments}>
          已保存分群
        </button>
      )}
    </div>
  );
}
