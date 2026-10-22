import { withQueryCacheHeaders } from '@/lib/liekan/upstream/cache-context';
import { parseRequest } from '@/lib/request';
import { json, unauthorized } from '@/lib/response';
import { canViewWebsiteSection } from '@/permissions';
import { getEventDataById } from '@/queries/sql/events/getEventDataById';

async function getResponse(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; eventId: string }> },
) {
  const { auth, error } = await parseRequest(request);

  if (error) {
    return error();
  }

  const { websiteId, eventId } = await params;

  if (!(await canViewWebsiteSection(auth, websiteId, 'events'))) {
    return unauthorized();
  }

  const data = await getEventDataById(websiteId, eventId);

  return json(data);
}

export async function GET(...args: Parameters<typeof getResponse>) {
  return withQueryCacheHeaders(() => getResponse(...args), args[0]);
}
