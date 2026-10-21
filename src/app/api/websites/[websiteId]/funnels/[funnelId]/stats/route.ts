import { withQueryCacheHeaders, prepareAnalyticsVersions } from '@/lib/liekan/upstream/cache-context';
import { funnelParametersSchema, savedStatsQuerySchema } from '@/lib/analytics-schema';
import { getQueryFilters, parseRequest } from '@/lib/request';
import { badRequest, json, notFound, unauthorized } from '@/lib/response';
import { canViewReport, canViewWebsiteSection } from '@/permissions';
import { getReport } from '@/queries/prisma';
import { type FunnelParameters, getFunnel } from '@/queries/sql/funnels/getFunnel';

async function getResponse(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; funnelId: string }> },
) {
  const { auth, query, error } = await parseRequest(request, savedStatsQuerySchema);
  if (error) return error();
  const { websiteId, funnelId } = await params;
  if (!(await canViewWebsiteSection(auth, websiteId, 'funnels'))) return unauthorized();
  await prepareAnalyticsVersions([`website:${websiteId.toLowerCase()}`]);
  const report = await getReport(funnelId);
  if (!report || report.websiteId !== websiteId || report.type !== 'funnel') return notFound();
  if (!(await canViewReport(auth, report))) return unauthorized();
  const parsed = funnelParametersSchema.safeParse(report.parameters);
  if (!parsed.success) return badRequest();
  const filters = await getQueryFilters(query, websiteId);
  const parameters = { ...parsed.data, ...filters } as FunnelParameters;
  return json(await getFunnel(websiteId, parameters, filters));
}

export async function GET(...args: Parameters<typeof getResponse>) {
  return withQueryCacheHeaders(() => getResponse(...args), args[0]);
}
