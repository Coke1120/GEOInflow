import {
  analysisAsyncRequested,
  asyncAnalysisResponse,
} from '@/lib/liekan/upstream/analysis-query-api';
import { withQueryCacheHeaders } from '@/lib/liekan/upstream/cache-context';
import { requestApi, api } from '@/lib/liekan/http';
import { authorize } from '@/lib/liekan/upstream/server';
import { featureJourney } from '@/lib/liekan/upstream/feature-analytics';
async function getResponse(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return requestApi(request, async () => {
    const { websiteId } = await params;
    if (analysisAsyncRequested(request, 'feature:journeys'))
      return asyncAnalysisResponse(request, websiteId, 'feature:journeys');
    const { website } = await authorize(request, websiteId);
    return featureJourney(website.id, Object.fromEntries(new URL(request.url).searchParams));
  });
}

export async function GET(...args: Parameters<typeof getResponse>) {
  return withQueryCacheHeaders(() => getResponse(...args), args[0]);
}
