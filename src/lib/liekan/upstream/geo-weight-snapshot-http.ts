import { geoDateOffset, geoWindow } from '../geo-weight/window';
import { authenticateCrawler, type CrawlerActor } from './crawler-access';
import { LiekanError } from './errors';
import type { GeoWeightResponse, GeoWeightSnapshotResponse } from '../contracts/geo-weight';
/** Snapshot metadata carries its archived catalog; current request catalog headers are inert. */
export async function geoSnapshotApi(
  request: Request,
  work: (actor: CrawlerActor) => Promise<GeoWeightSnapshotResponse>,
  accepted = false,
) {
  try {
    const actor = await authenticateCrawler(request);
    const result = await work(actor);
    const current = await authenticateCrawler(request);
    if (current.id !== actor.id) throw new LiekanError('当前登录已失效', 401);
    if (request.signal.aborted) throw new LiekanError('统计读取已取消', 499);
    const now = Date.now();
    const generatedAt = result.result ? Date.parse(result.result.calculatedAt) : NaN;
    let expiresAt = now;
    if (result.result && Number.isFinite(generatedAt)) {
      const historical = new URL(request.url).searchParams.get('mode') === 'historical';
      const nextMidnight = geoWindow(
        geoDateOffset(result.requestedAsOf, 1),
        result.result.timezone,
      ).endAt;
      expiresAt = Math.min(historical ? now + 86400000 : nextMidnight, generatedAt + 90 * 86400000);
    }
    const freshness = Number.isFinite(generatedAt)
      ? {
          'X-Liekan-Server-Time': String(now),
          'X-Liekan-Generated-At': String(generatedAt),
          'X-Liekan-Expires-At': String(expiresAt),
        }
      : { 'X-Liekan-Server-Time': String(now) };
    const capacity = accepted && result.taskStatus === 'capacity_blocked';
    return Response.json(
      capacity
        ? {
            ...result,
            error: {
              message: 'GEO 快照存储已达上限，请在 60 秒后重新读取',
              status: 429,
              code: 'geo-capacity',
            },
          }
        : result,
      {
        status: capacity ? 429 : accepted ? 202 : 200,
        headers: {
          'Cache-Control': 'private, no-store',
          ...freshness,
          ...(capacity ? { 'Retry-After': '60' } : {}),
          ...(result.result
            ? { 'X-Liekan-Catalog-Version': result.result.readCatalogVersion }
            : {}),
        },
      },
    );
  } catch (error) {
    const status = error instanceof LiekanError ? error.status : 503;
    return Response.json(
      {
        error: {
          message: error instanceof LiekanError ? error.message : 'GEO 后台暂不可用，请重新读取',
          status,
          code: error instanceof LiekanError ? error.code : 'geo-unavailable',
        },
      },
      {
        status,
        headers: {
          'Cache-Control': 'private, no-store',
          ...([429, 503].includes(status)
            ? {
                'Retry-After':
                  status === 429 && /5 分钟/.test((error as Error).message) ? '300' : '60',
              }
            : {}),
        },
      },
    );
  }
}

export async function geoLegacyApi(
  request: Request,
  work: (actor: CrawlerActor) => Promise<GeoWeightResponse>,
) {
  const response = await geoSnapshotApi(request, async actor => {
    const result = await work(actor);
    return {
      format: 'geo-snapshot-v1',
      taskId: null,
      taskStatus: 'ready',
      result,
      snapshotId: result.snapshotId || null,
      requestedAsOf: result.current.asOf,
      servedAsOf: result.current.asOf,
      stale: false,
      nextRetryAt: null,
      errorCode: null,
      canRecalculate: false,
      strongVersion: '',
    };
  });
  if (response.status !== 200) return response;
  const envelope = await response.json();
  return Response.json(envelope.result, { headers: response.headers });
}
