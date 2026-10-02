'use client';
import Link from 'next/link';
import {
  type CSSProperties,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  AdminNav,
  SettingsNav,
  UserButton,
  useNavigation,
  WebsiteNav,
} from '@/lib/liekan/upstream/client';
import reference from '@/styles/liekan/Reference.module.css';
import styles from '@/styles/liekan/Shell.module.css';
import { isLiekanRoute, pages } from './data';
import { BrandIcon, NavIcon } from './Icons';
import type { LiekanReport } from './types';
import { resetViewParams } from './viewState';

const ShellContext = createContext<{
  setWebsite: (website: LiekanReport['website']) => void;
  setBotCount: (count: number) => void;
}>(null);
export const useLiekanShell = () => useContext(ShellContext);
export function LiekanShell({
  children,
  user,
}: {
  children: ReactNode;
  user?: { username?: string };
}) {
  const { pathname, websiteId, renderUrl } = useNavigation();
  const isGeo = isLiekanRoute(pathname);
  const [width, setWidth] = useState(228);
  const [resizing, setResizing] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [website, setWebsite] = useState<LiekanReport['website']>(null);
  const [botCount, setBotCount] = useState<number>(null);
  const drag = useRef<{ x: number; width: number }>(null);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem('lk-side-w'));
      if (saved) setWidth(Math.max(180, Math.min(320, saved)));
    } catch {}
  }, []);
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);
  const changeWidth = useCallback((value: number) => {
    const next = Math.max(180, Math.min(320, Math.round(value)));
    setWidth(next);
    try {
      localStorage.setItem('lk-side-w', String(next));
    } catch {}
  }, []);
  const geoBase = `/websites/${websiteId}/geo`;
  let lastGroup = '';
  return (
    <ShellContext.Provider value={{ setWebsite, setBotCount }}>
      <div
        data-liekan-ui
        lang={isGeo ? 'zh-CN' : undefined}
        className={`${styles.shell} ${resizing ? styles.resizing : ''}`}
        style={{ '--lk-side-w': `${width}px` } as CSSProperties}
      >
        <button
          type="button"
          className={styles.mobileToggle}
          aria-expanded={mobileOpen}
          aria-controls="liekan-navigation"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          <span aria-hidden="true">☰</span> 猎看统计
        </button>
        {mobileOpen && (
          <button
            type="button"
            className={styles.mobileBackdrop}
            aria-label="关闭导航"
            onClick={() => setMobileOpen(false)}
          />
        )}
        <aside
          className={`${reference.root} ${styles.sidebar} ${mobileOpen ? styles.sidebarOpen : ''}`}
          aria-label="猎看统计导航"
          id="liekan-navigation"
        >
          <Link href={renderUrl(websiteId ? geoBase : '/websites', false)} className={styles.brand}>
            <span className={styles.logo}>
              <BrandIcon />
            </span>
            <span className={styles.brandText}>
              猎看统计<span className={styles.brandCaption}>LIEKAN GEO STATS</span>
            </span>
          </Link>
          <nav className={styles.nav}>
            <Link href={renderUrl('/websites', false)} className="nav-quick">
              <NavIcon index={0} />
              返回管理后台
            </Link>
            {isGeo &&
              pages.map(page => {
                const group = page.group !== lastGroup;
                lastGroup = page.group;
                const href = renderUrl(geoBase + page.path, resetViewParams);
                const isActive =
                  pathname.endsWith(geoBase + page.path) || pathname === geoBase + page.path;
                return (
                  <div key={page.path}>
                    {group && <p className="nav-grp">{page.group}</p>}
                    <Link
                      href={href}
                      className={`nav-item${isActive ? ' on' : ''}`}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <NavIcon index={page.icon} />
                      {page.title}
                      {page.path === '/ai/bots' && botCount != null && (
                        <span className="ml-auto text-[11px] bg-wash text-sub rounded-md px-1.5 py-0.5 num">
                          {botCount}
                        </span>
                      )}
                    </Link>
                  </div>
                );
              })}
            {!isGeo && (
              <div className={styles.coreNavigation}>
                {websiteId ? (
                  <>
                    <Link className="nav-item" href={renderUrl(geoBase, false)}>
                      <NavIcon index={1} />
                      猎看流量洞察
                    </Link>
                    <WebsiteNav websiteId={websiteId} isCollapsed={false} />
                    <Link
                      className="nav-item"
                      href={renderUrl(`/websites/${websiteId}`, { legacy: '1' })}
                    >
                      传统统计视图
                    </Link>
                  </>
                ) : pathname.includes('/settings') ? (
                  <SettingsNav isCollapsed={false} />
                ) : pathname.includes('/admin') ? (
                  <AdminNav />
                ) : (
                  <>
                    <p className="nav-grp">站点管理</p>
                    {[
                      ['/dashboard', '工作台'],
                      ['/boards', '看板'],
                      ['/websites', '网站'],
                      ['/links', '链接'],
                      ['/pixels', '像素'],
                    ].map(([path, label], i) => (
                      <Link
                        key={path}
                        href={renderUrl(path, false)}
                        className={`nav-item${pathname.endsWith(path) ? ' on' : ''}`}
                      >
                        <NavIcon index={i === 2 ? 7 : 1} />
                        {label}
                      </Link>
                    ))}
                    <p className="nav-grp">账户与团队</p>
                    <Link href={renderUrl('/settings', false)} className="nav-item">
                      <NavIcon index={5} />
                      设置
                    </Link>
                  </>
                )}
              </div>
            )}
          </nav>
          <div className={styles.footer}>
            {!isGeo && <UserButton showText />}
            <div
              className={styles.site}
              title={`${website?.domain || website?.name || '当前站点'} · ${user?.username || ''}`}
            >
              <span className={styles.avatar}>
                {(user?.username || 'L').slice(0, 1).toUpperCase()}
              </span>
              <span className={styles.siteName}>
                {website?.domain || website?.name || '当前站点'}
              </span>
              <span className={styles.siteActions}>
                <Link href={renderUrl('/websites', false)} aria-label="切换站点" title="切换站点">
                  <svg
                    width="15"
                    height="15"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="3" y="3" width="7" height="7" rx="1.5" />
                    <rect x="14" y="3" width="7" height="7" rx="1.5" />
                    <rect x="3" y="14" width="7" height="7" rx="1.5" />
                    <rect x="14" y="14" width="7" height="7" rx="1.5" />
                  </svg>
                </Link>
                <Link
                  href={renderUrl(
                    websiteId ? `/settings/websites/${websiteId}` : '/settings',
                    false,
                  )}
                  aria-label="站点设置"
                  title="设置"
                >
                  <svg
                    width="15"
                    height="15"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33l-.06-.06a1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6c.6-.26 1-.86 1-1.51V3a2 2 0 1 1 4 0v.09c0 .65.4 1.25 1 1.51.6.26 1.3.13 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.26.6.86 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.65 0-1.25.4-1.51 1z" />
                  </svg>
                </Link>
              </span>
            </div>
          </div>
          <div
            role="separator"
            tabIndex={0}
            aria-label="调整侧栏宽度"
            aria-orientation="vertical"
            aria-valuemin={180}
            aria-valuemax={320}
            aria-valuenow={width}
            className={styles.resizer}
            onKeyDown={event => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                changeWidth(width + (event.key === 'ArrowRight' ? 10 : -10));
              } else if (event.key === 'Home') {
                event.preventDefault();
                changeWidth(180);
              } else if (event.key === 'End') {
                event.preventDefault();
                changeWidth(320);
              }
            }}
            onPointerDown={event => {
              event.preventDefault();
              drag.current = { x: event.clientX, width };
              event.currentTarget.setPointerCapture(event.pointerId);
              setResizing(true);
            }}
            onPointerMove={event => {
              if (drag.current) changeWidth(drag.current.width + event.clientX - drag.current.x);
            }}
            onPointerUp={event => {
              drag.current = null;
              setResizing(false);
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onLostPointerCapture={() => {
              drag.current = null;
              setResizing(false);
            }}
          />
        </aside>
        <div className={styles.content}>
          <div className={isGeo ? reference.root : styles.coreFrame}>{children}</div>
        </div>
      </div>
    </ShellContext.Provider>
  );
}
