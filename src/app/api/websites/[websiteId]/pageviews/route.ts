import { requestApi } from '@/lib/liekan/http';
import {
  analysisAsyncRequested,
  asyncAnalysisResponse,
} from '@/lib/liekan/upstream/analysis-query-api';
import { withQueryCacheHeaders } from '@/lib/liekan/upstream/cache-context';
import { getCompareDate } from '@/lib/date';
import { getQueryFilters, parseRequest } from '@/lib/request';
import { json, unauthorized } from '@/lib/response';
import { filterParams, withDateRange } from '@/lib/schema';
import { canViewWebsiteSection } from '@/permissions';
import { getPageviewStats, getSessionStats } from '@/queries/sql';

async function getResponse(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const schema = withDateRange({
    ...filterParams,
  });

  const { auth, query, error } = await parseRequest(request, schema);

  if (error) {
    return error();
  }

  const { websiteId } = await params;

  if (!(await canViewWebsiteSection(auth, websiteId, ['overview', 'compare']))) {
    return unauthorized();
  }

  const filters = await getQueryFilters(query, websiteId);

  const [pageviews, sessions] = await Promise.all([
    getPageviewStats(websiteId, filters),
    getSessionStats(websiteId, filters),
  ]);

  if (filters.compare) {
    const { startDate: compareStartDate, endDate: compareEndDate } = getCompareDate(
      filters.compare,
      filters.startDate,
      filters.endDate,
      filters.timezone,
    );

    const [comparePageviews, compareSessions] = await Promise.all([
      getPageviewStats(websiteId, {
        ...filters,
        startDate: compareStartDate,
        endDate: compareEndDate,
      }),
      getSessionStats(websiteId, {
        ...filters,
        startDate: compareStartDate,
        endDate: compareEndDate,
      }),
    ]);

    return json({
      pageviews,
      sessions,
      startDate: filters.startDate,
      endDate: filters.endDate,
      compare: {
        pageviews: comparePageviews,
        sessions: compareSessions,
        startDate: compareStartDate,
        endDate: compareEndDate,
      },
    });
  }

  return json({ pageviews, sessions });
}

export async function GET(...args: Parameters<typeof getResponse>) {
  if (analysisAsyncRequested(args[0], 'native:pageviews'))
    return requestApi(args[0], async () =>
      asyncAnalysisResponse(args[0], (await args[1].params).websiteId, 'native:pageviews'),
    );

  return withQueryCacheHeaders(() => getResponse(...args), args[0]);
}
