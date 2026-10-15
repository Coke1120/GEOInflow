import { CRAWLER_POPULATION_VERSION, unknownCrawlerSql } from '../rules/population';
import { z } from 'zod';
import type { CrawlerAnalyzedBot, CrawlerAnalyzedPage } from '../contracts/crawler-analysis';
import type { CrawlerObservationQuality } from '../contracts/crawlers';
import { crawlerPathSchema, crawlerPlatformIds } from '../contracts/crawlers';
import { classifyEntrySource } from '../contracts/sources';
import type { AiTx } from '../upstream/ai-db';
import { crawlerReferralRows } from '../upstream/analytics';
import {
  authorizeCrawler,
  type CrawlerActor,
  crawlerTransaction,
} from '../upstream/crawler-access';
import { LiekanError } from '../upstream/errors';
import { humanPathFromEncoded } from '../upstream/paths';
import { analyticsCache, analyticsCacheKey, websiteCacheTag } from '../upstream/query-cache';
import { noteCacheResult } from '../upstream/cache-context';
import { crawlerDirectoryForObserved } from './directory';
import { crawlerOwnedBlock, crawlerOwnedMatch } from './execution';

const DAY = 86_400_000;
export const crawlerCriticalPathsSchema = z.strictObject({
  paths: z
    .array(crawlerPathSchema.shape.value)
    .max(100)
    .refine(paths => new Set(paths).size === paths.length),
});
export function crawlerRange(search: URLSearchParams, now = Date.now()) {
  const requestedEnd = search.has('endAt') ? Number(search.get('endAt')) : now;
  const requestedStart = search.has('startAt')
    ? Number(search.get('startAt'))
    : requestedEnd - 7 * DAY;
  const live = requestedEnd <= now && requestedEnd > now - 30000;
  const endAt = live ? Math.floor(requestedEnd / 30000) * 30000 : requestedEnd;
  const startAt = live ? requestedStart - (requestedEnd - endAt) : requestedStart;
  const timezone = search.get('timezone') || 'UTC';
  if (
    !Number.isSafeInteger(requestedStart) ||
    !Number.isSafeInteger(requestedEnd) ||
    !Number.isSafeInteger(startAt) ||
    !Number.isSafeInteger(endAt) ||
    startAt < 0 ||
    endAt > now ||
    startAt >= endAt ||
    endAt - startAt > 90 * DAY
  )
    throw new LiekanError('分析时间范围需要在过去 90 天内', 400);
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    throw new LiekanError('时区无效', 400);
  }
  return { startAt, endAt, timezone };
}

export const crawlerBase = `FROM liekan_effective_log l LEFT JOIN liekan_crawler_evidence e ON e.website_id=l.website_id AND e.log_id=l.id
  WHERE l.website_id=$1::uuid AND l.created_at>=$2::timestamptz AND l.created_at<$3::timestamptz AND l.user_agent NOT LIKE 'Liekan-Crawler-Check/%'`;
export const crawlerCountColumns = `count(*)::float8 AS requests,
  count(*) FILTER(WHERE status>=100 AND status<200)::float8 AS "status1xx",
  count(*) FILTER(WHERE status>=200 AND status<300)::float8 AS "status2xx",
  count(*) FILTER(WHERE status>=300 AND status<400 AND status!=304)::float8 AS "status3xx",
  count(*) FILTER(WHERE status=304)::float8 AS "status304",
  count(*) FILTER(WHERE status>=400 AND status<500)::float8 AS "status4xx",
  count(*) FILTER(WHERE status>=500 AND status<600)::float8 AS "status5xx",
  count(*) FILTER(WHERE status IN(403,429))::float8 AS "denied403429",
  count(*) FILTER(WHERE method='HEAD')::float8 AS head,
  count(*) FILTER(WHERE method='GET' AND status>=200 AND status<300)::float8 AS "successfulGets"`;

