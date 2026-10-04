import { withQueryCacheHeaders } from '@/lib/liekan/upstream/cache-context';
import { api } from '@/lib/liekan/http';
import { authorize } from '@/lib/liekan/upstream/server';
import { featureAnalytics } from '@/lib/liekan/upstream/feature-analytics';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return withQueryCacheHeaders(() =>
    api(async () => {
      const { websiteId } = await params;
      await authorize(request, websiteId);
      return featureAnalytics(websiteId, Object.fromEntries(new URL(request.url).searchParams));
    }),
  );
}
