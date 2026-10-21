import { requestApi, api } from '@/lib/liekan/http';
import { authorize } from '@/lib/liekan/upstream/server';
import { browserRiskReport } from '@/lib/liekan/upstream/browser-risk';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return requestApi(request, async () => {
    const { websiteId } = await params;
    const { website } = await authorize(request, websiteId);
    return browserRiskReport(website.id, new URL(request.url).searchParams);
  });
}
