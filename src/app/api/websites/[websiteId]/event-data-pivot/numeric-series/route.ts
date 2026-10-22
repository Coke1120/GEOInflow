import { withQueryCacheHeaders } from '@/lib/liekan/upstream/cache-context';
import { z } from 'zod';
import { parseEventPropertyFilters } from '@/lib/params';
import { getQueryFilters, parseRequest } from '@/lib/request';
import { json, unauthorized } from '@/lib/response';
import { filterParams, timezoneParam, unitParam } from '@/lib/schema';
import { canViewWebsiteSection } from '@/permissions';
import { getEventDataNumericSeries } from '@/queries/sql/events/getEventDataNumericSeries';

async function getResponse(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const schema = z.object({
    startAt: z.coerce.number().int(),
    endAt: z.coerce.number().int(),
    eventName: z.string(),
    propertyName: z.string(),
    metric: z.enum(['sum', 'avg', 'count']).default('sum'),
    timezone: timezoneParam.optional(),
    unit: unitParam.optional(),
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

  const { eventName, propertyName, metric, ...rest } = query;
  const filters = await getQueryFilters(rest, websiteId);
  const eventFilters = parseEventPropertyFilters(query);
  const data = await getEventDataNumericSeries(
    websiteId,
    eventName,
    propertyName,
    metric,
    filters,
    eventFilters,
  );

  return json(data);
}

export async function GET(...args: Parameters<typeof getResponse>) {
  return withQueryCacheHeaders(() => getResponse(...args), args[0]);
}
