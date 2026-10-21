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
  return withQueryCacheHeaders(() => getResponse(...args), args[0]);
}
