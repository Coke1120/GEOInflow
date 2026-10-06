import { withQueryCacheHeaders } from '@/lib/liekan/upstream/cache-context';
import { utmMetricsQuerySchema } from '@/lib/analytics-schema';
import { getQueryFilters, parseRequest } from '@/lib/request';
import { json, unauthorized } from '@/lib/response';
import { canViewWebsiteSection } from '@/permissions';
import { getUTM } from '@/queries/sql/utm/getUTM';

async function getResponse(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const { auth, query, error } = await parseRequest(request, utmMetricsQuerySchema);
  if (error) return error();
  const { websiteId } = await params;
  if (!(await canViewWebsiteSection(auth, websiteId, 'utm'))) return unauthorized();
  const filters = await getQueryFilters(query, websiteId);
  return json(
    await getUTM(
      websiteId,
      { startDate: filters.startDate, endDate: filters.endDate, column: query.type },
      filters,
    ),
  );
}

export async function GET(...args: Parameters<typeof getResponse>) { return withQueryCacheHeaders(() => getResponse(...args)); }
