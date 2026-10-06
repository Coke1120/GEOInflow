import { getAttribution } from '../queries/sql/attribution/getAttribution';
import { ENTITY_TYPE, EVENT_COLUMNS, SESSION_COLUMNS } from '../lib/constants';
import { getCompareDate } from '../lib/date';
import {
  type AnalyticsRefreshJob,
  forgetAnalyticsHot,
  hotJobEligible,
  readAnalyticsHot,
  renewAnalyticsHotVersion,
  scheduleNextAnalyticsHot,
} from '../lib/liekan/upstream/analytics-hot';
import {
  analyticsRefreshJobSchema,
  parseAnalyticsHotParameters,
} from '../lib/liekan/upstream/analytics-hot-parameters';
import { readAnalyticsVersions } from '../lib/liekan/upstream/analytics-revision';
import {
  analyticsWorkerContext,
  currentCacheContext,
  noteCacheResult,
  runCacheAuthorization,
} from '../lib/liekan/upstream/cache-context';
import { featureAnalytics, featureJourney } from '../lib/liekan/upstream/feature-analytics';
import { currentShareScope, loadShareEntity } from '../lib/liekan/upstream/live-share';
import { readPageReport } from '../lib/liekan/upstream/page-report';
import { analyticsCacheKey, websiteCacheTag } from '../lib/liekan/upstream/query-cache';
import prisma, { getRawQueryClient } from '../lib/prisma';
import {
  analyticsRemaining,
  timedAnalyticsClient,
} from '../lib/liekan/upstream/analytics-deadline';
import { getQueryFilters } from '../lib/request';
import { canViewWebsiteSection } from '../permissions/share';
import { getShare } from '../queries/prisma/share';
import * as queries from '../queries/sql';
import { getBreakdown } from '../queries/sql/breakdown/getBreakdown';
import { getWebsiteEventStats } from '../queries/sql/events/getWebsiteEventStats';
import { getFunnel } from '../queries/sql/funnels/getFunnel';
import { getGoal } from '../queries/sql/goals/getGoal';
import { getHeatmap } from '../queries/sql/heatmap/getHeatmap';
import { getJourney } from '../queries/sql/journeys/getJourney';
import { getPerformanceChart } from '../queries/sql/performance/getPerformanceChart';
import { getPerformanceMetrics } from '../queries/sql/performance/getPerformanceMetrics';
import { getPerformanceStats } from '../queries/sql/performance/getPerformanceStats';
import { getRetention } from '../queries/sql/retention/getRetention';
import { getRevenueChart } from '../queries/sql/revenue/getRevenueChart';
import { getRevenueMetrics } from '../queries/sql/revenue/getRevenueMetrics';
import { getRevenueStats } from '../queries/sql/revenue/getRevenueStats';
import { getUTM } from '../queries/sql/utm/getUTM';

