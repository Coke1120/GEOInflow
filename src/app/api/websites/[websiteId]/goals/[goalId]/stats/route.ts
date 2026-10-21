import { withQueryCacheHeaders, prepareAnalyticsVersions } from '@/lib/liekan/upstream/cache-context';
import { goalParametersSchema, savedStatsQuerySchema } from '@/lib/analytics-schema';
import { getQueryFilters, parseRequest } from '@/lib/request';
import { badRequest, json, notFound, unauthorized } from '@/lib/response';
import { canViewReport, canViewWebsiteSection } from '@/permissions';
import { getReport } from '@/queries/prisma';
import { analysisQuery } from '@/lib/liekan/contracts/analysis';
import { type GoalParameters, getGoal } from '@/queries/sql/goals/getGoal';

async function getResponse(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; goalId: string }> },
) {
  const { auth, query, error } = await parseRequest(request, savedStatsQuerySchema);
  if (error) return error();
  const { websiteId, goalId } = await params;
  if (!(await canViewWebsiteSection(auth, websiteId, 'goals'))) return unauthorized();
  await prepareAnalyticsVersions([`website:${websiteId.toLowerCase()}`]);
  const report = await getReport(goalId);
  if (!report || report.websiteId !== websiteId || report.type !== 'goal') return notFound();
  if (!(await canViewReport(auth, report))) return unauthorized();
  const parsed = goalParametersSchema.safeParse(report.parameters);
  if (!parsed.success) return badRequest();
  const filters = await getQueryFilters(query, websiteId);
  const parameters = { ...parsed.data, ...filters } as GoalParameters;
  const stats = await getGoal(websiteId, parameters, filters);
  if (process.env.CLICKHOUSE_URL || !analysisQuery.safeParse(query).success) return json(stats);
  const { featureGoal } = await import('@/lib/liekan/upstream/feature-analytics');
  const detail = await featureGoal(
    websiteId,
    goalId,
    {
      ...query,
      unit:
        ['minute', 'hour'].includes(filters.unit) &&
        Number(query.endAt) - Number(query.startAt) >
          (filters.unit === 'minute' ? 60000 : 3600000) * 9998
          ? 'day'
          : filters.unit || 'day',
    },
    auth,
  );
  return json({ ...stats, series: detail.series, conversions: detail.conversions });
}

export async function GET(...args: Parameters<typeof getResponse>) {
  return withQueryCacheHeaders(() => getResponse(...args), args[0]);
}
