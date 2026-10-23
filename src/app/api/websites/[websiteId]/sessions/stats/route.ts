import { withQueryCacheHeaders } from '@/lib/liekan/upstream/cache-context';
import { z } from 'zod';
import { getQueryFilters, parseRequest } from '@/lib/request';
import { json, unauthorized } from '@/lib/response';
import { filterParams } from '@/lib/schema';
import { canViewWebsiteSection } from '@/permissions';
import { getWebsiteSessionStats } from '@/queries/sql';

async function getResponse(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const schema = z.object({
    startAt: z.coerce.number().int(),
    endAt: z.coerce.number().int(),
    ...filterParams,
  });

  const { auth, query, error } = await parseRequest(request, schema);

  if (error) {
    return error();
  }

  const { websiteId } = await params;

  if (!(await canViewWebsiteSection(auth, websiteId, 'sessions'))) {
    return unauthorized();
  }

  const filters = await getQueryFilters(query, websiteId);

  const metrics = await getWebsiteSessionStats(websiteId, filters);

  const { population, ...values } = metrics[0];
  const data = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      { value: value === null ? null : Number(value) || 0 },
    ]),
  );
  return json({ ...data, ...(population ? { population } : {}) });
}

export async function GET(...args: Parameters<typeof getResponse>) {
  return withQueryCacheHeaders(() => getResponse(...args), args[0]);
}
