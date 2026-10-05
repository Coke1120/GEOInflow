'use client';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FeatureEntity, FeatureRoute, FeatureUser } from '@/lib/liekan/contracts/features';
import {
  accountNavigation,
  geoPaths,
  activeNavigationPage,
  adminNavigation,
  globalNavigation,
  navigationFor,
  websiteNavigation,
  websiteNavigationIcons,
} from '@/lib/liekan/contracts/navigation';
import { featureDateRange } from '@/lib/liekan/contracts/analysis';
import type { ReportResource } from '@/lib/liekan/contracts/page-report';
import { pageReportQuery } from '@/lib/liekan/upstream/page-report-client';
import { useFeatureDateRange, useNavigation } from '@/lib/liekan/upstream/client';
import {
  clearFeatureLogin,
  featureApi,
  getAllFeatureRows,
  getFeatureSites,
  getFeaturePreferences,
} from '@/lib/liekan/upstream/features-client';
import styles from '@/styles/liekan/Navigation.module.css';
import '@/styles/liekan/Features.module.css';
import { featureHref, featureWebsiteSwitchHref, safeReturnHref } from './features/routes';
import { DialogActions, LiekanDialog, Icon, Notice, QueryState } from './features/ui';
import { defaultDateRange } from './viewState';
import { NavigationFeedback } from './NavigationFeedback';

export function useSidebarWidth() {
  const [width, setWidth] = useState(228);
  useEffect(() => {
    const saved = Number(localStorage.getItem('lk-side-w'));
    if (saved) setWidth(Math.max(180, Math.min(320, saved)));
  }, []);
  return [
    width,
    (next: number) => {
      const value = Math.max(180, Math.min(320, Math.round(next)));
      setWidth(value);
      localStorage.setItem('lk-side-w', String(value));
    },
  ] as const;
}