const primary = (): any => getRawQueryClient(prisma.client, { write: true });
async function warmNative(id: string, target: string, input: Record<string, any>) {
  const p: any = parseAnalyticsHotParameters(`native:${target}`, input);
  const filters = await getQueryFilters(p, id);
  const parameters: any = { ...p, ...filters };
  const { startDate: comparisonStart, endDate: comparisonEnd } = getCompareDate(
    filters.compare || 'prev',
    filters.startDate,
    filters.endDate,
  );
  const comparison = { ...filters, startDate: comparisonStart, endDate: comparisonEnd };
  // One worker computation slot serves the entire job; finish each query before starting the next.
  if (target === 'stats')
    return [
      await queries.getWebsiteStats(id, filters),
      await queries.getWebsiteStats(id, comparison),
    ];
  if (target === 'pageviews')
    return [
      await queries.getPageviewStats(id, filters),
      await queries.getSessionStats(id, filters),
      ...(filters.compare
        ? [
            await queries.getPageviewStats(id, comparison),
            await queries.getSessionStats(id, comparison),
          ]
        : []),
    ];
  if (target === 'events/stats')
    return [await getWebsiteEventStats(id, filters), await getWebsiteEventStats(id, comparison)];
  if (target === 'events/series') return queries.getEventStats(id, { limit: p.limit }, filters);
  if (target === 'metrics') {
    if (SESSION_COLUMNS.includes(p.type))
      return queries.getSessionMetrics(id, { type: p.type, limit: p.limit }, filters);
    if (p.type === 'channel') return queries.getChannelMetrics(id, filters);
    if (EVENT_COLUMNS.includes(p.type))
      return p.type === 'event'
        ? queries.getEventMetrics(
            id,
            { type: p.type, limit: p.limit },
            { ...filters, eventType: 2 },
          )
        : queries.getPageviewMetrics(id, { type: p.type, limit: p.limit }, filters);
    return;
  }
  if (target === 'goals/stats') return getGoal(id, parameters, filters);
  if (target === 'funnels/stats') return getFunnel(id, parameters, filters);
  if (target === 'retention') return getRetention(id, parameters, filters);
  if (target === 'journeys') return getJourney(id, parameters, filters);
  if (target === 'breakdown') return getBreakdown(id, parameters, filters);
  if (target === 'attribution')
    return getAttribution(id, { ...parameters, ...filters } as any, filters);
  if (target === 'heatmap' || target === 'heatmaps') return getHeatmap(id, parameters);
  if (target === 'performance/stats') return getPerformanceStats(id, parameters, filters);
  if (target === 'performance/chart') return getPerformanceChart(id, parameters, filters);
  if (target === 'performance/metrics')
    return getPerformanceMetrics(
      id,
      parameters,
      filters,
      { path: 'url_path', title: 'page_title', device: 'device', browser: 'browser' }[p.type],
      p.limit ?? (p.type === 'device' ? undefined : 500),
    );
  if (target === 'revenue/stats')
    return [
      await getRevenueStats(id, parameters, filters),
      await getRevenueStats(id, { ...parameters, ...comparison }, filters),
    ];
  if (target === 'revenue/chart') return getRevenueChart(id, parameters, filters);
  if (target === 'revenue/metrics') return getRevenueMetrics(id, parameters, filters, p.type);
  if (target === 'utm/metrics') return getUTM(id, { ...parameters, column: p.type }, filters);
}

async function readStrongVersion(websiteId: string) {
  const deadline = Math.min(currentCacheContext()?.deadline || Infinity, Date.now() + 5000);
  return primary().$transaction(
    async transaction => {
      const tx = timedAnalyticsClient(transaction, deadline);
      const schema = new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public';
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('Invalid analytics schema');
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      return (await readAnalyticsVersions(tx, [websiteCacheTag(websiteId)])).strong;
    },
    {
      timeout: analyticsRemaining(deadline),
      maxWait: Math.min(5000, analyticsRemaining(deadline)),
    },
  );
}

export { readStrongVersion as readAnalyticsHotStrongVersion };

async function authorize(job: AnalyticsRefreshJob) {
  return runCacheAuthorization(() => authorizeMetadata(job));
}
async function authorizeMetadata(job: AnalyticsRefreshJob) {
  const db = primary();
  const website =
    (await loadShareEntity(ENTITY_TYPE.website, job.websiteId)) ||
    (job.target.startsWith('native:') &&
      ((await loadShareEntity(ENTITY_TYPE.link, job.websiteId)) ||
        (await loadShareEntity(ENTITY_TYPE.pixel, job.websiteId))));
  if (!website) return null;
  let auth: any, scope: any;
  if (job.shareId) {
    if (
      [
        'feature:page-report',
        'feature:analytics',
        'feature:journeys',
        'native:heatmap',
        'native:heatmaps',
      ].includes(job.target)
    )
      return null;
    const share = await getShare(job.shareId);
    const shareToken = await currentShareScope(share);
    if (
      !shareToken ||
      (job.target === 'feature:shared-report' &&
        (shareToken.shareType !== ENTITY_TYPE.website || shareToken.websiteId !== job.websiteId))
    )
      return null;
    auth = { shareToken };
    scope = {
      shareId: shareToken.shareId,
      parameters: shareToken.parameters,
      websiteId: shareToken.websiteId,
      websiteIds: shareToken.websiteIds,
      linkIds: shareToken.linkIds,
      pixelIds: shareToken.pixelIds,
      boardLayoutHash: shareToken.boardLayoutHash,
    };
  } else {
    const user = await db.user.findFirst({
      where: { id: job.actorId, deletedAt: null },
      select: { id: true, role: true },
    });
    if (!user) return null;
    if (user.role !== 'admin' && website.userId !== user.id) {
      if (
        website.userId ||
        !website.teamId ||
        !(await db.teamUser.findFirst({
          where: { teamId: website.teamId, userId: user.id, team: { deletedAt: null } },
          select: { id: true },
        }))
      )
        return null;
    }
    auth = { user: { ...user, isAdmin: user.role === 'admin' } };
    scope = { private: true };
  }
  if (analyticsCacheKey('scope-v1', scope) !== job.scopeHash) return null;
  const target = job.target.split(':')[1];
  const section: any = ['stats', 'pageviews'].includes(target)
    ? ['overview', 'compare']
    : target === 'metrics'
      ? ['overview', 'events', 'sessions', 'compare', 'breakdown', 'utm', 'attribution']
      : target.startsWith('performance')
        ? 'performance'
        : target.startsWith('revenue')
          ? 'revenue'
          : target.startsWith('goals')
            ? 'goals'
            : target.startsWith('funnels')
              ? 'funnels'
              : target.startsWith('events')
                ? 'events'
                : target === 'utm/metrics'
                  ? 'utm'
                  : ['retention', 'journeys', 'breakdown', 'attribution'].includes(target)
                    ? target
                    : 'overview';
  // Private ownership and membership have been checked with primary queries above.
  if (job.shareId && !(await canViewWebsiteSection(auth, job.websiteId, section))) return null;
  return { website, auth, scope };
}

