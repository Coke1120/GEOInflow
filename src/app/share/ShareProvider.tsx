'use client';
import { Loading } from '@umami/react-zen';
import {
  ManualAuthorizationBoundary,
  useManualRefresh,
} from '@/lib/liekan/contracts/manual-refresh';
import { ManualRefreshControl } from '@/components/liekan/ManualRefreshControl';
import { nativeShareScope } from '@/lib/liekan/upstream/native-client';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, type ReactNode, useCallback, useEffect, useReducer, useRef } from 'react';
import { useShareTokenQuery } from '@/components/hooks';
import { ENTITY_TYPE } from '@/lib/constants';
import { monotonicNow } from '@/lib/liekan/upstream/client-freshness';
import type { ShareParameters, WhiteLabel } from '@/lib/types';
import { setShareData, useApp } from '@/store/app';

export interface ShareData {
  shareId: string;
  slug: string;
  shareType: number;
  websiteId?: string;
  websiteIds?: string[];
  boardId?: string;
  pixelId?: string;
  linkId?: string;
  parameters: ShareParameters;
  token: string;
  whiteLabel?: WhiteLabel;
}

export const ShareContext = createContext<ShareData>(null);

const selector = (state: { shareToken: { token?: string } | null }) => state.shareToken;

const ALL_SECTION_IDS = [
  'overview',
  'events',
  'sessions',
  'realtime',
  'performance',
  'compare',
  'breakdown',
  'goals',
  'funnels',
  'journeys',
  'retention',
  'utm',
  'revenue',
  'attribution',
];

function getSharePath(pathname: string) {
  const segments = pathname.split('/');
  const firstSegment = segments[3];

  // If first segment looks like a domain name, skip it
  if (firstSegment?.includes('.')) {
    return segments[4];
  }

  return firstSegment;
}

