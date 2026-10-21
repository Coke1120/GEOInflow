import { requestApi, api, readBody } from '@/lib/liekan/http';
import { authorize } from '@/lib/liekan/upstream/server';
import { saveTrafficPolicy, trafficQualityAudit } from '@/lib/liekan/upstream/traffic-quality';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return requestApi(request, async () => {
    const { websiteId } = await params;
    const { website } = await authorize(request, websiteId);
    return trafficQualityAudit(website.id, new URL(request.url).searchParams);
  });
}
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return requestApi(request, async () => {
    const { websiteId } = await params;
    const { website, writeIdentity } = await authorize(request, websiteId, true);
    return saveTrafficPolicy(website.id, await readBody(request, 64 * 1024), writeIdentity);
  });
}
