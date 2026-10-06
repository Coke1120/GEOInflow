import { api, readBody } from '@/lib/liekan/http';
import { authorize } from '@/lib/liekan/upstream/server';
import { finalizeCloudflare } from '@/lib/liekan/log-ingestion/cloudflare';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return api(async () => {
    const { websiteId } = await params,
      access = await authorize(request, websiteId, true);
    return finalizeCloudflare(
      access.website.id,
      await readBody(request, 2048),
      access.writeIdentity,
      request,
    );
  });
}
