import { api } from '@/lib/liekan/http';
import { authorize } from '@/lib/liekan/upstream/server';
import { featureJourney } from '@/lib/liekan/upstream/feature-analytics';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return api(async () => {
    const { websiteId } = await params;
    await authorize(request, websiteId);
    return featureJourney(websiteId, Object.fromEntries(new URL(request.url).searchParams));
  });
}
