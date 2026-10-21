import { requestApi, api } from '@/lib/liekan/http';
import { authorize } from '@/lib/liekan/upstream/server';
import { featureGoal } from '@/lib/liekan/upstream/feature-analytics';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; goalId: string }> },
) {
  return requestApi(request, async () => {
    const { websiteId, goalId } = await params;
    const access = await authorize(request, websiteId);
    return featureGoal(
      access.website.id,
      goalId,
      Object.fromEntries(new URL(request.url).searchParams),
      access.auth,
    );
  });
}
