import { EVENT_COLUMNS, SESSION_COLUMNS } from '@/lib/constants';
import { getCompareDate } from '@/lib/date';
import { getQueryFilters } from '@/lib/request';
import { parseAnalyticsHotParameters } from './analytics-hot-parameters';
import { getAttribution } from '@/queries/sql/attribution/getAttribution';
import * as queries from '@/queries/sql';
import { getBreakdown } from '@/queries/sql/breakdown/getBreakdown';
import { getWebsiteEventStats } from '@/queries/sql/events/getWebsiteEventStats';
import { getFunnel } from '@/queries/sql/funnels/getFunnel';
import { getGoal } from '@/queries/sql/goals/getGoal';
import { getHeatmap } from '@/queries/sql/heatmap/getHeatmap';
import { getJourney } from '@/queries/sql/journeys/getJourney';
import { getPerformanceChart } from '@/queries/sql/performance/getPerformanceChart';
import { getPerformanceMetrics } from '@/queries/sql/performance/getPerformanceMetrics';
import { getPerformanceStats } from '@/queries/sql/performance/getPerformanceStats';
import { getRetention } from '@/queries/sql/retention/getRetention';
import { getRevenueChart } from '@/queries/sql/revenue/getRevenueChart';
import { getRevenueMetrics } from '@/queries/sql/revenue/getRevenueMetrics';
import { getRevenueStats } from '@/queries/sql/revenue/getRevenueStats';
import { getUTM } from '@/queries/sql/utm/getUTM';

export async function executeNativeAnalysis(
  id: string,
  target: string,
  input: Record<string, any>,
) {
  const p: any = parseAnalyticsHotParameters(`native:${target}`, input);
  const filters = await getQueryFilters(p, id);
  if (target === 'metrics' && p.search) filters[p.type] = `c.${p.search}`;
  const parameters: any = { ...p, ...filters };
  const { startDate: comparisonStart, endDate: comparisonEnd } = getCompareDate(
    filters.compare || 'prev',
    filters.startDate,
    filters.endDate,
  );
  const comparison = { ...filters, startDate: comparisonStart, endDate: comparisonEnd };
  // One worker computation slot serves the entire job; finish each query before starting the next.
  if (target === 'stats')
    return {
      ...(await queries.getWebsiteStats(id, filters)),
      comparison: await queries.getWebsiteStats(id, comparison),
    };
  if (target === 'pageviews') {
    const pageviews = await queries.getPageviewStats(id, filters);
    const sessions = await queries.getSessionStats(id, filters);
    if (!filters.compare) return { pageviews, sessions };
    return {
      pageviews,
      sessions,
      startDate: filters.startDate,
      endDate: filters.endDate,
      compare: {
        pageviews: await queries.getPageviewStats(id, comparison),
        sessions: await queries.getSessionStats(id, comparison),
        startDate: comparisonStart,
        endDate: comparisonEnd,
      },
    };
  }
  if (target === 'events/stats')
    return {
      data: {
        ...(await getWebsiteEventStats(id, filters)),
        comparison: await getWebsiteEventStats(id, comparison),
      },
    };
  if (target === 'events/series') return queries.getEventStats(id, { limit: p.limit }, filters);
  if (target === 'metrics') {
    if (SESSION_COLUMNS.includes(p.type))
      return queries.getSessionMetrics(
        id,
        { type: p.type, limit: p.limit, offset: p.offset },
        filters,
      );
    if (p.type === 'channel') return queries.getChannelMetrics(id, filters);
    if (EVENT_COLUMNS.includes(p.type))
      return p.type === 'event'
        ? queries.getEventMetrics(
            id,
            { type: p.type, limit: p.limit, offset: p.offset },
            { ...filters, eventType: 2 },
          )
        : queries.getPageviewMetrics(
            id,
            { type: p.type, limit: p.limit, offset: p.offset },
            filters,
          );
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
    return {
      ...(await getRevenueStats(id, parameters, filters)),
      comparison: await getRevenueStats(id, { ...parameters, ...comparison }, filters),
    };
  if (target === 'revenue/chart') return getRevenueChart(id, parameters, filters);
  if (target === 'revenue/metrics') return getRevenueMetrics(id, parameters, filters, p.type);
  if (target === 'utm/metrics') return getUTM(id, { ...parameters, column: p.type }, filters);
}
