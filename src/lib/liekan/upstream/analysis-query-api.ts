import { z } from 'zod';
import type { requestAnalysisQuery } from './analysis-queries';
import { noteCacheResult, probeCacheOnly } from './cache-context';
import { LiekanError } from './errors';
import { analysisQueryParameters, encodeAnalysisResult } from './analysis-query-model';

export function analysisAsyncRequested(request: Request, target?: string) {
  if (
    process.env.CLICKHOUSE_URL ||
    ['3', '4'].includes(new URL(request.url).searchParams.get('eventType')) ||
    !request.headers
      .get('prefer')
      ?.split(',')
      .some(v => v.trim() === 'respond-async')
  )
    return false;
  if (target) {
    try {
      analysisQueryParameters(target, Object.fromEntries(new URL(request.url).searchParams));
    } catch {
      return false;
    }
  }
  return true;
}
export function analysisResponse(value: Awaited<ReturnType<typeof requestAnalysisQuery>>) {
  if (value.ready) {
    noteCacheResult({
      value: value.value,
      generatedAt: value.generatedAt,
      expiresAt: value.expiresAt,
      status: 'hit',
    });
    return Response.json(value.value, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  return Response.json(
    {
      analysisJob: (value as { analysisJob: unknown }).analysisJob,
      ...('previousResult' in value ? { previousResult: value.previousResult } : {}),
    },
    { status: 202, headers: { 'Cache-Control': 'private, no-store', 'Retry-After': '3' } },
  );
}
export async function asyncAnalysisResponse(request: Request, websiteId: string, target: string) {
  const { authenticateCrawlerMaintenance } = await import('./crawler-maintenance');
  const { authorize } = await import('./server');
  const { requestAnalysisQuery } = await import('./analysis-queries');
  const actor = await authenticateCrawlerMaintenance(request);
  const access = await authorize(request, websiteId);
  const query = Object.fromEntries(new URL(request.url).searchParams);
  if (target === 'feature:page-report' && !['logs', 'human/keywords'].includes(query.resource)) {
    const { peekPageReport } = await import('./page-report');
    const cached = await peekPageReport(access.website, query);
    if (cached) {
      cached.value.website = access.website;
      cached.value.meta.canManage = access.canManage;
      noteCacheResult(cached);
      return Response.json(cached.value);
    }
  }
  if (query.refresh !== '1') {
    if (target.startsWith('native:')) {
      const { executeNativeAnalysis } = await import('./analysis-native-execution');
      const cached = await probeCacheOnly(() =>
        executeNativeAnalysis(access.website.id, target.slice(7), query),
      );
      if (cached !== undefined) return Response.json(JSON.parse(encodeAnalysisResult(cached)));
    }
    const { tryFastAnalysis } = await import('./analysis-fast-read');
    const fast = await tryFastAnalysis(access.website, target, query);
    if (fast) {
      noteCacheResult(fast);
      return Response.json(JSON.parse(encodeAnalysisResult(fast.value)));
    }
  }
  const { readLocaleCookie } = await import('../i18n/locale');
  const locale =
    readLocaleCookie(request.headers.get('cookie') || '') ||
    (request.headers.get('accept-language')?.startsWith('en') ? 'en-US' : 'zh-CN');
  return analysisResponse(
    await requestAnalysisQuery(access.website.id, actor, target, query, locale),
  );
}
export async function analysisJobResponse(
  request: Request,
  websiteId: string,
  jobId: string,
  result = false,
) {
  const { authenticateCrawlerMaintenance } = await import('./crawler-maintenance');
  const { authorize } = await import('./server');
  const { requestAnalysisQuery, readAnalysisQuery } = await import('./analysis-queries');
  if (!z.uuid().safeParse(jobId).success) throw new LiekanError('统计任务标识无效', 400);
  const actor = await authenticateCrawlerMaintenance(request);
  const access = await authorize(request, websiteId);
  const data = await readAnalysisQuery(access.website.id, actor, jobId, result);
  if (!result) return Response.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
  return analysisResponse(data);
}