export async function crawlerWindowQuality(
  tx: AiTx,
  websiteId: string,
  startAt: number,
  endAt: number,
  timezone: string,
): Promise<CrawlerObservationQuality> {
  const args = [websiteId, new Date(startAt), new Date(endAt)];
  const [versions] = await tx.query(
    `SELECT count(distinct coalesce(e.classification_version,'legacy'))::int AS classes,
    min(e.classification_version) AS classification,count(distinct coalesce(l.source_id::text,'manual'))::int AS sources,min(l.source_id::text) AS source,
    count(*) FILTER(WHERE e.classification_version IS NULL)::int AS legacy ${crawlerBase}`,
    ...args,
  );
  const [gap] = await tx.query(
    `SELECT count(*)::int AS count FROM liekan_crawler_quality WHERE website_id=$1::uuid AND starts_at<$3 AND ends_at>$2 AND state='partial'`,
    ...args,
  );
  const [backlog] = await tx.query(
    "SELECT count(*)::int AS count FROM liekan_ingest_batch WHERE website_id=$1::uuid AND state='pending'",
    websiteId,
  );
  const declarations = await tx.query(
    `SELECT source_id AS source,evidence->>'classificationVersion' AS classification,evidence->>'sourceVersion' AS source_version,
    range_agg(tstzrange(starts_at,ends_at,'[]')) @> tstzrange($2::timestamptz,$3::timestamptz,'[)') AS covers
    FROM liekan_crawler_quality WHERE website_id=$1::uuid AND state='complete' AND evidence->>'basis'='event_time'
      AND starts_at<$3 AND ends_at>$2 GROUP BY source_id,evidence->>'classificationVersion',evidence->>'sourceVersion'`,
    ...args,
  );
  const valid = declarations.filter(row => row.covers && row.classification);
  const declaration = valid.length === 1 ? valid[0] : null;
  const complete =
    !!declaration &&
    (!versions?.classes ||
      (versions.classes === 1 &&
        !versions.legacy &&
        versions.sources === 1 &&
        versions.source === declaration.source &&
        versions.classification === declaration.classification));

  return {
    state: gap?.count
      ? 'partial'
      : backlog.count
        ? 'unknown'
        : complete
          ? 'complete'
          : !versions?.classes
            ? 'missing'
            : 'unknown',
    basis: 'event_time',
    classificationVersion:
      versions?.classes === 1 && !versions?.legacy
        ? versions.classification || ''
        : !versions?.classes
          ? declaration?.classification || ''
          : '',
    sourceVersion: complete
      ? declaration.source_version
      : versions?.sources === 1
        ? versions.source || 'manual'
        : !versions?.classes
          ? declaration?.source_version || ''
          : '',
    timezone,
  };
}
const platformHosts = {
  openai: ['chatgpt.com', 'chat.openai.com'],
  anthropic: ['claude.ai'],
  perplexity: ['perplexity.ai'],
  bytedance: ['doubao.com'],
  google: ['google.com', 'google.com.hk', 'google.cn', 'gemini.google.com'],
  baidu: ['baidu.com', 'yiyan.baidu.com'],
  microsoft: ['bing.com', 'copilot.microsoft.com'],
  apple: [],
};
function platformForSource(source: string) {
  return (
    crawlerPlatformIds.find(id =>
      (platformHosts[id] || []).some(host => source === host || source.endsWith(`.${host}`)),
    ) || null
  );
}
export async function crawlerAnalysis(
  actor: CrawlerActor,
  websiteId: string,
  range: ReturnType<typeof crawlerRange>,
) {
  const access = await crawlerTransaction(async tx => {
    const website = await authorizeCrawler(tx, actor, websiteId);
    const [state] = await tx.query(
      'SELECT epoch,data_revision FROM liekan_log_state WHERE website_id=$1::uuid',
      websiteId,
    );
    return {
      website,
      version: { epoch: state?.epoch ?? 1, revision: String(state?.data_revision ?? 0) },
    };
  });
  const cached = await analyticsCache.read(
    analyticsCacheKey('crawler-analysis-v3-' + CRAWLER_POPULATION_VERSION, {
      websiteId,
      ...range,
      ...access.version,
    }),
    30000,
    [websiteCacheTag(websiteId)],
    () =>
      crawlerTransaction(
        async tx => {
          await authorizeCrawler(tx, actor, websiteId);
          const { startAt, endAt, timezone } = range;
          const args = [websiteId, new Date(startAt), new Date(endAt)];
          const quality = await crawlerWindowQuality(tx, websiteId, startAt, endAt, timezone);
          const bots = await tx.query<CrawlerAnalyzedBot>(
            `SELECT e.crawler_id AS "botId",l.bot AS name,${crawlerCountColumns},sum(bytes)::float8 AS bytes,
      count(*) FILTER(WHERE verification='verified_range')::float8 AS "verifiedRange",count(*) FILTER(WHERE verification='range_mismatch')::float8 AS "rangeMismatch",
      count(*) FILTER(WHERE verification NOT IN('verified_range','range_mismatch'))::float8 AS unverified,
      count(distinct path) FILTER(WHERE method='GET' AND status>=200 AND status<300 AND EXISTS(SELECT 1 FROM liekan_catalog c WHERE c.website_id=l.website_id AND c.path=l.path))::int AS "successfulCatalogPages",
      max(created_at) AS "lastVisit",count(*) FILTER(WHERE e.classification_version IS NULL)::int AS "legacyRecords" ${crawlerBase} AND NOT ${unknownCrawlerSql('l')} GROUP BY 1,2 ORDER BY requests DESC`,
            ...args,
          );
          const pages = await tx.query<CrawlerAnalyzedPage>(
            `SELECT e.crawler_id AS "botId",path,l.bot AS name,${crawlerCountColumns},sum(bytes)::float8 AS bytes,
      count(*) FILTER(WHERE ${crawlerOwnedBlock})::int AS "ownedTerminatingBlocks",
      count(*) FILTER(WHERE ${crawlerOwnedMatch})::int AS "ownedMatches"
      ${crawlerBase} AND NOT ${unknownCrawlerSql('l')} GROUP BY 1,2,3 ORDER BY requests DESC,path LIMIT 1001`,
            ...args,
          );
          const duration = endAt - startAt;
          const previousRange = {
            startAt: Math.max(0, startAt - duration),
            endAt: startAt,
            timezone,
          };
          const previousBots = await tx.query(
            `SELECT e.crawler_id AS "botId",l.bot AS name,${crawlerCountColumns},sum(bytes)::float8 AS bytes ${crawlerBase} AND NOT ${unknownCrawlerSql('l')} GROUP BY 1,2`,
            websiteId,
            new Date(previousRange.startAt),
            new Date(previousRange.endAt),
          );
          const previousQuality = await crawlerWindowQuality(
            tx,
            websiteId,
            previousRange.startAt,
            previousRange.endAt,
            timezone,
          );
          const previousReferrals = await crawlerReferralRows(
            tx,
            websiteId,
            new Date(previousRange.startAt),
            new Date(previousRange.endAt - 1),
            timezone,
          );
          const referralRows = await crawlerReferralRows(
            tx,
            websiteId,
            new Date(startAt),
            new Date(endAt - 1),
            timezone,
          );
          const [browser] = await tx.query(
            'SELECT EXISTS(SELECT 1 FROM liekan_raw_website_event WHERE website_id=$1::uuid LIMIT 1) AS connected',
            websiteId,
          );
          const [goals] = await tx.query(
            "SELECT count(*)::int AS count FROM report WHERE website_id=$1::uuid AND type='goal'",
            websiteId,
          );
          const summarizePlatforms = (rows: Awaited<ReturnType<typeof crawlerReferralRows>>) =>
            crawlerPlatformIds.map(platformId => {
              const supported = Boolean(platformHosts[platformId]?.length);
              const matching = rows.filter(row => {
                const source = classifyEntrySource(row);
                return (
                  ['AI 搜索引荐', '传统搜索'].includes(source.channel) &&
                  platformForSource(source.source) === platformId
                );
              });
              const landing = new Map<
                string,
                {
                  path: string;
                  visits: number;
                  conversions: number | null;
                  goalEvents: number | null;
                }
              >();
              for (const row of matching) {
                const path = row.path || '/';
                const current = landing.get(path) || {
                  path,
                  visits: 0,
                  conversions: goals.count ? 0 : null,
                  goalEvents: goals.count ? 0 : null,
                };
                current.visits += row.visits;
                if (goals.count) {
                  current.conversions += row.conversions;
                  current.goalEvents += row.goalEvents || 0;
                }
                landing.set(path, current);
              }
              return {
                platformId,
                state: !supported
                  ? ('unsupported' as const)
                  : browser.connected
                    ? ('available' as const)
                    : ('missing' as const),
                visits:
                  supported && browser.connected
                    ? matching.reduce((n, row) => n + row.visits, 0)
                    : null,
                conversions:
                  supported && browser.connected && goals.count
                    ? matching.reduce((n, row) => n + row.conversions, 0)
                    : null,
                goalEvents:
                  supported && browser.connected && goals.count
                    ? matching.reduce((n, row) => n + (row.goalEvents || 0), 0)
                    : null,
                landingPages: [...landing.values()]
                  .sort((a, b) => b.visits - a.visits)
                  .slice(0, 1000),
                landingPagesTruncated: landing.size > 1000,
              };
            });
          const platforms = summarizePlatforms(referralRows);
          const [configured] = await tx.query(
            'SELECT critical_paths FROM liekan_crawler_state WHERE website_id=$1::uuid',
            websiteId,
          );
          const findings = await tx.query(
            'SELECT key,bot_id AS "botId",type,path_group AS "pathGroup",grade,confidence,state,facts,first_seen_at AS "firstSeenAt",last_seen_at AS "lastSeenAt",window_end AS "windowEnd",(SELECT count(*)::int FROM liekan_crawler_finding_window fw WHERE fw.website_id=liekan_crawler_finding.website_id AND fw.key=liekan_crawler_finding.key) AS "occurrenceWindows" FROM liekan_crawler_finding WHERE website_id=$1::uuid ORDER BY CASE grade WHEN \'high\' THEN 0 WHEN \'medium\' THEN 1 ELSE 2 END,last_seen_at DESC LIMIT 200',
            websiteId,
          );
          const [analysis] = await tx.query(
            'SELECT computed_at AS "computedAt",window_end AS "windowEnd",error_code AS "errorCode" FROM liekan_crawler_analysis_state WHERE website_id=$1::uuid',
            websiteId,
          );
          const pathMappings = new Map<string, string[]>();
          for (const row of pages) {
            const human = humanPathFromEncoded(row.path);
            pathMappings.set(human, [...new Set([...(pathMappings.get(human) || []), row.path])]);
          }
          return {
            range,
            quality,
            directory: crawlerDirectoryForObserved(
              [...bots, ...previousBots, ...findings].map(row => row.botId).filter(Boolean),
            ),
            bots,
            pagesTruncated: pages.length > 1000,
            pages: pages.slice(0, 1000).map(row => ({
              ...row,
              humanPath: humanPathFromEncoded(row.path),
              mergedPaths: pathMappings.get(humanPathFromEncoded(row.path)),
            })),
            platforms,
            previous: {
              range: previousRange,
              quality: previousQuality,
              bots: previousBots,
              platforms: summarizePlatforms(previousReferrals),
            },
            findings,
            criticalPaths: configured?.critical_paths || [],
            analysis: analysis || null,
            generatedAt: new Date().toISOString(),
          };
        },
        { timeout: 30000, transactionTimeout: 60000, repeatableRead: true },
      ),
  );
  noteCacheResult(cached);
  const currentAccess = await crawlerTransaction(tx => authorizeCrawler(tx, actor, websiteId));
  return {
    ...cached.value,
    permissions: { canDraft: currentAccess.canDraft, canControl: currentAccess.canControl },
  };
}
export async function saveCrawlerCriticalPaths(
  actor: CrawlerActor,
  websiteId: string,
  paths: string[],
) {
  const result = await crawlerTransaction(async tx => {
    await authorizeCrawler(tx, actor, websiteId, 'draft');
    await tx.execute(
      'INSERT INTO liekan_log_state(website_id) VALUES($1::uuid) ON CONFLICT DO NOTHING',
      websiteId,
    );
    await tx.execute(
      'INSERT INTO liekan_crawler_state(website_id,critical_paths) VALUES($1::uuid,$2::jsonb) ON CONFLICT(website_id) DO UPDATE SET critical_paths=EXCLUDED.critical_paths,updated_at=now()',
      websiteId,
      JSON.stringify(paths),
    );
    return { paths };
  });
  analyticsCache.invalidate(websiteCacheTag(websiteId));
  return result;
}
export async function changeCrawlerFinding(
  actor: CrawlerActor,
  websiteId: string,
  key: string,
  ignored: boolean,
) {
  if (!/^cr_[a-f0-9]{64}$/.test(key)) throw new LiekanError('风险标识无效', 400);
  const result = await crawlerTransaction(async tx => {
    await authorizeCrawler(tx, actor, websiteId, 'draft');
    const rows = await tx.query(
      'UPDATE liekan_crawler_finding SET state=$3,updated_at=now() WHERE website_id=$1::uuid AND key=$2 RETURNING key,state',
      websiteId,
      key,
      ignored ? 'ignored' : 'active',
    );
    if (!rows.length) throw new LiekanError('风险记录不存在', 404);
    return rows[0];
  });
  analyticsCache.invalidate(websiteCacheTag(websiteId));
  return result;
}
