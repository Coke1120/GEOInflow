'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { FeatureEntity, FeatureRoute, FeatureUser } from '@/lib/liekan/contracts/features';
import {
  accountNavigation,
  activeNavigationPage,
  adminNavigation,
  globalNavigation,
  navigationFor,
  websiteNavigation,
} from '@/lib/liekan/contracts/navigation';
import { useNavigation } from '@/lib/liekan/upstream/client';
import {
  clearFeatureLogin,
  featureApi,
  getAllFeatureRows,
  getFeatureSites,
} from '@/lib/liekan/upstream/features-client';
import styles from '@/styles/liekan/Navigation.module.css';
import '@/styles/liekan/Features.module.css';
import { featureHref, featureWebsiteSwitchHref, safeReturnHref } from './features/routes';
import { Drawer, Form, Icon, Notice, QueryState, Select } from './features/ui';

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
}: {
  user: FeatureUser;
  route: FeatureRoute;
  site?: FeatureEntity;
  width: number;
  onWidth: (width: number) => void;
  href?: (page: string, params?: Record<string, any>) => string;
}) {
  const nav = useNavigation();
  const client = useQueryClient();
  const meta = navigationFor(route);
  const website = meta.scope === 'website';
  const groups =
    meta.scope === 'admin' ? adminNavigation : website ? websiteNavigation : globalNavigation;
  const [expanded, setExpanded] = useState(meta.section);
  const [mobile, setMobile] = useState(false);
  const [account, setAccount] = useState(meta.scope === 'account');
  const [switching, setSwitching] = useState(false);
  const [leaving, setLeaving] = useState('');
  const toggle = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const drag = useRef<number>(null);
  const sitesQuery = useQuery({
    queryKey: ['liekan-feature', user.id, 'navigation-sites'],
    queryFn: ({ signal }) => getFeatureSites(signal),
    enabled: switching,
    retry: false,
  });
  const teamsQuery = useQuery({
    queryKey: ['liekan-feature', user.id, 'teams'],
    queryFn: ({ signal }) => getAllFeatureRows<FeatureEntity>('/me/teams', {}, signal),
    enabled: website,
    retry: false,
  });
  useEffect(() => {
    setExpanded(meta.section);
    setAccount(meta.scope === 'account');
    setMobile(false);
    setSwitching(false);
  }, [nav.pathname, meta.section, meta.scope, route.websiteId, route.id]);
  useEffect(() => {
    if (!mobile) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebar.current?.querySelector<HTMLElement>('a,button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobile(false);
      if (event.key !== 'Tab') return;
      const nodes = sidebar.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)');
      const first = nodes?.[0],
        last = nodes?.[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = before;
      document.removeEventListener('keydown', onKey);
      toggle.current?.focus();
    };
  }, [mobile]);
  const currentSite = site?.id === route.websiteId ? site : undefined;
  const siteName = currentSite?.name || '选择网站';
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
  return (
    <>
      <button
        ref={toggle}
        type="button"
        className={styles.mobileToggle}
        aria-expanded={mobile}
        aria-controls="liekan-navigation"
        onClick={() => setMobile(!mobile)}
      >
        <Icon name="menu" />
        页面导航
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
        className={`${styles.sidebar} ${mobile ? styles.open : ''}`}
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
        {website && (
          <div className={styles.websiteContext}>
            <Link
              prefetch={false}
              className={styles.back}
              href={
                safeReturnHref(nav.query.returnTo) ||
                featureHref('websites', { teamId: currentSite?.teamId })
              }
            >
              <Icon name="back" />
              返回网站列表
            </Link>
            <button
              type="button"
              className={`${styles.siteSwitch} site-switch`}
              onClick={() => {
                setMobile(false);
                setSwitching(true);
              }}
              aria-label={`切换网站，当前${siteName}`}
            >
              <span className={styles.avatar}>{siteName.slice(0, 1)}</span>
              <span className={styles.siteText}>
                <strong title={siteName}>{siteName}</strong>
                <small title={currentSite?.domain}>{currentSite?.domain || '请明确选择网站'}</small>
                <small>{currentSite ? teamName : ''}</small>
              </span>
              <Icon name="down" />
            </button>
          </div>
        )}
        <nav className={styles.nav} aria-label="业务导航" data-navigation-primary>
          {meta.scope === 'admin' && <div className={styles.caption}>系统管理</div>}
          {groups.map(group => (
            <div key={group.id} data-navigation-group={group.id}>
              <div
                className={`${styles.group} ${meta.section === group.id ? styles.currentGroup : ''}`}
              >
                <Link
                  prefetch={false}
                  className={`${styles.item} ${!group.children && activePage === group.page ? styles.selected : ''}`}
                  aria-current={!group.children && activePage === group.page ? 'page' : undefined}
                  href={safeHref(group.page)}
                  onClick={() => group.children && setExpanded(group.id)}
                >
                  <Icon name={group.icon} />
                  <span>{group.label}</span>
                </Link>
                {group.children && (
                  <button
                    type="button"
                    className={styles.expand}
                    aria-label={`${expanded === group.id ? '收起' : '展开'}${group.label}`}
                    aria-expanded={expanded === group.id}
                    aria-controls={`nav-${group.id}`}
                    onClick={() => setExpanded(expanded === group.id ? '' : group.id)}
                  >
                    <Icon name={expanded === group.id ? 'up' : 'down'} />
                  </button>
                )}
              </div>
              {group.children && expanded === group.id && (
                <div className={styles.children} id={`nav-${group.id}`}>
                  {group.children.map(item => (
                    <Link
                      prefetch={false}
                      className={`${styles.item} ${activePage === item.page ? styles.selected : ''}`}
                      aria-current={activePage === item.page ? 'page' : undefined}
                      key={item.page}
                      href={safeHref(item.page)}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
        <footer className={styles.footer}>
          {website && (
            <Link
              prefetch={false}
              className={`${styles.item} ${meta.section === 'website-settings' ? styles.selected : ''}`}
              aria-current={meta.section === 'website-settings' ? 'page' : undefined}
              href={safeHref('website-settings')}
            >
              <Icon name="shield" />
              网站设置
            </Link>
          )}
          {!website && user.isAdmin && (
            <Link prefetch={false} className={styles.item} href={featureHref('admin-users')}>
              <Icon name="shield" />
              系统管理
            </Link>
          )}
          <button
            type="button"
            className={styles.accountToggle}
            aria-expanded={account}
            aria-controls="account-navigation"
            onClick={() => setAccount(!account)}
          >
            <span className={styles.avatar}>{user.username?.slice(0, 1) || 'L'}</span>
            <span className={styles.siteText}>
              <strong>个人账户</strong>
              <small title={user.username}>{user.username}</small>
            </span>
            <Icon name={account ? 'up' : 'down'} />
          </button>
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
                onClick={async () => {
                  await featureApi.post('/auth/logout').catch(() => {});
                  clearFeatureLogin();
                  client.clear();
                  nav.router.replace('/login');
                }}
              >
                退出登录
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
      {switching && (
        <Drawer title="切换网站" onClose={() => setSwitching(false)}>
          <QueryState query={sitesQuery}>
            {sitesQuery.data?.length ? (
              <Form
                trackUnsaved={false}
                submitLabel="切换网站"
                onSubmit={async values => {
                  if (!sitesQuery.data.some(site => site.id === values.site))
                    throw new Error('请选择可访问的网站');
                  changeSite(values.site);
                }}
              >
                <Select
                  label="网站"
                  name="site"
                  defaultValue={route.websiteId}
                  options={sitesQuery.data.map(site => [
                    site.id,
                    `${site.name} · ${site.domain || ''}`,
                  ])}
                />
              </Form>
            ) : (
              <Notice>
                当前账户暂无可访问网站。<Link href={featureHref('websites')}>返回网站列表</Link>
              </Notice>
            )}
          </QueryState>
        </Drawer>
      )}
      {leaving && (
        <Drawer title="当前修改尚未保存" onClose={() => setLeaving('')}>
          <Notice>切换网站会放弃当前表单中的修改。</Notice>
          <div data-liekan-features className="form-actions">
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
          </div>
        </Drawer>
      )}
    </>
  );
}
