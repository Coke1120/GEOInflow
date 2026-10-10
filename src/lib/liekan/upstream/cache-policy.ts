import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export function statisticsCacheTtl(end: number | Date, timezone = 'UTC', now = Date.now()) {
  const today = +fromZonedTime(
    `${formatInTimeZone(now, timezone, 'yyyy-MM-dd')}T00:00:00`,
    timezone,
  );
  return +end < today ? analyticsCacheLimits.historicalTtl : analyticsCacheLimits.currentTtl;
}

export function isAggregateRequest(path: string, params?: Record<string, any>) {
  if (params?.resource === 'logs') return false;
  if (
    path.endsWith('/analytics') &&
    [
      'realtime',
      'session',
      'sessions',
      'session-properties',
      'events',
      'replays',
      'revenue',
    ].includes(params?.kind)
  )
    return false;
  return (
    /^\/liekan\/websites\/(?:summary$|[^/]+\/(?:page-report|shared-report|crawler-analysis|analytics|goals\/[^/]+\/analytics)$)/.test(
      path,
    ) ||
    /^\/(?:liekan\/)?websites\/[^/]+\/(?:stats|pageviews|metrics(?:\/expanded)?|events\/(?:series|stats)|utm\/metrics|goals\/(?:stats|[^/]+\/(?:stats|savedstats))|funnels\/(?:stats|[^/]+\/(?:stats|savedstats))|retention|journeys|attribution|breakdown|heatmaps(?:\/[^/]+)?|(?:performance|revenue)\/(?:stats|chart|metrics))$/.test(
      path,
    ) ||
    /^\/(?:websites|links|pixels)\/charts$/.test(path) ||
    /^\/liekan\/links\/[^/]+\/sources$/.test(path)
  );
}

export const analyticsCacheLimits = Object.freeze({
  entries: 128,
  bytes: 32 * 1024 * 1024,
  resultBytes: 2 * 1024 * 1024,
  currentTtl: 30000,
  historicalTtl: 300000,
});
export const analyticsPreheatTargets = {
  native: new Set([
    'stats',
    'pageviews',
    'metrics',
    'events/stats',
    'events/series',
    'goals/stats',
    'funnels/stats',
    'retention',
    'journeys',
    'breakdown',
    'attribution',
    'heatmap',
    'heatmaps',
    'performance/stats',
    'performance/chart',
    'performance/metrics',
    'revenue/stats',
    'revenue/chart',
    'revenue/metrics',
    'utm/metrics',
  ]),
  feature: new Set(['page-report', 'shared-report', 'analytics', 'journeys']),
};

export function statisticsResourcePolicy(path: string, parameters: Record<string, any> = {}) {
  const aggregate = isAggregateRequest(path, parameters);
  const target = path.replace(/^\/(?:liekan\/)?websites\/[^/]+\//, '');
  const feature = path.startsWith('/liekan/');
  const complex =
    ['filter', 'search', 'cursor'].some(key => Boolean(parameters[key])) ||
    Number(parameters.page || 1) !== 1;
  return {
    aggregate,
    maxResultBytes: analyticsCacheLimits.resultBytes,
    ttl: aggregate ? statisticsCacheTtl(parameters.endAt, parameters.timezone) : 0,
    preheat:
      aggregate &&
      !complex &&
      (feature ? analyticsPreheatTargets.feature : analyticsPreheatTargets.native).has(target),
  };
}

export type PageCacheMode = 'aggregate' | 'configuration' | 'direct';
// Every page's dynamic modules are explicit; adding a page requires a coverage decision.
export const pageCacheModules: Record<string, Record<string, PageCacheMode>> = {};
// AI reads retain their authenticated no-store API and conversation snapshot boundaries.
pageCacheModules['ai-chat'] = { catalog: 'direct', conversations: 'direct', answers: 'direct' };
pageCacheModules['ai-config'] = { connections: 'direct', connectionTests: 'direct' };
for (const page of [
  'overview',
  'geo-ai',
  'geo-bots',
  'geo-ai-pages',
  'geo-preference',
  'geo-human',
  'geo-geography',
  'geo-sources',
  'geo-keywords',
  'geo-content',
  'geo-conversions',
  'utm',
  'attribution',
  'retention',
  'breakdown',
  'compare',
  'performance',
  'heatmaps',
  'link-detail',
  'pixel-detail',
])
  pageCacheModules[page] = { statistics: 'aggregate' };
for (const page of [
  'onboarding',
  'tracking',
  'website-settings',
  'recorder-settings',
  'account',
  'security',
  'api-keys',
  'preferences',
  'goal-editor',
  'funnel-editor',
  'filters',
  'segment-editor',
  'cohort-editor',
  'annotations',
  'teams',
  'team-detail',
  'team-join',
  'admin-users',
  'admin-user',
  'admin-websites',
  'admin-teams',
  'admin-security',
  'board-editor',
  'board-design',
  'sharing',
  'link-editor',
  'pixel-editor',
])
  pageCacheModules[page] = { configuration: 'configuration' };
for (const page of [
  'install-check',
  'login',
  'login-2fa',
  'sso',
  'two-factor',
  'backup-codes',
  'realtime',
  'geo-logs',
  'event-detail',
  'sessions',
  'session-detail',
  'path-detail',
  'replays',
  'replay-player',
  'exports',
])
  pageCacheModules[page] = { records: 'direct' };
for (const page of [
  'websites',
  'links',
  'pixels',
  'boards',
  'board-view',
  'goals',
  'funnels',
  'segments',
  'cohorts',
])
  pageCacheModules[page] = { configuration: 'configuration', statistics: 'aggregate' };
for (const page of ['events', 'journeys', 'revenue'])
  pageCacheModules[page] = { statistics: 'aggregate', records: 'direct' };
pageCacheModules['share-preview'] = {
  authorization: 'direct',
  layout: 'configuration',
  statistics: 'aggregate',
  records: 'direct',
};
for (const page of ['help', 'access-denied', 'session-expired', 'not-found'])
  pageCacheModules[page] = {};

for (const page of ['security', 'admin-security']) pageCacheModules[page].securityStatus = 'direct';
