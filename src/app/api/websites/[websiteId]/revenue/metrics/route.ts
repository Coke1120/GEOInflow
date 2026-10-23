import { requestApi } from '@/lib/liekan/http';
import {
  analysisAsyncRequested,
  asyncAnalysisResponse,
} from '@/lib/liekan/upstream/analysis-query-api';
import { withQueryCacheHeaders } from '@/lib/liekan/upstream/cache-context';
import { z } from 'zod';
import { getQueryFilters, parseRequest } from '@/lib/request';
import { badRequest, json, unauthorized } from '@/lib/response';
import { filterParams, withDateRange } from '@/lib/schema';
import { canViewWebsiteSection } from '@/permissions';
import type { RevenuParameters } from '@/queries/sql/revenue/getRevenueChart';
import { getRevenueMetrics, type RevenueMetricType } from '@/queries/sql/revenue/getRevenueMetrics';

const revenueMetricType = z.enum(['country', 'region', 'referrer', 'channel']);

async function getResponse(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const schema = withDateRange({
    type: revenueMetricType,
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

  const { type, currency } = query;
  const filters = await getQueryFilters(query, websiteId);

  if (!type) {
    return badRequest();
  }

  const parameters = { ...filters, currency } as RevenuParameters;

  return json(await getRevenueMetrics(websiteId, parameters, filters, type as RevenueMetricType));
}

export async function GET(...args: Parameters<typeof getResponse>) {
  if (analysisAsyncRequested(args[0], 'native:revenue/metrics'))
    return requestApi(args[0], async () =>
      asyncAnalysisResponse(args[0], (await args[1].params).websiteId, 'native:revenue/metrics'),
    );

  return withQueryCacheHeaders(() => getResponse(...args), args[0]);
}
