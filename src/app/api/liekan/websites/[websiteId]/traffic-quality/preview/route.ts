import { api, readBody } from '@/lib/liekan/http';
import { authorize } from '@/lib/liekan/upstream/server';
import { previewTrafficPolicy } from '@/lib/liekan/upstream/traffic-quality';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return api(async () => {
    const { websiteId } = await params;
    const { website, writeIdentity } = await authorize(request, websiteId, true);
    return previewTrafficPolicy(website.id, await readBody(request, 64 * 1024), writeIdentity);
  });
}
