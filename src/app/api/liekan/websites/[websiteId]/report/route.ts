import { withoutQueryCache } from '@/lib/liekan/upstream/cache-context';
import { requestApi, api } from '@/lib/liekan/http';
import { buildReport } from '@/lib/liekan/report';
import { authorize, reportSnapshot } from '@/lib/liekan/upstream/server';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return requestApi(request, async () => {
    const { websiteId } = await params;
    const access = await authorize(request, websiteId);
    return reportSnapshot(() =>
      withoutQueryCache(() =>
        buildReport(
          access.website,
          access.canManage,
          Object.fromEntries(new URL(request.url).searchParams),
        ),
      ),
    );
  });
}
