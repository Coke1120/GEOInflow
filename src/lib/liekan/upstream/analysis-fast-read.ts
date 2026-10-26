import { getCompareDate } from '@/lib/date';
import { getQueryFilters } from '@/lib/request';
import {
  ANALYSIS_RESULT_FORMAT,
  analysisQueryParameters,
  decodeAnalysisEnvelope,
  encodeAnalysisResult,
} from './analysis-query-model';
import { analysisVersions } from './analysis-rollups-db';
import { readAnalyticsVersions } from './analytics-revision';
import { websiteCacheTag } from './query-cache';
import { executeNativeAnalysis } from './analysis-native-execution';
import { reportSnapshot, query } from './server';
import { getQuerySnapshot } from './query-snapshot';
import { statisticsCacheTtl } from './cache-policy';
import { analyticsGate, AnalyticsUnavailable } from './analytics-budget';
import {
  captureBrowserPopulations,
  noteBrowserPopulation,
  withoutQueryCache,
} from './cache-context';

/** Only completely covered, aligned native counts enter the short foreground transaction. */
export async function tryFastAnalysis(
  website: { id: string; name: string; domain: string },
  target: string,
  input: Record<string, unknown>,
) {
  if (input.refresh === '1' || !['native:stats', 'native:metrics'].includes(target))
    return undefined;
  const p = analysisQueryParameters(target, input);
  const supported = new Set([
    'startAt',
    'endAt',
    'timezone',
    'unit',
    'compare',
    'type',
    'limit',
    'offset',
    'browser',
    'os',
    'device',
    'screen',
    'language',
    'country',
    'region',
    'city',
    'hostname',
  ]);
  if (
    Object.keys(p).some(
      key => !supported.has(key) && p[key] != null && p[key] !== '' && p[key] !== false,
    )
  )
    return undefined;
  if (
    target === 'native:metrics' &&
    ![
      'browser',
      'os',
      'device',
      'screen',
      'language',
      'country',
      'region',
      'city',
      'hostname',
    ].includes(p.type)
  )
    return undefined;
  const filters = await getQueryFilters(p, website.id);
  const windows = [{ startDate: filters.startDate, endDate: filters.endDate }];
  if (target === 'native:stats')
    windows.push(
      getCompareDate(filters.compare || 'prev', filters.startDate, filters.endDate, filters.timezone) as any,
    );
  // Partial hourly edges stay on the persistent exact path. Inclusive final instants use the reader's indexed point gap.
  if (
    windows.some(
      w =>
        !w.startDate ||
        !w.endDate ||
        +w.startDate % 3600000 ||
        +w.endDate % 3600000 ||
        +w.endDate <= +w.startDate,
    )
  )
    return undefined;
  const deadline = Date.now() + 200;
  try {
    const result = await analyticsGate.run(
      () =>
        reportSnapshot(async () => {
          const tx = getQuerySnapshot() as any;
          const versions = await analysisVersions(tx, website.id);
          const strong = (await readAnalyticsVersions(tx, [websiteCacheTag(website.id)])).strong;
          const [state] = await query<{ epoch: string }>(
            "SELECT epoch::text FROM liekan_analysis_site WHERE website_id=$1::uuid AND mode='live'",
            website.id,
          );
          if (!state) return undefined;
          for (const window of windows) {
            const [coverage] = await query<{ complete: boolean }>(
              `SELECT coalesce(range_agg(tstzrange(m.bucket,m.bucket_end,'[)')) @> tstzrange($2::timestamptz,$3::timestamptz,'[)'),false) AS complete
         FROM liekan_analysis_manifest m JOIN liekan_analysis_site s USING(website_id,epoch)
         WHERE m.website_id=$1::uuid AND s.mode='live' AND m.family='visit' AND m.bucket<$3::timestamptz AND m.bucket_end>$2::timestamptz
         AND m.versions=$4::jsonb AND m.fingerprint=liekan_analysis_fingerprint(m.website_id,m.epoch,m.family,m.bucket,m.bucket_end)`,
              website.id,
              window.startDate,
              window.endDate,
              JSON.stringify(versions),
            );
            if (!coverage.complete) return undefined;
          }
          const generatedAt = Date.now();
          const captured = await withoutQueryCache(() =>
            captureBrowserPopulations(() => executeNativeAnalysis(website.id, target.slice(7), p)),
          );
          const result = decodeAnalysisEnvelope(
            { format: ANALYSIS_RESULT_FORMAT, ...JSON.parse(encodeAnalysisResult(captured)) },
            website.id,
          );
          return {
            value: result.value,
            populations: result.populations,
            generatedAt,
            expiresAt:
              Date.now() + statisticsCacheTtl(Number(p.endAt), String(p.timezone || 'UTC')),
            status: 'miss' as const,
            tier: 'computed' as const,
            strong,
            versions,
            epoch: state.epoch,
          };
        }, deadline),
      deadline,
    );
    if (!result) return undefined;
    // The returned snapshot must still belong to the current published policy and site epoch.
    const current = await reportSnapshot(async () => {
      const tx = getQuerySnapshot() as any;
      const [state] = await query<{ epoch: string }>(
        "SELECT epoch::text FROM liekan_analysis_site WHERE website_id=$1::uuid AND mode='live'",
        website.id,
      );
      return {
        epoch: state?.epoch,
        versions: await analysisVersions(tx, website.id),
        strong: (await readAnalyticsVersions(tx, [websiteCacheTag(website.id)])).strong,
      };
    }, deadline);
    if (
      current.epoch !== result.epoch ||
      current.strong !== result.strong ||
      JSON.stringify(current.versions) !== JSON.stringify(result.versions)
    )
      return undefined;
    const { populations, ...value } = result;
    for (const population of populations) noteBrowserPopulation(website.id, population);
    return value;
  } catch (error) {
    if (
      error instanceof AnalyticsUnavailable ||
      ['P2028', 'P2024'].includes((error as any)?.code) ||
      /statement timeout|canceling statement/.test(String((error as any)?.message))
    )
      return undefined;
    throw error;
  }
}