export function Navigation({
  user,
  route,
  site,
  width,
  onWidth,
  href = featureHref,
  websiteContextTarget,
}: {
  user: FeatureUser;
  route: FeatureRoute;
  site?: FeatureEntity;
  width: number;
  onWidth: (width: number) => void;
  href?: (page: string, params?: Record<string, any>) => string;
  websiteContextTarget?: HTMLElement;
}) {
  const nav = useNavigation();
  const client = useQueryClient();
  const meta = navigationFor(route);
  const website = meta.scope === 'website';
  const allGroups =
    meta.scope === 'admin' ? adminNavigation : website ? websiteNavigation : globalNavigation;
  const [mobile, setMobile] = useState(false);
  const [account, setAccount] = useState(meta.scope === 'account');
  const [switching, setSwitching] = useState(false);
  const [siteSearch, setSiteSearch] = useState('');
  const context = useRef<HTMLDivElement>(null);
  const siteButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const footer = useRef<HTMLElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const [leaving, setLeaving] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const logoutStarted = useRef(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const drag = useRef<number>(null);
  const sitesQuery = useQuery({
    queryKey: ['liekan-feature', user.id, 'sites', undefined, 'all', undefined],
    queryFn: ({ signal }) => getFeatureSites(signal),
    enabled: switching,
    retry: false,
    staleTime: 300000,
    gcTime: 600000,
  });
  const teamsQuery = useQuery({
    queryKey: ['liekan-feature', user.id, 'teams'],
    queryFn: ({ signal }) => getAllFeatureRows<FeatureEntity>('/me/teams', {}, signal),
    enabled: website,
    retry: false,
    staleTime: 300000,
    gcTime: 600000,
  });
  const displaySettings = useQuery<{ isDemo?: boolean; aiCrawlerEnabled?: boolean }>({
    queryKey: ['liekan-feature', user.id, 'website-display-settings', route.websiteId],
    queryFn: ({ signal }) =>
      featureApi.get(`/liekan/websites/${route.websiteId}/settings`, {}, signal),
    enabled: website && !!route.websiteId,
    retry: false,
    staleTime: 300000,
    gcTime: 600000,
  });
  const reportedDisplay = useQuery<boolean>({
    queryKey: ['liekan-feature', user.id, 'reported-crawler-display', route.websiteId],
    queryFn: skipToken,
    gcTime: 600000,
  });
  const crawlerEnabled = displaySettings.data?.aiCrawlerEnabled ?? reportedDisplay.data;
  const groups = allGroups.filter(
    group => !(website && group.id === 'ai' && crawlerEnabled === false),
  );
  useEffect(() => {
    setAccount(meta.scope === 'account');
    setMobile(false);
    setSwitching(false);
    setLeaving('');
  }, [nav.pathname, meta.section, meta.scope, route.websiteId, route.id]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const closeDesktopMenu = () => {
      if (!media.matches) setMobile(false);
    };
    media.addEventListener('change', closeDesktopMenu);
    return () => media.removeEventListener('change', closeDesktopMenu);
  }, []);
  useEffect(() => {
    if (!mobile) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebar.current?.querySelector<HTMLElement>('a,button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !sidebar.current?.querySelector('#account-navigation'))
        setMobile(false);
      if (event.key !== 'Tab') return;
      const nodes = Array.from(
        sidebar.current?.querySelectorAll<HTMLElement>(
          'a[href]:not([tabindex="-1"]),button:not(:disabled):not([tabindex="-1"])',
        ) || [],
      );
      if (!nodes.length) return;
      const current = nodes.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey
        ? current <= 0
          ? nodes.length - 1
          : current - 1
        : current < 0 || current === nodes.length - 1
          ? 0
          : current + 1;
      event.preventDefault();
      nodes[next].focus();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = before;
      document.removeEventListener('keydown', onKey);
      toggle.current?.focus();
    };
  }, [mobile]);
  useEffect(() => {
    if (!switching && !account) return;
    if (switching) searchInput.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!context.current?.contains(event.target as Node)) setSwitching(false);
      if (!footer.current?.contains(event.target as Node)) setAccount(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (switching) {
        setSwitching(false);
        siteButton.current?.focus();
      }
      if (account) {
        setAccount(false);
        accountButton.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [switching, account]);
  const timezone = getFeaturePreferences().timezone || 'Asia/Shanghai';
  const { dateRange } = useFeatureDateRange(timezone);
  const warmTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const warming = useRef(false);
  const cancelWarm = () => clearTimeout(warmTimer.current);
  useEffect(() => cancelWarm, []);
  const warm = (page: string) => {
    cancelWarm();
    if (
      !website ||
      !route.websiteId ||
      !(page in geoPaths) ||
      page === 'geo-logs' ||
      warming.current
    )
      return;
    warmTimer.current = setTimeout(() => {
      if (warming.current) return;
      warming.current = true;
      const path = geoPaths[page];
      const resource = (
        page === 'overview'
          ? 'overview'
          : page === 'geo-ai'
            ? 'ai/overview'
            : page === 'geo-human'
              ? 'human/overview'
              : path.slice(1)
      ) as ReportResource;
      const range = nav.query.date
        ? featureDateRange(dateRange, timezone)
        : defaultDateRange(Date.now(), timezone);
      const chartPeriod =
        ['overview', 'human/overview'].includes(resource) &&
        ['24h', '7d'].includes(nav.query.chartPeriod)
          ? nav.query.chartPeriod
          : '30d';
      void client
        .prefetchQuery(
          pageReportQuery(
            user.id,
            route.websiteId,
            { resource, startAt: range.startAt, endAt: range.endAt, timezone, chartPeriod },
            route.teamId,
          ),
        )
        .finally(() => {
          warming.current = false;
        });
    }, 150);
  };
  const currentSite = site?.id === route.websiteId ? site : undefined;
  const siteName = currentSite?.name || (route.websiteId ? '正在加载网站' : '选择网站');
  const demo = currentSite?.demo === true || displaySettings.data?.isDemo === true;
  const displayName = demo ? siteName.replace(/[（(]示例数据[）)]/, '').trim() : siteName;
  const teamName =
    teamsQuery.data?.find(team => team.id === currentSite?.teamId)?.name ||
    (currentSite?.teamId ? '团队空间' : '个人空间');
  const activePage = activeNavigationPage(route);
  const ownerParams = website
    ? { websiteId: route.websiteId }
    : route.teamId
      ? { teamId: route.teamId }
      : {};
  const safeHref = (page: string) => href(page, ownerParams);
  const changeSite = (id: string) => {
    const next = featureWebsiteSwitchHref(route, id, nav.query);
    if (document.querySelector('form[data-unsaved="true"]')) {
      setSwitching(false);
      setLeaving(next);
      return;
    }
    nav.router.push(next);
    setSwitching(false);
  };
  const websitesHref =
    safeReturnHref(nav.query.returnTo) || featureHref('websites', { teamId: currentSite?.teamId });
  const matchingSites = (sitesQuery.data || []).filter(item =>
    `${item.name} ${item.domain || ''}`
      .toLocaleLowerCase()
      .includes(siteSearch.trim().toLocaleLowerCase()),
  );
  const websiteContext = website && (
    <div ref={context} className={styles.headerContext}>
      <Link
        prefetch={false}
        className={styles.back}
        href={websitesHref}
        aria-label="返回网站列表"
        title="返回网站列表"
      >
        <Icon name="back" />
      </Link>
      <div className={styles.sitePicker}>
        <button
          ref={siteButton}
          type="button"
          className={`${styles.siteSwitch} site-switch`}
          onClick={() => {
            setMobile(false);
            setSiteSearch('');
            setSwitching(!switching);
          }}
          aria-label={`切换网站，当前${siteName}`}
          aria-expanded={switching}
          aria-busy={!currentSite && !!route.websiteId}
          aria-controls="website-picker"
          aria-haspopup="dialog"
          title={siteName}
        >
          <Icon name="globe" />
          <strong className={styles.siteName}>{displayName}</strong>
          {demo && <span className={styles.demoBadge}>示例</span>}
          <Icon name="down" />
        </button>
        {switching && (
          <div
            id="website-picker"
            role="dialog"
            aria-label="切换网站"
            className={styles.sitePopover}
            onBlur={event => {
              if (
                event.relatedTarget &&
                !event.currentTarget.contains(event.relatedTarget as Node) &&
                !siteButton.current?.contains(event.relatedTarget as Node)
              )
                setSwitching(false);
            }}
          >
            <div className={styles.siteCurrent}>
              <strong>{siteName}</strong>
              <span>{currentSite?.domain || '正在确认网站信息'}</span>
              {currentSite && <small>{teamName}</small>}
            </div>
            <label className={styles.siteSearch}>
              <Icon name="search" />
              <input
                ref={searchInput}
                value={siteSearch}
                aria-label="搜索网站"
                placeholder="搜索网站名称或域名"
                onChange={event => setSiteSearch(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    context.current
                      ?.querySelector<HTMLButtonElement>('[data-site-option]')
                      ?.focus();
                  }
                }}
              />
            </label>
            <div data-liekan-features className={styles.pickerState}>
              <QueryState query={sitesQuery}>
                <div className={styles.siteOptions}>
                  {matchingSites.map(item => (
                    <button
                      type="button"
                      key={item.id}
                      data-site-option
                      className={`${styles.siteOption} ${item.id === route.websiteId ? styles.selected : ''}`}
                      aria-label={`选择网站 ${item.name}`}
                      aria-current={item.id === route.websiteId ? 'true' : undefined}
                      onClick={() => {
                        if (item.id === route.websiteId) {
                          setSwitching(false);
                          siteButton.current?.focus();
                        } else changeSite(item.id);
                      }}
                      onKeyDown={event => {
                        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                        event.preventDefault();
                        const buttons = [
                          ...context.current.querySelectorAll<HTMLButtonElement>(
                            '[data-site-option]',
                          ),
                        ];
                        const index = buttons.indexOf(event.currentTarget);
                        const next =
                          event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? buttons.length - 1
                              : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                                buttons.length;
                        buttons[next]?.focus();
                      }}
                    >
                      <span>
                        <strong>{item.name}</strong>
                        <small>{item.domain}</small>
                      </span>
                      {item.id === route.websiteId && <Icon name="check" />}
                    </button>
                  ))}
                  {!matchingSites.length && (
                    <p className={styles.pickerEmpty}>
                      {sitesQuery.data?.length ? '没有匹配的网站' : '当前没有可访问的网站'}
                    </p>
                  )}
                </div>
              </QueryState>
            </div>
            <Link prefetch={false} href={websitesHref} className={styles.siteManage}>
              <Icon name="grid" />
              全部网站
              <Icon name="chevron" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
  return (
    <>
      {websiteContextTarget ? createPortal(websiteContext, websiteContextTarget) : websiteContext}
      <button
        ref={toggle}
        type="button"
        className={styles.mobileToggle}
        aria-expanded={mobile}
        aria-controls="liekan-navigation"
        onClick={() => setMobile(!mobile)}
      >
        <Icon name="menu" />
        <span className={styles.srOnly}>页面导航</span>
      </button>
      {mobile && (
        <button
          type="button"
          className={styles.backdrop}
          aria-label="关闭导航"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        ref={sidebar}
        className={`${styles.sidebar} ${mobile ? styles.open : ''} ${styles.preview}`}
        id="liekan-navigation"
        aria-label={website ? '网站导航' : meta.scope === 'admin' ? '系统管理导航' : '全局导航'}
      >
        <Link
          prefetch={false}
          className={styles.brand}
          href={website ? safeHref('overview') : featureHref('dashboard')}
        >
          <img src={`${process.env.basePath || ''}/liekan/features/logo.svg`} alt="" />
          <span>
            猎看统计<small>LIEKAN GEO STATS</small>
          </span>
        </Link>
        <nav className={styles.nav} aria-label="业务导航" data-navigation-primary>
          {meta.scope === 'admin' && <div className={styles.caption}>系统管理</div>}
          {groups.map(group => (
            <div key={group.id} data-navigation-group={group.id}>
              {group.sectionLabel && (
                <div className={styles.sectionLabel}>{group.sectionLabel}</div>
              )}
              {group.children && <div className={styles.sectionLabel}>{group.label}</div>}
              <div className={styles.expandedItems}>
                {(group.children || [group]).map(item => (
                  <Link
                    prefetch={false}
                    key={item.page}
                    className={`${styles.item} ${activePage === item.page ? styles.selected : ''}`}
                    aria-current={activePage === item.page ? 'page' : undefined}
                    href={safeHref(item.page)}
                    onMouseEnter={() => warm(item.page)}
                    onFocus={() => warm(item.page)}
                    onMouseLeave={cancelWarm}
                    onBlur={cancelWarm}
                  >
                    <Icon
                      name={
                        website
                          ? websiteNavigationIcons[item.page] || group.icon
                          : item.icon || group.icon
                      }
                    />
                    <span>{item.label}</span>
                    <NavigationFeedback />
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <footer ref={footer} className={styles.footer}>
          <div className={styles.footerRow}>
            <button
              ref={accountButton}
              type="button"
              className={styles.accountToggle}
              aria-label="个人账户"
              aria-expanded={account}
              aria-controls="account-navigation"
              onClick={event => {
                event.currentTarget.focus();
                setAccount(!account);
              }}
            >
              <span className={styles.avatar}>{user.username?.slice(0, 1) || 'L'}</span>
              <span className={styles.siteText}>
                <strong title={user.username}>{user.username}</strong>
              </span>
            </button>
            <Link
              prefetch={false}
              className={styles.footerIcon}
              href={featureHref('websites', {
                teamId: website ? currentSite?.teamId : route.teamId,
              })}
              aria-label="网站列表"
              title="网站列表"
            >
              <Icon name="grid" />
            </Link>
            {website ? (
              <Link
                prefetch={false}
                className={`${styles.footerIcon} ${meta.section === 'website-settings' ? styles.selected : ''}`}
                aria-current={meta.section === 'website-settings' ? 'page' : undefined}
                href={safeHref('website-settings')}
                aria-label="网站设置"
                title="网站设置"
              >
                <Icon name="settings" />
              </Link>
            ) : user.isAdmin ? (
              <Link
                prefetch={false}
                className={styles.footerIcon}
                href={featureHref('admin-users')}
                aria-label="系统管理"
                title="系统管理"
              >
                <Icon name="shield" />
              </Link>
            ) : (
              <Link
                prefetch={false}
                className={styles.footerIcon}
                href={featureHref('preferences')}
                aria-label="偏好设置"
                title="偏好设置"
              >
                <Icon name="settings" />
              </Link>
            )}
          </div>
          {account && (
            <nav className={styles.accountMenu} id="account-navigation" aria-label="个人账户">
              {accountNavigation.map(item => (
                <Link
                  prefetch={false}
                  className={`${styles.item} ${route.page === item.page ? styles.selected : ''}`}
                  aria-current={route.page === item.page ? 'page' : undefined}
                  key={item.page}
                  href={featureHref(item.page)}
                >
                  {item.label}
                </Link>
              ))}
              <button
                type="button"
                className={styles.item}
                disabled={loggingOut}
                onClick={async () => {
                  if (logoutStarted.current) return;
                  logoutStarted.current = true;
                  setLoggingOut(true);
                  await featureApi.post('/auth/logout').catch(() => {});
                  clearFeatureLogin();
                  client.clear();
                  nav.router.replace('/login');
                }}
              >
                {loggingOut ? '正在退出' : '退出登录'}
              </button>
            </nav>
          )}
        </footer>
        <div
          className={styles.resizer}
          role="separator"
          tabIndex={0}
          aria-label="调整侧栏宽度"
          aria-orientation="vertical"
          aria-valuemin={180}
          aria-valuemax={320}
          aria-valuenow={width}
          onKeyDown={event => {
            if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
              event.preventDefault();
              onWidth(width + (event.key === 'ArrowRight' ? 8 : -8));
            }
          }}
          onPointerDown={event => {
            drag.current = event.clientX;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            if (drag.current != null) {
              onWidth(width + event.clientX - drag.current);
              drag.current = event.clientX;
            }
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        />
      </aside>
      {leaving && (
        <LiekanDialog
          protectUnsaved={false}
          title="放弃未保存的修改？"
          onClose={() => setLeaving('')}
        >
          <Notice>切换网站会放弃当前表单中的修改。</Notice>
          <DialogActions>
            <button type="button" className="btn" onClick={() => setLeaving('')}>
              继续编辑
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                nav.router.push(leaving);
                setLeaving('');
                setSwitching(false);
              }}
            >
              放弃修改并切换
            </button>
          </DialogActions>
        </LiekanDialog>
      )}
    </>
  );
}
