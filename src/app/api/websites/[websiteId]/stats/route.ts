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
  );

  const [data, comparison] = await Promise.all([
    getWebsiteStats(websiteId, filters),
    getWebsiteStats(websiteId, { ...filters, startDate, endDate }),
  ]);

  return json({ ...data, comparison });
}

export async function GET(...args: Parameters<typeof getResponse>) {
  return withQueryCacheHeaders(() => getResponse(...args));
}
