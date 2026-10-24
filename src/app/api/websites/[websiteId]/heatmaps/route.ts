import { requestApi } from '@/lib/liekan/http';
import {
  analysisAsyncRequested,
  asyncAnalysisResponse,
} from '@/lib/liekan/upstream/analysis-query-api';
import { heatmapQuerySchema } from '@/lib/analytics-schema';
import { withQueryCacheHeaders } from '@/lib/liekan/upstream/cache-context';
import { getQueryFilters, parseRequest } from '@/lib/request';
import { json, unauthorized } from '@/lib/response';
import { canViewAuthenticatedWebsite } from '@/permissions';
import { getHeatmap, type HeatmapParameters } from '@/queries/sql/heatmap/getHeatmap';

async function getResponse(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const { auth, query, error } = await parseRequest(request, heatmapQuerySchema);
  if (error) return error();
  const { websiteId } = await params;
  if (!(await canViewAuthenticatedWebsite(auth, websiteId))) return unauthorized();
  const filters = await getQueryFilters(query, websiteId);
  const parameters = { ...query, ...filters } as HeatmapParameters;
  return json(await getHeatmap(websiteId, parameters));
}

export async function GET(...args: Parameters<typeof getResponse>) {
  if (analysisAsyncRequested(args[0], 'native:heatmaps'))
    return requestApi(args[0], async () =>
      asyncAnalysisResponse(args[0], (await args[1].params).websiteId, 'native:heatmaps'),
    );

  return withQueryCacheHeaders(() => getResponse(...args), args[0]);
}