export async function processAnalyticsRefresh(input: unknown) {
  const parsed = analyticsRefreshJobSchema.safeParse(input);
  if (!parsed.success) return;
  const job = parsed.data as AnalyticsRefreshJob;
  const now = Date.now();
  const hot = await readAnalyticsHot(job, now);
  if (
    !hot ||
    hot.job.scheduledAt !== job.scheduledAt ||
    hot.job.expectedStrongVersion !== job.expectedStrongVersion
  )
    return;
  if (now > job.scheduledAt + 30000) {
    await renewAnalyticsHotVersion(job, job.expectedStrongVersion);
    return;
  }
  if (now < job.scheduledAt) return;
  return analyticsWorkerContext(
    job.actorId || job.shareId,
    undefined,
    async () => {
      const authorized = await authorize(job);
      if (!authorized) {
        await forgetAnalyticsHot(job);
        return;
      }
      let parameters: any;
      try {
        parameters = parseAnalyticsHotParameters(job.target, job.parameters);
      } catch {
        await forgetAnalyticsHot(job);
        return;
      }
      const strong = await readStrongVersion(job.websiteId);
      if (strong !== job.expectedStrongVersion) {
        await renewAnalyticsHotVersion(job, strong);
        return;
      }
      if (!(await hotJobEligible(job))) {
        // A different hot query may own the site's current round. Keep this demand recoverable.
        await renewAnalyticsHotVersion(job, strong);
        return;
      }
      const { website, auth, scope } = authorized;
      const target = job.target.split(':')[1];
      const results = await analyticsWorkerContext(
        job.actorId || job.shareId,
        scope,
        async () => {
          currentCacheContext().parameters = parameters;
          if (job.target === 'feature:page-report')
            noteCacheResult(await readPageReport(website, parameters, true));
          else if (job.target === 'feature:analytics')
            await featureAnalytics(job.websiteId, parameters);
          else if (job.target === 'feature:journeys')
            await featureJourney(job.websiteId, parameters);
          else if (job.target === 'feature:shared-report')
            await (await import('../lib/liekan/upstream/shared-report')).warmSharedReport(
              website,
              parameters,
              auth,
            );
          else if (job.target.startsWith('native:'))
            await warmNative(job.websiteId, target, parameters);
          return [...currentCacheContext().results];
        },
        { deadline: job.scheduledAt + 30000, reauthorize: async () => !!(await authorize(job)) },
      );
      if (!(await authorize(job))) {
        await forgetAnalyticsHot(job);
        return;
      }
      const latest = await readStrongVersion(job.websiteId);
      if (latest !== strong) {
        await renewAnalyticsHotVersion(job, latest);
        return;
      }
      if (!results.length) {
        await forgetAnalyticsHot(job);
        return;
      }
      await scheduleNextAnalyticsHot(
        job,
        Math.min(...results.map(result => result.expiresAt)),
        Math.min(...results.map(result => result.generatedAt)),
        latest,
      );
    },
    { deadline: job.scheduledAt + 30000 },
  );
}
