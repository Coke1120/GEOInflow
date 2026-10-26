import { requestApi } from '@/lib/liekan/http';
import {
  analysisAsyncRequested,
  asyncAnalysisResponse,
} from '@/lib/liekan/upstream/analysis-query-api';
import { withQueryCacheHeaders } from '@/lib/liekan/upstream/cache-context';
import { z } from 'zod';
import { getCompareDate } from '@/lib/date';
import { getQueryFilters, parseRequest } from '@/lib/request';
import { json, unauthorized } from '@/lib/response';
import { filterParams, withDateRange } from '@/lib/schema';
import { canViewWebsiteSection } from '@/permissions';
import type { RevenuParameters } from '@/queries/sql/revenue/getRevenueChart';
import { getRevenueStats } from '@/queries/sql/revenue/getRevenueStats';

async function getResponse(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const schema = withDateRange({
    currency: z.string(),
    ...filterParams,
  });

  const { auth, query, error } = await parseRequest(request, schema);

  if (error) {
    return error();
  }

  const { websiteId } = await params;

  if (!(await canViewWebsiteSection(auth, websiteId, 'revenue'))) {
    return unauthorized();
  }

  const { currency } = query;
  const filters = await getQueryFilters(query, websiteId);
  const parameters = { ...filters, currency } as RevenuParameters;
  const { compare = 'prev' } = parameters;
  const { startDate, endDate } = getCompareDate(
    compare,
    parameters.startDate,
    parameters.endDate,
    parameters.timezone,
  );
  const comparisonParameters = { ...parameters, startDate, endDate };

  const [stats, comparison] = await Promise.all([
    getRevenueStats(websiteId, parameters, filters),
    getRevenueStats(websiteId, comparisonParameters, filters),
  ]);

  return json({ ...stats, comparison });
}

export async function GET(...args: Parameters<typeof getResponse>) {
  if (analysisAsyncRequested(args[0], 'native:revenue/stats'))
    return requestApi(args[0], async () =>
      asyncAnalysisResponse(args[0], (await args[1].params).websiteId, 'native:revenue/stats'),
    );

  return withQueryCacheHeaders(() => getResponse(...args), args[0]);
}
