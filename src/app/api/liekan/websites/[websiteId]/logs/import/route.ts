import { requestApi, api, readBody } from '@/lib/liekan/http';
import { importLogs } from '@/lib/liekan/store';
import { authorize } from '@/lib/liekan/upstream/server';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return requestApi(request, async () => {
    const { websiteId } = await params;
    const { website, writeIdentity } = await authorize(request, websiteId, true);
    return importLogs(website.id, website.domain, await readBody(request), writeIdentity);
  });
}