export function ShareProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const query = useShareTokenQuery(slug);
  const reading = useManualRefresh();
  const snapshotScope = useRef<{ slug: string; scope: string; changedAt?: string }>(null);
  const { share, isLoading, isFetching } = query;
  const [revision, tick] = useReducer(value => value + 1, 0);
  const initialAuthorization = () => ({
    slug,
    expiresAt: 0,
    required: true,
    lastAttempt: monotonicNow(),
    retryAt: 0,
    serverRetryAt: 0,
    error: null as unknown,
  });
  const authorization = useRef(initialAuthorization());
  if (authorization.current.slug !== slug) authorization.current = initialAuthorization();
  const current = useRef(query);
  current.current = query;
  const validate = useCallback((manual = false) => {
    const state = authorization.current;
    state.required = true;
    tick();
    if (
      document.visibilityState === 'hidden' ||
      navigator.onLine === false ||
      current.current.isFetching ||
      [401, 403, 404].includes((current.current.error as any)?.status)
    )
      return;
    if (monotonicNow() < (manual ? state.serverRetryAt : state.retryAt)) return;
    state.lastAttempt = monotonicNow();
    void current.current.refetch({ cancelRefetch: false }).catch(() => {});
  }, []);
  const router = useRouter();
  const pathname = usePathname();
  const shareToken = useApp(selector);
  const path = getSharePath(pathname);
  const isWebsiteShare = share?.shareType === ENTITY_TYPE.website;
  const isShareReady = !!share?.token && shareToken?.token === share.token;
  const isAuthorized =
    !query.error &&
    !authorization.current.required &&
    authorization.current.expiresAt > monotonicNow();

  const allowedSections =
    isWebsiteShare && share?.parameters
      ? ALL_SECTION_IDS.filter(id => share.parameters[id] === true)
      : [];

  const shouldRedirect =
    isWebsiteShare &&
    allowedSections.length === 1 &&
    allowedSections[0] !== 'overview' &&
    (path === undefined || path === '' || path === 'overview');

  useEffect(() => {
    if (shouldRedirect) {
      router.replace(`/share/${slug}/${allowedSections[0]}`);
    }
  }, [shouldRedirect, slug, allowedSections, router]);

  useEffect(() => {
    const state = authorization.current;
    if (query.error) {
      if (state.error !== query.error) {
        const now = monotonicNow();
        const retryAfter = Math.max(0, Number((query.error as any).retryAfterMs) || 0);
        state.error = query.error;
        state.retryAt = now + Math.max(30000, retryAfter);
        state.serverRetryAt = now + retryAfter;
        tick();
      }
      return;
    }
    if (!share?.token || isFetching || query.isFetchedAfterMount === false) return;
    state.expiresAt = monotonicNow() + 30000;
    state.required = false;
    state.retryAt = 0;
    state.serverRetryAt = 0;
    state.error = null;
    tick();
  }, [slug, share, isFetching, query.error, query.dataUpdatedAt, query.isFetchedAfterMount]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const visible = () => document.visibilityState !== 'hidden';
    const online = () => navigator.onLine !== false;
    const resume = () => {
      if (visible()) validate();
      else {
        authorization.current.required = true;
        tick();
      }
    };
    const state = authorization.current;
    const now = monotonicNow();
    const restricted = [401, 403, 404].includes((current.current.error as any)?.status);
    if (!restricted && state.expiresAt > now)
      timer = setTimeout(validate, Math.max(1, state.expiresAt - now));
    else if (
      !restricted &&
      visible() &&
      online() &&
      !isFetching &&
      current.current.isFetchedAfterMount !== false
    )
      timer = setTimeout(
        validate,
        Math.max(1, Math.max(state.lastAttempt + 30000, state.retryAt) - now),
      );
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', resume);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', resume);
    };
  }, [slug, revision, isFetching, query.errorUpdatedAt, validate]);

  useEffect(() => {
    return () => {
      setShareData(null, null);
    };
  }, [slug]);

  const resourceScope = share?.token ? nativeShareScope(share) : undefined;
  const round = `${reading?.page.token}:${reading?.page.round}`;
  if (resourceScope && snapshotScope.current?.scope !== resourceScope) {
    snapshotScope.current = {
      slug,
      scope: resourceScope,
      changedAt: snapshotScope.current?.slug === slug ? round : undefined,
    };
  }
  const changedScope = snapshotScope.current?.changedAt === round;
  const restricted = [401, 403, 404].includes((query.error as any)?.status);
  const offline = navigator.onLine === false;
  if (
    (!isAuthorized || !isShareReady) &&
    (!share?.token || restricted) &&
    !isFetching &&
    (query.error || offline || (!share?.token && !isLoading))
  ) {
    return (
      <div role="alert" style={{ display: 'grid', justifyItems: 'center', gap: 12, padding: 32 }}>
        <p>
          {restricted
            ? '分享链接已失效或访问权限已变更。'
            : offline
              ? '网络连接已断开，恢复连接后将重新验证分享权限。'
              : '分享权限验证失败，请重试。'}
        </p>
        {!restricted && (
          <button
            type="button"
            disabled={authorization.current.serverRetryAt > monotonicNow()}
            onClick={() => validate(true)}
          >
            重试
          </button>
        )}
      </div>
    );
  }

  if ((isFetching && isLoading) || (!share?.token && !isAuthorized)) {
    return <Loading placement="absolute" />;
  }

  if (!share || shouldRedirect) {
    return null;
  }

  const authorized = isAuthorized && isShareReady && !changedScope;
  return (
    <ShareContext.Provider value={{ ...share, slug }}>
      <ManualRefreshControl beforeRefresh={() => query.refetch({ throwOnError: true })} />
      {!authorized && (
        <div role={query.error && !isFetching ? 'alert' : 'status'}>
          {changedScope
            ? '分享范围已变更，请刷新读取。'
            : query.error && !isFetching
              ? '分享权限验证失败，请重试。'
              : '正在核验分享权限。'}
          {query.error && !isFetching && (
            <button
              type="button"
              disabled={authorization.current.serverRetryAt > monotonicNow()}
              onClick={() => validate(true)}
            >
              重试
            </button>
          )}
        </div>
      )}
      <ManualAuthorizationBoundary authorized={authorized}>
        <div hidden={!authorized}>{children}</div>
      </ManualAuthorizationBoundary>
    </ShareContext.Provider>
  );
}
