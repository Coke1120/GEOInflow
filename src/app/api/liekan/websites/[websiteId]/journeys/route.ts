import { withQueryCacheHeaders } from '@/lib/liekan/upstream/cache-context';
import { api } from '@/lib/liekan/http';
import { authorize } from '@/lib/liekan/upstream/server';
import { featureJourney } from '@/lib/liekan/upstream/feature-analytics';
async function getResponse(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return api(async () => {
    const { websiteId } = await params;
    await authorize(request, websiteId);
    return featureJourney(websiteId, Object.fromEntries(new URL(request.url).searchParams));
  });
}

export async function GET(...args: Parameters<typeof getResponse>) {
  return withQueryCacheHeaders(() => getResponse(...args));
}
