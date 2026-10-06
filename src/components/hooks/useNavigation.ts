import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { buildPath } from '@/lib/url';

const entityId = (pathname: string, entity: string) =>
  pathname.match(
    new RegExp(`/${entity}/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?=/|$)`),
  )?.[1];
// Website URLs carry either the UUID or the short numeric site number.
const websiteId = (pathname: string) =>
  pathname.match(
    new RegExp(
      `/websites/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|\\d{1,9})(?=/|$)`,
    ),
  )?.[1];

export function useNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const teamId = entityId(pathname, 'teams');
  const siteId = websiteId(pathname);
  const linkId = entityId(pathname, 'links');
  const pixelId = entityId(pathname, 'pixels');
  const boardId = entityId(pathname, 'boards');
  const searchParamsString = searchParams.toString();
  const queryParams = useMemo(() => Object.fromEntries(searchParams), [searchParamsString]);

  const updateParams = useCallback(
    (params?: Record<string, string | number>) => {
      return buildPath(pathname, { ...queryParams, ...params });
    },
    [pathname, queryParams],
  );

  const replaceParams = useCallback(
    (params?: Record<string, string | number>) => {
      return buildPath(pathname, params);
    },
    [pathname],
  );

  const renderUrl = useCallback(
    (path: string, params?: Record<string, string | number> | false) => {
      return buildPath(
        teamId ? `/teams/${teamId}${path}` : path,
        params === false ? {} : { ...queryParams, ...params },
      );
    },
    [teamId, queryParams],
  );

  return {
    router,
    pathname,
    searchParams,
    query: queryParams,
    teamId,
    websiteId: siteId,
    linkId,
    pixelId,
    boardId,
    updateParams,
    replaceParams,
    renderUrl,
  };
}
