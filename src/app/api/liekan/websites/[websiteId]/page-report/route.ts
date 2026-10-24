import {
  analysisAsyncRequested,
  asyncAnalysisResponse,
} from '@/lib/liekan/upstream/analysis-query-api';
import { requestApi, api } from '@/lib/liekan/http';
import { readPageReport } from '@/lib/liekan/upstream/page-report';
import { authorize } from '@/lib/liekan/upstream/server';
import { noteCacheResult } from '@/lib/liekan/upstream/cache-context';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const start = performance.now();
  let headers: Record<string, string> = {};
  return requestApi(
    request,
    async () => {
      const { websiteId } = await params;
      if (
        analysisAsyncRequested(request, 'feature:page-report') &&
        !['logs', 'human/keywords'].includes(new URL(request.url).searchParams.get('resource'))
      )
        return asyncAnalysisResponse(request, websiteId, 'feature:page-report');
      const access = await authorize(request, websiteId);
      const authorizedAt = performance.now();
      const query = new URL(request.url).searchParams;
      const result = await readPageReport(
        access.website,
        Object.fromEntries(query),
        query.get('refresh') === '1',
      );
      result.value.website = access.website;
      result.value.meta.canManage = access.canManage;
      noteCacheResult(result);
      headers = {
        'X-Liekan-Cache': result.status,
        'X-Liekan-Generated-At': String(result.generatedAt),
        'X-Liekan-Expires-At': String(result.expiresAt),
        'Server-Timing': `auth;dur=${(authorizedAt - start).toFixed(1)},report;dur=${(performance.now() - authorizedAt).toFixed(1)};desc="${result.status}"`,
      };
      return result.value;
    },
    () => headers,
  );
}
