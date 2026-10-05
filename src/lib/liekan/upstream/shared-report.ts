import { checkAuth } from '@/lib/auth';
import { ENTITY_TYPE } from '@/lib/constants';
import { canViewWebsiteSection } from '@/permissions/share';
import {
  sharedReportParts,
  sharedReportQuery,
  sharedReportSchema,
  type SharedReport,
} from '../contracts/shared-report';
import { buildReport } from '../report';
import { withoutQueryCache } from './cache-context';
import { loadShareEntity } from './live-share';
import { analyticsCache, analyticsCacheKey, websiteCacheTag } from './query-cache';
import { authorize, LiekanError, query, reportSnapshot } from './server';

export async function readSharedReport(request: Request, websiteId: string): Promise<SharedReport> {
  const auth = await checkAuth(request);
  if (!auth) throw new LiekanError('需要有效分享凭据', 401);
  let website: { id: string; name: string; domain: string };
  let goals = true;
  if ('shareToken' in auth && auth.shareToken) {
    if (
      auth.user ||
      auth.shareToken.shareType !== ENTITY_TYPE.website ||
      auth.shareToken.websiteId !== websiteId ||
      !(await canViewWebsiteSection(auth, websiteId, 'overview'))
    )
      throw new LiekanError('此分享未开放网站总览', 403);
    const entity = await loadShareEntity(ENTITY_TYPE.website, websiteId);
    if (!entity) throw new LiekanError('分享网站不存在', 404);
    website = { id: entity.id, name: entity.name, domain: entity.domain };
    goals = await canViewWebsiteSection(auth, websiteId, 'goals');
  } else {
    website = (await authorize(request, websiteId)).website;
  }
  const input = sharedReportQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!input.success) throw new LiekanError('分享统计参数无效');
  const revision = (
    await query(
      'SELECT data_revision::text AS data,policy_revision::text AS policy FROM liekan_log_state WHERE website_id=$1::uuid',
      website.id,
    )
  )[0] || { data: '0', policy: '0' };
  const { value: report } = await analyticsCache.read(
    analyticsCacheKey('shared-report-v1', [
      process.env.DATABASE_URL,
      website.id,
      input.data,
      revision,
    ]),
    30000,
    [websiteCacheTag(website.id)],
    () =>
      reportSnapshot(() =>
        withoutQueryCache(() =>
          buildReport(website, false, { ...input.data, resource: 'overview' }, 'share'),
        ),
      ),
  );
  // Publish only the aggregate fields consumed by the shared dashboard.
  const result = sharedReportSchema.parse({
    ...report,
    website,
    cards: report.cards.filter(card =>
      (sharedReportParts.cards as readonly string[]).includes(card.label),
    ),
    charts: Object.fromEntries(
      sharedReportParts.charts.map(id => {
        const { labels, series, state } = report.charts[id];
        return [
          id,
          {
            labels,
            series,
            state,
            ...(id === 'g1' && {
              rows: report.charts.g1.rows?.map(row => ({
                conversionRate: goals ? row.conversionRate : null,
              })),
            }),
          },
        ];
      }),
    ),
    tables: {
      envGrid: report.tables.envGrid,
      cityBody: report.tables.cityBody.slice(0, 12).map(row => ({
        ...row,
        conversionRate: goals ? row.conversionRate : null,
      })),
    },
    states: { ...report.states, goals: goals ? report.states.goals : 'unsupported' },
    insights: report.insights.map(text =>
      text.replace(
        '按 UA 分类，官方 IP 范围匹配结果见访问流。',
        '按 User-Agent 分类，抓取身份以官方 IP 范围核验为准。',
      ),
    ),
    meta: { demo: report.meta.demo, canManage: false, latestImportAt: null, ruleCount: 0 },
    capabilities: { goals },
  });
  return result as SharedReport;
}
