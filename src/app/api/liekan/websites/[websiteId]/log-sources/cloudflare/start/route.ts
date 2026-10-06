import { api } from '@/lib/liekan/http';
import { authorize } from '@/lib/liekan/upstream/server';
import { beginCloudflare } from '@/lib/liekan/log-ingestion/cloudflare';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  let cookie: string;
  const response = await api(async () => {
    const { websiteId } = await params,
      access = await authorize(request, websiteId, true);
    const result = await beginCloudflare(access.website.id, access.writeIdentity);
    cookie = result.cookie;
    return { authorizationUrl: result.authorizationUrl, flowId: result.flowId };
  });
  if (cookie) response.headers.set('Set-Cookie', cookie);
  return response;
}
