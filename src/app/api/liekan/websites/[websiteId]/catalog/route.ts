import { requestApi, api, readBody } from '@/lib/liekan/http';
import { importCatalog } from '@/lib/liekan/store';
import { authorize } from '@/lib/liekan/upstream/server';
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  return requestApi(request, async () => {
    const { websiteId } = await params;
    const { website, writeIdentity } = await authorize(request, websiteId, true);
    return importCatalog(website.id, website.domain, await readBody(request), writeIdentity);
  });
}
