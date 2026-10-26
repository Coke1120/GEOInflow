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
import { getWebsiteStats } from '@/queries/sql';

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

  const { startDate, endDate } = getCompareDate(
    filters.compare ?? 'prev',
    filters.startDate,
    filters.endDate,
    filters.timezone,
  );

  const [data, comparison] = await Promise.all([
    getWebsiteStats(websiteId, filters),
    getWebsiteStats(websiteId, { ...filters, startDate, endDate }),
  ]);

  return json({ ...data, comparison });
}

export async function GET(...args: Parameters<typeof getResponse>) {
  if (analysisAsyncRequested(args[0], 'native:stats'))
    return requestApi(args[0], async () =>
      asyncAnalysisResponse(args[0], (await args[1].params).websiteId, 'native:stats'),
    );

  return withQueryCacheHeaders(() => getResponse(...args), args[0]);
}
