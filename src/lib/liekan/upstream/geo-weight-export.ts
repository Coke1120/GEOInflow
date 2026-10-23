import { GEO_ACTIVITY_FORMULA, GEO_LEVEL_MINIMUMS } from '../geo-weight/policy';
import { geoWeightExportSchema } from '../contracts/geo-weight';
import { safeCsvCell } from '../contracts/exports';
import type { GeoWeightResponse } from '../contracts/geo-weight';
import {
  geoPurposeLabels,
  geoPointStateLabel,
  geoReasonLabels,
} from '../contracts/geo-weight-labels';
import { translateText } from '../i18n/text';
import type { LiekanLocale } from '../i18n/locale';
import { authenticateCrawler, authorizeCrawler, type CrawlerActor } from './crawler-access';
import { readGeoWeightForExport } from './geo-weight-snapshots';
import { geoWeightRemaining, geoWeightTransaction } from './geo-weight';
import { LiekanError } from './errors';

export function geoWeightCsv(result: GeoWeightResponse, locale: LiekanLocale) {
  const text = (s: string) => translateText(s, locale);
  const rows: unknown[][] = [
    ['row_type', 'as_of', 'label', 'value'],
    [
      'metadata',
      result.current.asOf,
      text('GEO 权重计算依据'),
      JSON.stringify({
        websiteId: result.websiteId,
        hostname: result.hostname,
        timezone: result.timezone,
        algorithm: result.algorithm,
        scoreScopeHash: result.scoreScopeHash,
        readCatalogVersion: result.readCatalogVersion,
        readCatalogHash: result.readCatalogHash,
        epoch: result.epoch,
        dataRevision: result.dataRevision,
        snapshot: result.snapshot,
        snapshotId: result.snapshotId,
        calculatedAt: result.calculatedAt,
        locale,
        scope: result.scope,
        formula: GEO_ACTIVITY_FORMULA,
        levelMinimums: GEO_LEVEL_MINIMUMS,
      }),
    ],
  ];
  const points = [
    ['current', result.current],
    ['previous', result.previous],
    ...(result.observations || []).map(p => ['observation', p]),
  ] as const;
  for (const [kind, point] of points as ReadonlyArray<
    readonly [string, typeof result.current | undefined]
  >) {
    if (!point) continue;
    rows.push([
      kind,
      point.asOf,
      text(geoPointStateLabel(point)),
      JSON.stringify({
        ...point,
        reasons: point.reasons.map(reason => text(geoReasonLabels[reason])),
      }),
    ]);
    for (const category of point.categories)
      rows.push([
        `${kind}_category`,
        point.asOf,
        text(geoPurposeLabels[category.purpose]),
        JSON.stringify(category),
      ]);
  }
  return (
    '\ufeff' +
    rows
      .map(row =>
        row
          .map(value => '"' + String(safeCsvCell(value) ?? '').replaceAll('"', '""') + '"')
          .join(','),
      )
      .join('\r\n')
  );
}
export async function exportGeoWeight(
  actor: CrawlerActor,
  websiteId: string,
  body: unknown,
  request: Request,
) {
  const deadline = Date.now() + 60000;
  const parsed = geoWeightExportSchema.safeParse(body);
  if (!parsed.success) throw new LiekanError('GEO 权重导出参数无效', 400);
  const p = parsed.data;
  const result = await readGeoWeightForExport(actor, websiteId, p);
  geoWeightRemaining(deadline, request.signal);
  const current = await authenticateCrawler(request);
  geoWeightRemaining(deadline, request.signal);
  if (current.id !== actor.id) throw new LiekanError('当前登录已失效', 401);
  await geoWeightTransaction(deadline, request.signal, tx =>
    authorizeCrawler(tx, current, websiteId),
  );
  // Recheck the strong boundary after authorization; export never recomputes analytics.
  await readGeoWeightForExport(current, websiteId, { snapshotId: result.snapshotId });
  geoWeightRemaining(deadline, request.signal);
  if (request.signal.aborted) throw new LiekanError('导出已取消', 499);
  return new Response(geoWeightCsv(result, p.locale), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="liekan-geo-weight-${result.current.asOf}.csv"`,
      'Cache-Control': 'private, no-store',
      'X-Liekan-Catalog-Version': result.readCatalogVersion,
      'X-Liekan-Export-Read-At': result.calculatedAt,
    },
  });
}
