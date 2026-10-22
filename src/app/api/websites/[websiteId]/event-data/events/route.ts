import { withQueryCacheHeaders } from '@/lib/liekan/upstream/cache-context';
import { z } from 'zod';
import { getQueryFilters, parseRequest } from '@/lib/request';
import { json, unauthorized } from '@/lib/response';
import { filterParams } from '@/lib/schema';
import { canViewWebsiteSection } from '@/permissions';
import { getEventDataEvents } from '@/queries/sql/events/getEventDataEvents';

async function getResponse(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const schema = z.object({
    startAt: z.coerce.number().int(),
    endAt: z.coerce.number().int(),
    event: z.string().optional(),
    ...filterParams,
  });
  const { auth, query, error } = await parseRequest(request, schema);

  if (error) {
    return error();
  }

  const { websiteId } = await params;

  if (!(await canViewWebsiteSection(auth, websiteId, 'events'))) {
    return unauthorized();
  }

  const filters = await getQueryFilters(query, websiteId);

  const data = await getEventDataEvents(websiteId, {
    ...filters,
  });

  return json(data);
}

export async function GET(...args: Parameters<typeof getResponse>) {
  return withQueryCacheHeaders(() => getResponse(...args), args[0]);
}
