import mapping from '@/lib/liekan/contracts/feature-pages.json';
import type { FeatureRoute } from '@/lib/liekan/contracts/features';

export const featurePages = mapping.pages;
const globalPages = new Set(['dashboard', 'dashboard-edit']);
export function normalizeFeatureScope(route: FeatureRoute): FeatureRoute {
  return globalPages.has(route.page) ? { ...route, teamId: undefined } : route;
}
const uuid = '[a-fA-F0-9-]{36}';
const aliases = mapping.routes.filter(
  r =>
    !r.target.startsWith('reference/') &&
    !['/', '/logout', '/login', '/login/two-factor', '/sso'].includes(r.route),
);
export function matchFeatureRoute(
  pathname: string,
  query: Record<string, string> = {},
): FeatureRoute | null {
  if (query.legacy === '1') return null;
  if (/^\/liekan\/?$/.test(pathname)) return { page: 'dashboard' };
  let path = pathname;
  const team = path.match(new RegExp(`^/teams/(${uuid})(?=/)`));
  if (team && !path.match(new RegExp(`^/teams/${uuid}/?$`))) path = path.slice(team[0].length);
  if (path.startsWith('/liekan/')) {
    const page = path.slice(8).split('/')[0];
    if (featurePages.some(p => p.id === page))
      return normalizeFeatureScope({
        page,
        websiteId: query.websiteId,
        id: query.id,
        teamId: team?.[1] || query.teamId,
      });
    return { page: 'not-found' };
  }
  for (const route of aliases) {
    const names: string[] = [];
    const pattern = route.route.replace(/\[([^\]]+)\]/g, (_full, name) => {
      names.push(name);
      return `(${uuid})`;
    });
    const match = path.match(new RegExp(`^${pattern}/?$`));
    if (!match) continue;
    const values = Object.fromEntries(names.map((name, i) => [name, match[i + 1]]));
    return normalizeFeatureScope({
      page: route.target.replace('.html', ''),
      websiteId: values.websiteId,
      id:
        values.sessionId ||
        values.replayId ||
        values.boardId ||
        values.linkId ||
        values.pixelId ||
        values.userId ||
        values.teamId,
      teamId: team?.[1] || values.teamId || query.teamId,
    });
  }
  return null;
}
export function featureHref(page: string, params: Record<string, any> = {}): string {
  const record = featurePages.find(p => p.id === page);
  const geo = page === 'overview' && params.websiteId ? `/websites/${params.websiteId}/geo` : '';
  if (!record && !geo) return '/dashboard';
  const base =
    geo ||
    (record.route &&
    !record.route.includes('[[...') &&
    mapping.routes.some(route => route.route === record.route)
      ? record.route
      : `/liekan/${page}`);
  let path = base.replace(/\[([^\]]+)\]/g, (_full, name) =>
    String(name === 'websiteId' ? params.websiteId || '' : params.id || ''),
  );
  if (path.includes('//') || (/\/$/.test(path) && base.endsWith(']'))) path = `/liekan/${page}`;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (
      value != null &&
      value !== '' &&
      (key !== 'teamId' || !globalPages.has(page)) &&
      (!['websiteId', 'id'].includes(key) || path.startsWith('/liekan/'))
    )
      search.set(key, String(value));
  return `${path}${search.size ? '?' + search.toString() : ''}`;
}
export function featureWebsiteSwitchHref(
  route: FeatureRoute,
  websiteId: string,
  query: Record<string, string>,
) {
  const lists: Record<string, string> = {
    'session-detail': 'sessions',
    'replay-player': 'replays',
    'event-detail': 'events',
    'path-detail': 'journeys',
    'goal-editor': 'goals',
    'funnel-editor': 'funnels',
    'segment-editor': 'segments',
    'cohort-editor': 'cohorts',
  };
  const page = lists[route.page] || route.page;
  const time = Object.fromEntries(
    Object.entries(query).filter(([key]) => ['date', 'unit', 'offset', 'compare'].includes(key)),
  );
  return featureHref(page, {
    ...time,
    websiteId,
    ...(page === route.page && route.id ? { id: route.id } : {}),
    ...(route.teamId ? { teamId: route.teamId } : {}),
  });
}
