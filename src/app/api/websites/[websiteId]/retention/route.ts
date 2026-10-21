import { withQueryCacheHeaders } from '@/lib/liekan/upstream/cache-context';
import { retentionQuerySchema } from '@/lib/analytics-schema';
import { getQueryFilters, parseRequest } from '@/lib/request';
import { json, unauthorized } from '@/lib/response';
import { canViewWebsiteSection } from '@/permissions';
import { getRetention, type RetentionParameters } from '@/queries/sql/retention/getRetention';

async function getResponse(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const { auth, query, error } = await parseRequest(request, retentionQuerySchema);
  if (error) return error();
  const { websiteId } = await params;
  if (!(await canViewWebsiteSection(auth, websiteId, 'retention'))) return unauthorized();
  const filters = await getQueryFilters(query, websiteId);
  const parameters = { ...query, ...filters } as RetentionParameters;
  return json(await getRetention(websiteId, parameters, filters));
}

export async function GET(...args: Parameters<typeof getResponse>) {
  return withQueryCacheHeaders(() => getResponse(...args), args[0]);
}
